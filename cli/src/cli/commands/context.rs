//! Context item command implementations (save, get, delete, update, tag).

use crate::cli::{GetArgs, SaveArgs, TagCommands, UpdateArgs};
use crate::config::{default_actor, resolve_db_path, resolve_session_or_suggest};
use crate::embeddings::{
    create_embedding_provider, is_embeddings_enabled, prepare_item_text, EmbeddingProvider,
    Model2VecProvider, SearchMode,
};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::OnceLock;

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
                return None;
            }
            // Try to create Model2Vec provider - returns None if model loading fails
            Model2VecProvider::try_new()
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
        return; // Embeddings disabled or provider unavailable
    };

    // Prepare text for embedding (same format as quality tier)
    let text = prepare_item_text(key, value, category);

    // Generate embedding synchronously (Model2Vec is fast enough)
    // Note: We call the async method but Model2Vec.encode() is actually sync
    let embedding = {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(_) => return, // Can't create runtime, skip embedding
        };
        match rt.block_on(provider.generate_embedding(&text)) {
            Ok(emb) => emb,
            Err(_) => return, // Embedding failed, skip silently
        }
    };

    // Store the fast embedding
    let chunk_id = format!("fast_{}_{}", item_id, 0);
    let model = provider.info().model;

    // Store the chunk (this also updates fast_embedding_status on the item)
    let _ = storage.store_fast_embedding_chunk(&chunk_id, item_id, 0, &text, &embedding, &model);
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

    // Generate and store fast embedding inline (< 1ms with Model2Vec)
    // This enables immediate semantic search while quality embeddings are generated in background
    store_fast_embedding(
        &mut storage,
        &id,
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

    // Check if semantic search is requested (threshold specified with query)
    let use_semantic = args.threshold.is_some() && args.query.is_some() && is_embeddings_enabled();

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

/// Execute semantic search using embeddings.
///
/// This function:
/// 1. Creates an embedding provider (based on search mode)
/// 2. Generates an embedding for the query
/// 3. Performs cosine similarity search in the database
/// 4. Returns results sorted by similarity
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

    let threshold = args.threshold.unwrap_or(0.5) as f32;
    let search_mode = args.search_mode.unwrap_or_default();

    // Open storage early
    let storage = SqliteStorage::open(db_path)?;

    // Resolve session if not searching all
    let session_filter = if args.search_all_sessions {
        None
    } else {
        Some(resolve_session_or_suggest(session_id, &storage)?)
    };

    // Prepare query text
    let query_text = prepare_item_text("query", query, None);

    // Perform search based on mode
    let results = match search_mode {
        SearchMode::Fast => {
            // Use Model2Vec for instant results
            let provider = Model2VecProvider::try_new().ok_or_else(|| {
                Error::Embedding("Model2Vec not available for fast search".to_string())
            })?;
            let query_embedding = provider.generate_embedding(&query_text).await?;

            storage.search_fast_tier(
                &query_embedding,
                session_filter.as_deref(),
                args.limit,
                threshold,
            )?
        }
        SearchMode::Quality | SearchMode::Tiered => {
            // Use quality provider (Ollama/HuggingFace)
            // Note: Tiered mode falls back to Quality for now
            // Full tiered implementation would do fast candidates + quality re-ranking
            let provider = create_embedding_provider()
                .await
                .ok_or_else(|| Error::Embedding("No quality embedding provider available".to_string()))?;
            let query_embedding = provider.generate_embedding(&query_text).await?;

            storage.semantic_search(
                &query_embedding,
                session_filter.as_deref(),
                args.limit,
                threshold,
            )?
        }
    };

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
            query: query.clone(),
            threshold,
            semantic: true,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if results.is_empty() {
        println!("No matching items found (threshold: {:.2}).", threshold);
        println!();
        println!("Tips:");
        println!("  - Try lowering the threshold (e.g., --threshold 0.3)");
        println!("  - Ensure items have been backfilled: sc embeddings backfill");
    } else {
        println!("Semantic search results ({} found, threshold: {:.2}):", results.len(), threshold);
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
            // Show chunk text if different from value
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
