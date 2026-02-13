//! Context item command implementations (save, get, delete, update, tag).

use crate::cli::{GetArgs, SaveArgs, TagCommands, UpdateArgs};
use crate::config::{default_actor, resolve_db_path, resolve_session_or_suggest};
use crate::embeddings::{
    create_embedding_provider, is_embeddings_enabled, prepare_item_text, BoxedProvider,
    EmbeddingProvider, Model2VecProvider, SearchMode,
};
use crate::error::{Error, Result};
use crate::storage::{SemanticSearchResult, SqliteStorage};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use tracing::{debug, info, trace, warn};

/// Global Model2Vec provider for inline fast embeddings.
///
/// Loaded lazily on first use, then cached for the process lifetime.
/// Model2Vec is ~0.5ms per embedding, making it suitable for inline use.
static FAST_PROVIDER: OnceLock<Option<Model2VecProvider>> = OnceLock::new();

/// Get or initialize the fast embedding provider.
fn get_fast_provider() -> Option<&'static Model2VecProvider> {
    FAST_PROVIDER
        .get_or_init(|| {
            if !is_embeddings_enabled() {
                debug!("Fast embedding provider skipped: embeddings disabled");
                return None;
            }
            let provider = Model2VecProvider::try_new();
            if provider.is_some() {
                debug!("Fast embedding provider initialized (Model2Vec)");
            } else {
                warn!("Fast embedding provider failed to initialize");
            }
            provider
        })
        .as_ref()
}

/// Generate and store a fast embedding for a context item inline.
///
/// This is called synchronously during save to provide immediate semantic search.
/// Model2Vec generates embeddings in < 1ms, so this adds negligible latency.
fn store_fast_embedding(
    storage: &mut SqliteStorage,
    item_id: &str,
    key: &str,
    value: &str,
    category: Option<&str>,
) {
    // Get the fast provider (lazy-loaded)
    let Some(provider) = get_fast_provider() else {
        trace!(key, "Skipping fast embedding: provider unavailable");
        return;
    };

    // Prepare text for embedding (same format as quality tier)
    let text = prepare_item_text(key, value, category);

    // Generate embedding synchronously (Model2Vec is fast enough)
    // Note: We call the async method but Model2Vec.encode() is actually sync
    let embedding = {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(e) => {
                warn!(key, error = %e, "Failed to create tokio runtime for fast embedding");
                return;
            }
        };
        match rt.block_on(provider.generate_embedding(&text)) {
            Ok(emb) => emb,
            Err(e) => {
                warn!(key, error = %e, "Fast embedding generation failed");
                return;
            }
        }
    };

    // Store the fast embedding
    let chunk_id = format!("fast_{}_{}", item_id, 0);
    let model = provider.info().model;

    // Store the chunk (this also updates fast_embedding_status on the item)
    match storage.store_fast_embedding_chunk(&chunk_id, item_id, 0, &text, &embedding, &model) {
        Ok(_) => debug!(key, dim = embedding.len(), "Fast embedding stored"),
        Err(e) => warn!(key, error = %e, "Failed to store fast embedding"),
    }
}

/// Output for save command.
#[derive(Serialize)]
struct SaveOutput {
    key: String,
    category: String,
    priority: String,
    session_id: String,
}

/// Output for get command.
#[derive(Serialize)]
struct GetOutput {
    items: Vec<crate::storage::ContextItem>,
    count: usize,
}

/// Output for semantic search.
#[derive(Serialize)]
struct SemanticSearchOutput {
    items: Vec<SemanticSearchItem>,
    count: usize,
    query: String,
    threshold: f32,
    semantic: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    strategy: Option<String>,
}

/// A semantic search result item.
#[derive(Serialize)]
struct SemanticSearchItem {
    key: String,
    value: String,
    category: String,
    priority: String,
    similarity: f32,
    chunk_text: String,
}

/// Output for delete command.
#[derive(Serialize)]
struct DeleteOutput {
    key: String,
    deleted: bool,
}

/// Execute save command.
pub fn execute_save(
    args: &SaveArgs,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    session_id: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    // Resolve session: explicit flag > status cache > error
    let resolved_session_id = resolve_session_or_suggest(session_id, &storage)?;
    debug!(session = %resolved_session_id, key = %args.key, category = %args.category, "Saving context item");

    // Generate item ID
    let id = format!("item_{}", &uuid::Uuid::new_v4().to_string()[..12]);

    storage.save_context_item(
        &id,
        &resolved_session_id,
        &args.key,
        &args.value,
        Some(&args.category),
        Some(&args.priority),
        &actor,
    )?;

    // Resolve actual item ID — on upsert (key already exists), the DB keeps the
    // original id, not the newly generated one. We need the real id for the FK
    // reference in embedding_chunks_fast.
    let actual_id = storage
        .get_item_id_by_key(&resolved_session_id, &args.key)?
        .unwrap_or(id);

    // Generate and store fast embedding inline (< 1ms with Model2Vec)
    // This enables immediate semantic search while quality embeddings are generated in background
    store_fast_embedding(
        &mut storage,
        &actual_id,
        &args.key,
        &args.value,
        Some(&args.category),
    );

    // Spawn background process to generate embedding (fire-and-forget)
    super::embeddings::spawn_background_embedder();

    if crate::is_silent() {
        println!("{}", args.key);
        return Ok(());
    }

    if json {
        let output = SaveOutput {
            key: args.key.clone(),
            category: args.category.clone(),
            priority: args.priority.clone(),
            session_id: resolved_session_id.clone(),
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Saved: {} [{}]", args.key, args.category);
    }

    Ok(())
}

/// Execute get command.
///
/// Supports two search modes:
/// - **Keyword search** (default): Filters items by key/value containing the query string
/// - **Semantic search**: When `--threshold` is specified, uses embedding similarity
///
/// Semantic search requires:
/// - Embeddings enabled (`SAVECONTEXT_EMBEDDINGS_ENABLED=true`)
/// - An embedding provider (Ollama or HuggingFace)
/// - Items to have been backfilled with embeddings
pub fn execute_get(
    args: &GetArgs,
    db_path: Option<&PathBuf>,
    session_id: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    // Use semantic search when query provided and embeddings are available
    let use_semantic = args.query.is_some() && is_embeddings_enabled();
    debug!(
        query = args.query.as_deref().unwrap_or("(none)"),
        use_semantic,
        embeddings_enabled = is_embeddings_enabled(),
        "Search mode selection"
    );

    if use_semantic {
        // Use async runtime for semantic search
        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| Error::Other(format!("Failed to create async runtime: {e}")))?;

        return rt.block_on(execute_semantic_search(args, &db_path, session_id, json));
    }

    // Standard keyword search path
    let storage = SqliteStorage::open(&db_path)?;

    // Fetch extra for post-filtering and pagination
    #[allow(clippy::cast_possible_truncation)]
    let fetch_limit = ((args.limit + args.offset.unwrap_or(0)) * 2).min(1000) as u32;

    // Get items - either from all sessions or current session
    let items = if args.search_all_sessions {
        // Search across all sessions
        storage.get_all_context_items(
            args.category.as_deref(),
            args.priority.as_deref(),
            Some(fetch_limit),
        )?
    } else {
        // Resolve session: explicit flag > status cache > error
        let resolved_session_id = resolve_session_or_suggest(session_id, &storage)?;

        storage.get_context_items(
            &resolved_session_id,
            args.category.as_deref(),
            args.priority.as_deref(),
            Some(fetch_limit),
        )?
    };

    // Filter by key if specified
    let items: Vec<_> = if let Some(ref key) = args.key {
        items.into_iter().filter(|i| i.key == *key).collect()
    } else if let Some(ref query) = args.query {
        // Simple keyword search
        let q = query.to_lowercase();
        items
            .into_iter()
            .filter(|i| {
                i.key.to_lowercase().contains(&q) || i.value.to_lowercase().contains(&q)
            })
            .collect()
    } else {
        items
    };

    // Apply offset and limit
    let items: Vec<_> = items
        .into_iter()
        .skip(args.offset.unwrap_or(0))
        .take(args.limit)
        .collect();

    if crate::is_csv() {
        println!("key,category,priority,value");
        for item in &items {
            let val = crate::csv_escape(&item.value);
            println!("{},{},{},{}", item.key, item.category, item.priority, val);
        }
    } else if json {
        let output = GetOutput {
            count: items.len(),
            items,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if items.is_empty() {
        println!("No context items found.");
    } else {
        println!("Context items ({} found):", items.len());
        println!();
        for item in &items {
            let priority_icon = match item.priority.as_str() {
                "high" => "!",
                "low" => "-",
                _ => " ",
            };
            println!("[{}] {} ({})", priority_icon, item.key, item.category);
            // Truncate long values
            let display_value = if item.value.len() > 100 {
                format!("{}...", &item.value[..100])
            } else {
                item.value.clone()
            };
            println!("    {display_value}");
            println!();
        }
    }

    Ok(())
}

/// Execute smart semantic search with cascading pipeline.
///
/// 4-stage pipeline that progressively broadens search strategy:
/// 1. Full query with adaptive threshold (dynamic cutoff based on score distribution)
/// 2. Sub-query decomposition + Reciprocal Rank Fusion (split multi-word queries)
/// 3. Scope expansion to all sessions (if currently session-scoped)
/// 4. Nearest-miss suggestions (below threshold but closest matches)
///
/// Search modes:
/// - `Fast`: Uses Model2Vec for instant results (lower accuracy)
/// - `Quality`: Uses Ollama/HuggingFace for accurate results (slower)
/// - `Tiered`: Fast candidates then quality re-ranking (default, falls back to quality)
async fn execute_semantic_search(
    args: &GetArgs,
    db_path: &std::path::Path,
    session_id: Option<&str>,
    json: bool,
) -> Result<()> {
    let query = args.query.as_ref().ok_or_else(|| {
        Error::InvalidArgument("Query is required for semantic search".to_string())
    })?;

    let explicit_threshold = args.threshold.map(|t| t as f32);
    let search_mode = args.search_mode.unwrap_or_default();

    // Open storage
    let storage = SqliteStorage::open(db_path)?;

    // Resolve session if not searching all
    let session_filter = if args.search_all_sessions {
        None
    } else {
        Some(resolve_session_or_suggest(session_id, &storage)?)
    };

    // Create embedding provider based on search mode
    let query_text = prepare_item_text("query", query, None);
    info!(query, ?search_mode, session = session_filter.as_deref().unwrap_or("all"), "Starting semantic search");

    // We use an enum to hold the provider since EmbeddingProvider isn't object-safe
    let (query_embedding, provider) = match search_mode {
        SearchMode::Fast => {
            debug!("Using fast provider (Model2Vec)");
            let p = Model2VecProvider::try_new().ok_or_else(|| {
                Error::Embedding("Model2Vec not available for fast search".to_string())
            })?;
            let emb = p.generate_embedding(&query_text).await?;
            (emb, SmartProvider::Fast(p))
        }
        SearchMode::Quality | SearchMode::Tiered => {
            debug!("Using quality provider (Ollama/HuggingFace)");
            let p = create_embedding_provider()
                .await
                .ok_or_else(|| Error::Embedding("No quality embedding provider available".to_string()))?;
            let emb = p.generate_embedding(&query_text).await?;
            (emb, SmartProvider::Quality(p))
        }
    };

    // Choose the right search function based on search mode
    let search_fn = match search_mode {
        SearchMode::Fast => SearchFn::Fast,
        SearchMode::Quality | SearchMode::Tiered => SearchFn::Quality,
    };

    // --- Stage 1: Full query with adaptive threshold ---
    debug!("Stage 1: adaptive threshold search");
    let results = smart_search_adaptive(
        &storage,
        &search_fn,
        &query_embedding,
        session_filter.as_deref(),
        args.limit,
        explicit_threshold,
    )?;

    if !results.is_empty() {
        info!(count = results.len(), "Stage 1 matched");
        return output_semantic_results(&results, query, explicit_threshold.unwrap_or(0.0), json, None);
    }
    debug!("Stage 1: no results");

    // --- Stage 2: Decompose + RRF (only for multi-word queries) ---
    let sub_queries = decompose_query(query);
    debug!(sub_query_count = sub_queries.len(), ?sub_queries, "Stage 2: decomposition");
    if sub_queries.len() > 1 {
        let results = smart_search_rrf(
            &provider,
            &storage,
            &search_fn,
            &sub_queries,
            session_filter.as_deref(),
            args.limit,
        )
        .await?;

        if !results.is_empty() {
            info!(count = results.len(), "Stage 2 matched (decomposed query)");
            return output_semantic_results(&results, query, 0.0, json, Some("decomposed query"));
        }
        debug!("Stage 2: no results from RRF");
    }

    // --- Stage 3: Expand to all sessions (if currently session-scoped) ---
    if session_filter.is_some() {
        debug!("Stage 3: expanding scope to all sessions");
        let results = smart_search_adaptive(
            &storage,
            &search_fn,
            &query_embedding,
            None,
            args.limit,
            explicit_threshold,
        )?;

        if !results.is_empty() {
            info!(count = results.len(), "Stage 3 matched (all sessions, adaptive)");
            return output_semantic_results(
                &results, query, explicit_threshold.unwrap_or(0.0), json,
                Some("expanded to all sessions"),
            );
        }

        if sub_queries.len() > 1 {
            debug!("Stage 3b: all sessions + decomposition");
            let results = smart_search_rrf(
                &provider,
                &storage,
                &search_fn,
                &sub_queries,
                None,
                args.limit,
            )
            .await?;

            if !results.is_empty() {
                info!(count = results.len(), "Stage 3b matched (all sessions + decomposed)");
                return output_semantic_results(
                    &results, query, 0.0, json,
                    Some("expanded to all sessions + decomposed"),
                );
            }
        }
    }

    // --- Stage 4: Suggestions (nearest misses) ---
    debug!("Stage 4: all stages exhausted, fetching nearest misses");
    let all_results = match search_fn {
        SearchFn::Fast => storage.search_fast_tier(&query_embedding, None, 5, 0.0)?,
        SearchFn::Quality => storage.semantic_search(&query_embedding, None, 5, 0.0)?,
    };

    if all_results.is_empty() {
        output_semantic_results(&[], query, 0.0, json, None)
    } else {
        output_suggestions(&all_results, query, json)
    }
}

/// Which search tier to use.
enum SearchFn {
    Fast,
    Quality,
}

/// Provider wrapper that handles both Model2Vec (fast) and BoxedProvider (quality).
enum SmartProvider {
    Fast(Model2VecProvider),
    Quality(BoxedProvider),
}

impl SmartProvider {
    async fn generate_embedding(&self, text: &str) -> Result<Vec<f32>> {
        match self {
            SmartProvider::Fast(p) => p.generate_embedding(text).await,
            SmartProvider::Quality(p) => p.generate_embedding(text).await,
        }
    }
}

/// Stage 1: Full query with adaptive threshold.
///
/// If user specified a threshold, use it directly.
/// Otherwise, compute a dynamic cutoff: `max(0.25, top_score * 0.6)`.
fn smart_search_adaptive(
    storage: &SqliteStorage,
    search_fn: &SearchFn,
    query_embedding: &[f32],
    session_id: Option<&str>,
    limit: usize,
    explicit_threshold: Option<f32>,
) -> Result<Vec<SemanticSearchResult>> {
    if let Some(t) = explicit_threshold {
        // User specified threshold — use it directly
        trace!(threshold = t, "Using explicit threshold");
        return match search_fn {
            SearchFn::Fast => storage.search_fast_tier(query_embedding, session_id, limit, t),
            SearchFn::Quality => storage.semantic_search(query_embedding, session_id, limit, t),
        };
    }

    // Adaptive: get all results with no threshold, compute dynamic cutoff
    let all = match search_fn {
        SearchFn::Fast => storage.search_fast_tier(query_embedding, session_id, limit * 3, 0.0)?,
        SearchFn::Quality => storage.semantic_search(query_embedding, session_id, limit * 3, 0.0)?,
    };

    if all.is_empty() {
        trace!("Adaptive search: corpus empty");
        return Ok(vec![]);
    }

    let top_score = all[0].similarity;
    let adaptive_threshold = (top_score * 0.6).max(0.25);
    let filtered_count = all.iter().filter(|r| r.similarity >= adaptive_threshold).count();
    debug!(
        top_score,
        adaptive_threshold,
        candidates = all.len(),
        above_threshold = filtered_count,
        "Adaptive threshold computed"
    );

    Ok(all
        .into_iter()
        .filter(|r| r.similarity >= adaptive_threshold)
        .take(limit)
        .collect())
}

/// Stage 2: Decompose query into sub-queries, search each, fuse with RRF.
///
/// Reciprocal Rank Fusion: `score(item) = SUM(1 / (k + rank))` across all sub-query results.
/// This is the same technique used by Elasticsearch, Pinecone, and other hybrid search engines.
async fn smart_search_rrf(
    provider: &SmartProvider,
    storage: &SqliteStorage,
    search_fn: &SearchFn,
    sub_queries: &[String],
    session_id: Option<&str>,
    limit: usize,
) -> Result<Vec<SemanticSearchResult>> {
    let k = 60.0_f32; // Standard RRF constant

    // Search each sub-query
    let mut all_result_sets = Vec::new();
    for sq in sub_queries {
        let text = prepare_item_text("query", sq, None);
        let emb = provider.generate_embedding(&text).await?;
        let results = match search_fn {
            SearchFn::Fast => storage.search_fast_tier(&emb, session_id, 20, 0.2)?,
            SearchFn::Quality => storage.semantic_search(&emb, session_id, 20, 0.2)?,
        };
        trace!(sub_query = sq, hits = results.len(), "Sub-query results");
        all_result_sets.push(results);
    }

    // Fuse with RRF
    let mut scores: HashMap<String, (f32, SemanticSearchResult)> = HashMap::new();
    for results in &all_result_sets {
        for (rank, result) in results.iter().enumerate() {
            let rrf_score = 1.0 / (k + rank as f32 + 1.0);
            scores
                .entry(result.item_id.clone())
                .and_modify(|(score, _)| *score += rrf_score)
                .or_insert((rrf_score, result.clone()));
        }
    }

    let mut fused: Vec<_> = scores.into_values().collect();
    fused.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    debug!(
        unique_items = fused.len(),
        top_rrf_score = fused.first().map(|(s, _)| *s).unwrap_or(0.0),
        "RRF fusion complete"
    );

    Ok(fused
        .into_iter()
        .take(limit)
        .map(|(rrf_score, mut r)| {
            r.similarity = rrf_score;
            r
        })
        .collect())
}

/// Decompose a multi-word query into focused sub-queries.
///
/// Splits into individual words (>2 chars) plus bigrams for multi-word concepts.
/// Model2Vec works best with focused terms rather than long phrases.
fn decompose_query(query: &str) -> Vec<String> {
    let words: Vec<&str> = query.split_whitespace().filter(|w| w.len() > 2).collect();

    if words.len() <= 1 {
        return vec![query.to_string()];
    }

    let mut sub_queries = Vec::new();

    // Individual words (strongest signal for Model2Vec)
    for word in &words {
        sub_queries.push((*word).to_string());
    }

    // Bigrams for multi-word concepts
    for window in words.windows(2) {
        sub_queries.push(format!("{} {}", window[0], window[1]));
    }

    sub_queries
}

/// Format and output semantic search results.
fn output_semantic_results(
    results: &[SemanticSearchResult],
    query: &str,
    threshold: f32,
    json: bool,
    strategy: Option<&str>,
) -> Result<()> {
    if json {
        let items: Vec<SemanticSearchItem> = results
            .iter()
            .map(|r| SemanticSearchItem {
                key: r.key.clone(),
                value: r.value.clone(),
                category: r.category.clone(),
                priority: r.priority.clone(),
                similarity: r.similarity,
                chunk_text: r.chunk_text.clone(),
            })
            .collect();

        let output = SemanticSearchOutput {
            count: items.len(),
            items,
            query: query.to_string(),
            threshold,
            semantic: true,
            strategy: strategy.map(String::from),
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if results.is_empty() {
        println!("No matching items found.");
        println!();
        println!("Tips:");
        println!("  - Try a simpler query (single keywords work best)");
        println!("  - Ensure items have been backfilled: sc embeddings backfill");
    } else {
        let strategy_note = strategy
            .map(|s| format!(", strategy: {s}"))
            .unwrap_or_default();
        println!(
            "Semantic search results ({} found{}):",
            results.len(),
            strategy_note
        );
        println!();
        for (i, result) in results.iter().enumerate() {
            let priority_icon = match result.priority.as_str() {
                "high" => "!",
                "low" => "-",
                _ => " ",
            };
            println!(
                "{}. [{:.0}%] [{}] {} ({})",
                i + 1,
                result.similarity * 100.0,
                priority_icon,
                result.key,
                result.category
            );
            let display_text = if result.chunk_text.len() > 100 {
                format!("{}...", &result.chunk_text[..100])
            } else {
                result.chunk_text.clone()
            };
            println!("    {display_text}");
            println!();
        }
    }

    Ok(())
}

/// Output near-miss suggestions when all stages found nothing above threshold.
fn output_suggestions(
    results: &[SemanticSearchResult],
    query: &str,
    json: bool,
) -> Result<()> {
    if json {
        let items: Vec<SemanticSearchItem> = results
            .iter()
            .map(|r| SemanticSearchItem {
                key: r.key.clone(),
                value: r.value.clone(),
                category: r.category.clone(),
                priority: r.priority.clone(),
                similarity: r.similarity,
                chunk_text: r.chunk_text.clone(),
            })
            .collect();

        let output = SemanticSearchOutput {
            count: 0,
            items,
            query: query.to_string(),
            threshold: 0.0,
            semantic: true,
            strategy: Some("suggestions (nearest misses)".to_string()),
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("No strong matches found. Nearest items in corpus:");
        println!();
        for (i, result) in results.iter().enumerate() {
            println!(
                "  {}. [{:.0}%] {} ({})",
                i + 1,
                result.similarity * 100.0,
                result.key,
                result.category
            );
        }
        println!();
        println!("Tips:");
        println!("  - Try simpler keywords: single terms work best");
        println!("  - Try --search-all-sessions to search all sessions");
    }

    Ok(())
}

/// Execute delete command.
pub fn execute_delete(
    key: &str,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    session_id: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    // Resolve session: explicit flag > status cache > error
    let resolved_session_id = resolve_session_or_suggest(session_id, &storage)?;

    storage.delete_context_item(&resolved_session_id, key, &actor)?;

    if json {
        let output = DeleteOutput {
            key: key.to_string(),
            deleted: true,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Deleted: {key}");
    }

    Ok(())
}

/// Output for update command.
#[derive(Serialize)]
struct UpdateOutput {
    key: String,
    updated: bool,
}

/// Execute update command.
pub fn execute_update(
    args: &UpdateArgs,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    session_id: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    // Check if any update field is provided
    if args.value.is_none()
        && args.category.is_none()
        && args.priority.is_none()
        && args.channel.is_none()
    {
        return Err(Error::Config(
            "At least one of --value, --category, --priority, or --channel must be provided"
                .to_string(),
        ));
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    // Resolve session: explicit flag > status cache > error
    let resolved_session_id = resolve_session_or_suggest(session_id, &storage)?;

    storage.update_context_item(
        &resolved_session_id,
        &args.key,
        args.value.as_deref(),
        args.category.as_deref(),
        args.priority.as_deref(),
        args.channel.as_deref(),
        &actor,
    )?;

    if json {
        let output = UpdateOutput {
            key: args.key.clone(),
            updated: true,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Updated: {}", args.key);
    }

    Ok(())
}

/// Output for tag command.
#[derive(Serialize)]
struct TagOutput {
    key: String,
    action: String,
    tags: Vec<String>,
}

/// Execute tag command.
pub fn execute_tag(
    command: &TagCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    session_id: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    // Resolve session: explicit flag > status cache > error
    let resolved_session_id = resolve_session_or_suggest(session_id, &storage)?;

    match command {
        TagCommands::Add { key, tags } => {
            storage.add_tags_to_item(&resolved_session_id, key, tags, &actor)?;

            if json {
                let output = TagOutput {
                    key: key.clone(),
                    action: "add".to_string(),
                    tags: tags.clone(),
                };
                println!("{}", serde_json::to_string(&output)?);
            } else {
                println!("Added tags to {}: {}", key, tags.join(", "));
            }
        }
        TagCommands::Remove { key, tags } => {
            storage.remove_tags_from_item(&resolved_session_id, key, tags, &actor)?;

            if json {
                let output = TagOutput {
                    key: key.clone(),
                    action: "remove".to_string(),
                    tags: tags.clone(),
                };
                println!("{}", serde_json::to_string(&output)?);
            } else {
                println!("Removed tags from {}: {}", key, tags.join(", "));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- decompose_query tests ---

    #[test]
    fn test_decompose_single_word() {
        // Single word returns as-is, no decomposition
        let result = decompose_query("authentication");
        assert_eq!(result, vec!["authentication"]);
    }

    #[test]
    fn test_decompose_short_words_filtered() {
        // Words <= 2 chars are dropped; if all are short, returns original
        let result = decompose_query("is it ok");
        // "is" (2 chars), "it" (2 chars), "ok" (2 chars) — all filtered
        assert_eq!(result, vec!["is it ok"]);
    }

    #[test]
    fn test_decompose_multi_word() {
        let result = decompose_query("ABG revenue impact metrics");
        // Individual words > 2 chars
        assert!(result.contains(&"ABG".to_string()));
        assert!(result.contains(&"revenue".to_string()));
        assert!(result.contains(&"impact".to_string()));
        assert!(result.contains(&"metrics".to_string()));
        // Bigrams
        assert!(result.contains(&"ABG revenue".to_string()));
        assert!(result.contains(&"revenue impact".to_string()));
        assert!(result.contains(&"impact metrics".to_string()));
        // Total: 4 words + 3 bigrams = 7
        assert_eq!(result.len(), 7);
    }

    #[test]
    fn test_decompose_filters_short_words_in_multi() {
        // "a" and "to" are <= 2 chars, filtered out
        let result = decompose_query("how to fix a bug");
        // "how" (3), "fix" (3), "bug" (3) remain
        assert!(result.contains(&"how".to_string()));
        assert!(result.contains(&"fix".to_string()));
        assert!(result.contains(&"bug".to_string()));
        // "to" and "a" should NOT appear as standalone sub-queries
        assert!(!result.iter().any(|s| s == "to"));
        assert!(!result.iter().any(|s| s == "a"));
        // Bigrams from filtered list: "how fix", "fix bug"
        assert!(result.contains(&"how fix".to_string()));
        assert!(result.contains(&"fix bug".to_string()));
        assert_eq!(result.len(), 5);
    }

    #[test]
    fn test_decompose_two_words() {
        let result = decompose_query("retainer pricing");
        // 2 words + 1 bigram = 3
        assert_eq!(result, vec!["retainer", "pricing", "retainer pricing"]);
    }

    #[test]
    fn test_decompose_empty() {
        let result = decompose_query("");
        assert_eq!(result, vec![""]);
    }

    #[test]
    fn test_decompose_whitespace_only() {
        let result = decompose_query("   ");
        // No words pass the >2 char filter, returns original
        assert_eq!(result, vec!["   "]);
    }

    // --- RRF scoring tests ---
    // Tests the mathematical property of Reciprocal Rank Fusion independently.

    #[test]
    fn test_rrf_scoring_formula() {
        // RRF score = 1 / (k + rank + 1), with k = 60
        let k = 60.0_f32;

        // Rank 0 (best) -> 1/61
        let rank_0 = 1.0 / (k + 0.0 + 1.0);
        assert!((rank_0 - 0.01639).abs() < 0.001);

        // Rank 1 -> 1/62
        let rank_1 = 1.0 / (k + 1.0 + 1.0);
        assert!(rank_0 > rank_1);

        // Rank 19 (last in a 20-result set) -> 1/80 = 0.0125
        let rank_19 = 1.0 / (k + 19.0 + 1.0);
        assert!((rank_19 - 0.0125).abs() < 0.001);
    }

    #[test]
    fn test_rrf_fusion_logic() {
        // Simulate two sub-query result sets with overlapping items
        let k = 60.0_f32;
        let mut scores: HashMap<String, f32> = HashMap::new();

        // Sub-query 1: ["item-A" rank 0, "item-B" rank 1, "item-C" rank 2]
        for (rank, item) in ["item-A", "item-B", "item-C"].iter().enumerate() {
            let rrf_score = 1.0 / (k + rank as f32 + 1.0);
            *scores.entry(item.to_string()).or_default() += rrf_score;
        }

        // Sub-query 2: ["item-B" rank 0, "item-D" rank 1, "item-A" rank 2]
        for (rank, item) in ["item-B", "item-D", "item-A"].iter().enumerate() {
            let rrf_score = 1.0 / (k + rank as f32 + 1.0);
            *scores.entry(item.to_string()).or_default() += rrf_score;
        }

        // item-B appears at rank 0 + rank 1 -> highest fused score
        // item-A appears at rank 0 + rank 2 -> second highest
        let mut sorted: Vec<_> = scores.into_iter().collect();
        sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        assert_eq!(sorted[0].0, "item-B");
        assert_eq!(sorted[1].0, "item-A");
        assert_eq!(sorted[2].0, "item-D");
        assert_eq!(sorted[3].0, "item-C");
    }

    #[test]
    fn test_rrf_single_result_set() {
        // With only one sub-query, RRF degenerates to simple rank scoring
        let k = 60.0_f32;
        let mut scores: Vec<(String, f32)> = Vec::new();

        for (rank, item) in ["a", "b", "c"].iter().enumerate() {
            let rrf_score = 1.0 / (k + rank as f32 + 1.0);
            scores.push((item.to_string(), rrf_score));
        }

        assert!(scores[0].1 > scores[1].1);
        assert!(scores[1].1 > scores[2].1);
    }

    // --- Adaptive threshold tests ---

    #[test]
    fn test_adaptive_threshold_formula() {
        // adaptive = max(0.25, top_score * 0.6)
        assert_eq!((0.9_f32 * 0.6).max(0.25), 0.54);   // high confidence
        assert_eq!((0.5_f32 * 0.6).max(0.25), 0.3);     // medium
        assert_eq!((0.3_f32 * 0.6).max(0.25), 0.25);    // floor kicks in
        assert_eq!((0.1_f32 * 0.6).max(0.25), 0.25);    // well below floor
    }
}
