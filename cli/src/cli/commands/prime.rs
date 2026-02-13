//! Prime command implementation.
//!
//! Generates a context primer for AI coding agents by aggregating
//! session state, issues, memory, and optionally Claude Code transcripts
//! into a single injectable context block.
//!
//! This is a **read-only** command — it never mutates the database.

use crate::config::{current_git_branch, resolve_db_path, resolve_project_path, resolve_session_or_suggest};
use crate::embeddings::{is_embeddings_enabled, EmbeddingProvider, Model2VecProvider};
use crate::error::{Error, Result};
use crate::storage::{ContextItem, SqliteStorage};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use tracing::{debug, warn};

/// Limits for prime context items
const HIGH_PRIORITY_LIMIT: u32 = 10;
const DECISION_LIMIT: u32 = 10;
const REMINDER_LIMIT: u32 = 10;
const PROGRESS_LIMIT: u32 = 5;
const READY_ISSUES_LIMIT: u32 = 10;
const MEMORY_DISPLAY_LIMIT: usize = 20;

/// Smart prime defaults
const MMR_LAMBDA: f64 = 0.7;
const HEADER_TOKEN_RESERVE: usize = 200;

// ============================================================================
// JSON Output Structures
// ============================================================================

#[derive(Serialize)]
struct PrimeOutput {
    session: SessionInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    git: Option<GitInfo>,
    context: ContextBlock,
    issues: IssueBlock,
    memory: Vec<MemoryEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transcript: Option<TranscriptBlock>,
    command_reference: Vec<CmdRef>,
}

#[derive(Serialize)]
struct SessionInfo {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
}

#[derive(Serialize)]
struct GitInfo {
    branch: String,
    changed_files: Vec<String>,
}

#[derive(Serialize)]
struct ContextBlock {
    high_priority: Vec<ContextEntry>,
    decisions: Vec<ContextEntry>,
    reminders: Vec<ContextEntry>,
    recent_progress: Vec<ContextEntry>,
    total_items: usize,
}

#[derive(Serialize)]
struct ContextEntry {
    key: String,
    value: String,
    category: String,
    priority: String,
}

#[derive(Serialize)]
struct IssueBlock {
    active: Vec<IssueSummary>,
    ready: Vec<IssueSummary>,
    total_open: usize,
}

#[derive(Serialize)]
struct IssueSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    short_id: Option<String>,
    title: String,
    status: String,
    priority: i32,
    issue_type: String,
}

#[derive(Serialize)]
struct MemoryEntry {
    key: String,
    value: String,
    category: String,
}

#[derive(Serialize, Clone)]
struct TranscriptBlock {
    source: String,
    entries: Vec<TranscriptEntry>,
}

#[derive(Serialize, Clone)]
struct TranscriptEntry {
    summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<String>,
}

#[derive(Serialize, Clone)]
struct CmdRef {
    cmd: String,
    desc: String,
}

// ============================================================================
// Smart Prime Structures
// ============================================================================

struct ScoredItem {
    item: ContextItem,
    score: f64,
    token_estimate: usize,
    embedding: Option<Vec<f32>>,
}

struct SmartConfig {
    budget: usize,
    decay_half_life_days: f64,
    query_embedding: Option<Vec<f32>>,
    mmr_lambda: f64,
}

#[derive(Serialize)]
struct SmartPrimeOutput {
    stats: SmartPrimeStats,
    scored_context: Vec<ScoredContextEntry>,
    issues: IssueBlock,
    memory: Vec<MemoryEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transcript: Option<TranscriptBlock>,
    command_reference: Vec<CmdRef>,
}

#[derive(Serialize)]
struct SmartPrimeStats {
    total_items: usize,
    selected_items: usize,
    tokens_used: usize,
    tokens_budget: usize,
    embeddings_available: bool,
    mmr_applied: bool,
    query_boosted: bool,
}

#[derive(Serialize)]
struct ScoredContextEntry {
    key: String,
    value: String,
    category: String,
    priority: String,
    score: f64,
    token_estimate: usize,
}

/// Lazy-init Model2Vec provider for query embedding generation.
static FAST_PROVIDER: OnceLock<Option<Model2VecProvider>> = OnceLock::new();

fn get_fast_provider() -> Option<&'static Model2VecProvider> {
    FAST_PROVIDER
        .get_or_init(|| {
            if !is_embeddings_enabled() {
                return None;
            }
            Model2VecProvider::try_new()
        })
        .as_ref()
}

// ============================================================================
// Execute
// ============================================================================

/// Execute the prime command.
#[allow(clippy::too_many_arguments)]
pub fn execute(
    db_path: Option<&PathBuf>,
    session_id: Option<&str>,
    json: bool,
    include_transcript: bool,
    transcript_limit: usize,
    compact: bool,
    smart: bool,
    budget: usize,
    query: Option<&str>,
    decay_days: u32,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;

    // Resolve session via TTY-keyed status cache
    let sid = resolve_session_or_suggest(session_id, &storage)?;
    let session = storage
        .get_session(&sid)?
        .ok_or_else(|| Error::SessionNotFound { id: sid })?;

    let project_path = session
        .project_path
        .clone()
        .or_else(|| resolve_project_path(&storage, None).ok())
        .unwrap_or_else(|| ".".to_string());

    // Git info
    let git_branch = current_git_branch();
    let git_status = get_git_status();

    // Smart mode: scoring pipeline with embedding-powered ranking
    if smart {
        return execute_smart(
            &storage, &session, &project_path, &git_branch, &git_status,
            json, compact, include_transcript, transcript_limit,
            budget, query, decay_days,
        );
    }

    // Context items (read-only queries)
    let all_items = storage.get_context_items(&session.id, None, None, Some(1000))?;
    let high_priority =
        storage.get_context_items(&session.id, None, Some("high"), Some(HIGH_PRIORITY_LIMIT))?;
    let decisions =
        storage.get_context_items(&session.id, Some("decision"), None, Some(DECISION_LIMIT))?;
    let reminders =
        storage.get_context_items(&session.id, Some("reminder"), None, Some(REMINDER_LIMIT))?;
    let progress =
        storage.get_context_items(&session.id, Some("progress"), None, Some(PROGRESS_LIMIT))?;

    // Issues
    let active_issues =
        storage.list_issues(&project_path, Some("in_progress"), None, Some(READY_ISSUES_LIMIT))?;
    let ready_issues = storage.get_ready_issues(&project_path, READY_ISSUES_LIMIT)?;
    let all_open_issues = storage.list_issues(&project_path, None, None, Some(1000))?;

    // Memory
    let memory_items = storage.list_memory(&project_path, None)?;

    // Transcript (optional, never fails the command)
    let transcript = if include_transcript {
        parse_claude_transcripts(&project_path, transcript_limit)
    } else {
        None
    };

    let cmd_ref = build_command_reference();

    if json {
        let output = PrimeOutput {
            session: SessionInfo {
                id: session.id.clone(),
                name: session.name.clone(),
                description: session.description.clone(),
                status: session.status.clone(),
                branch: session.branch.clone(),
                project_path: session.project_path.clone(),
            },
            git: git_branch.as_ref().map(|branch| {
                let files: Vec<String> = git_status
                    .as_ref()
                    .map(|s| {
                        s.lines()
                            .take(20)
                            .map(|l| l.trim().to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                GitInfo {
                    branch: branch.clone(),
                    changed_files: files,
                }
            }),
            context: ContextBlock {
                high_priority: high_priority.iter().map(to_context_entry).collect(),
                decisions: decisions.iter().map(to_context_entry).collect(),
                reminders: reminders.iter().map(to_context_entry).collect(),
                recent_progress: progress.iter().map(to_context_entry).collect(),
                total_items: all_items.len(),
            },
            issues: IssueBlock {
                active: active_issues.iter().map(to_issue_summary).collect(),
                ready: ready_issues.iter().map(to_issue_summary).collect(),
                total_open: all_open_issues.len(),
            },
            memory: memory_items
                .iter()
                .take(MEMORY_DISPLAY_LIMIT)
                .map(|m| MemoryEntry {
                    key: m.key.clone(),
                    value: m.value.clone(),
                    category: m.category.clone(),
                })
                .collect(),
            transcript,
            command_reference: cmd_ref,
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else if compact {
        print_compact(
            &session,
            &git_branch,
            &git_status,
            &high_priority,
            &decisions,
            &reminders,
            &progress,
            &active_issues,
            &ready_issues,
            &all_open_issues,
            &memory_items,
            &transcript,
            all_items.len(),
            &cmd_ref,
        );
    } else {
        print_full(
            &session,
            &git_branch,
            &git_status,
            &high_priority,
            &decisions,
            &reminders,
            &progress,
            &active_issues,
            &ready_issues,
            &all_open_issues,
            &memory_items,
            &transcript,
            all_items.len(),
            &cmd_ref,
        );
    }

    Ok(())
}

// ============================================================================
// Smart Prime Pipeline
// ============================================================================

#[allow(clippy::too_many_arguments)]
fn execute_smart(
    storage: &SqliteStorage,
    session: &crate::storage::Session,
    project_path: &str,
    git_branch: &Option<String>,
    git_status: &Option<String>,
    json: bool,
    compact: bool,
    include_transcript: bool,
    transcript_limit: usize,
    budget: usize,
    query: Option<&str>,
    decay_days: u32,
) -> Result<()> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let half_life = decay_days as f64;

    // Step 1: Fetch all items + embeddings in one query
    let items_with_embeddings = storage.get_items_with_fast_embeddings(&session.id)?;
    let total_items = items_with_embeddings.len();
    let embeddings_available = items_with_embeddings.iter().any(|(_, e)| e.is_some());

    // Generate query embedding if --query provided
    let query_embedding = query.and_then(|q| generate_query_embedding(q));
    let query_boosted = query_embedding.is_some();

    let config = SmartConfig {
        budget,
        decay_half_life_days: half_life,
        query_embedding,
        mmr_lambda: MMR_LAMBDA,
    };

    // Step 2: Score each item
    let mut scored: Vec<ScoredItem> = items_with_embeddings
        .into_iter()
        .map(|(item, embedding)| {
            let td = temporal_decay(item.updated_at, now_ms, config.decay_half_life_days);
            let pw = priority_weight(&item.priority);
            let cw = category_weight(&item.category);
            let sb = semantic_boost(
                embedding.as_deref(),
                config.query_embedding.as_deref(),
            );
            let score = td * pw * cw * sb;
            let token_estimate = estimate_tokens(&item.key, &item.value);

            ScoredItem { item, score, token_estimate, embedding }
        })
        .collect();

    // Step 3: Sort by score descending
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Step 4: MMR diversity re-ranking (only when embeddings exist)
    let mmr_applied = embeddings_available;
    if mmr_applied {
        scored = apply_mmr(scored, config.mmr_lambda);
    }

    // Step 5: Greedy token-budget packing
    let packed = pack_to_budget(scored, config.budget);
    let selected_items = packed.len();
    let tokens_used: usize = packed.iter().map(|s| s.token_estimate).sum::<usize>() + HEADER_TOKEN_RESERVE;

    let stats = SmartPrimeStats {
        total_items,
        selected_items,
        tokens_used,
        tokens_budget: config.budget,
        embeddings_available,
        mmr_applied,
        query_boosted,
    };

    // Fetch shared data (issues, memory, transcript)
    let active_issues =
        storage.list_issues(project_path, Some("in_progress"), None, Some(READY_ISSUES_LIMIT))?;
    let ready_issues = storage.get_ready_issues(project_path, READY_ISSUES_LIMIT)?;
    let all_open_issues = storage.list_issues(project_path, None, None, Some(1000))?;
    let memory_items = storage.list_memory(project_path, None)?;
    let transcript = if include_transcript {
        parse_claude_transcripts(project_path, transcript_limit)
    } else {
        None
    };
    let cmd_ref = build_command_reference();

    if json {
        output_smart_json(&stats, &packed, &active_issues, &ready_issues, &all_open_issues, &memory_items, &transcript, &cmd_ref)?;
    } else if compact {
        output_smart_compact(session, git_branch, &stats, &packed, &active_issues, &ready_issues, &all_open_issues, &memory_items, &transcript, &cmd_ref);
    } else {
        output_smart_terminal(session, git_branch, git_status, &stats, &packed, &active_issues, &ready_issues, &all_open_issues, &memory_items, &transcript, &cmd_ref);
    }

    Ok(())
}

// ============================================================================
// Scoring Functions
// ============================================================================

/// Exponential temporal decay based on item age.
///
/// Returns 1.0 for items updated just now, 0.5 at half_life_days, 0.25 at 2x half_life.
fn temporal_decay(updated_at_ms: i64, now_ms: i64, half_life_days: f64) -> f64 {
    let age_days = (now_ms - updated_at_ms) as f64 / 86_400_000.0;
    if age_days <= 0.0 {
        return 1.0;
    }
    let lambda = 2.0_f64.ln() / half_life_days;
    (-lambda * age_days).exp()
}

/// Weight by priority level.
fn priority_weight(priority: &str) -> f64 {
    match priority {
        "high" => 3.0,
        "normal" => 1.0,
        "low" => 0.5,
        _ => 1.0,
    }
}

/// Weight by category importance.
fn category_weight(category: &str) -> f64 {
    match category {
        "decision" => 2.0,
        "reminder" => 1.5,
        "progress" => 1.0,
        "note" => 0.5,
        _ => 1.0,
    }
}

/// Semantic boost when a query embedding is provided.
///
/// sim=1.0 -> 2.5x boost, sim=0.0 -> 1.0x (neutral), sim=-1.0 -> penalty (0.5x minimum via clamp)
fn semantic_boost(item_emb: Option<&[f32]>, query_emb: Option<&[f32]>) -> f64 {
    match (item_emb, query_emb) {
        (Some(a), Some(b)) => (1.0 + cosine_similarity_f64(a, b) * 1.5).max(0.5),
        _ => 1.0,
    }
}

/// Estimate token count for a context item.
fn estimate_tokens(key: &str, value: &str) -> usize {
    (key.len() + value.len() + 20) / 4
}

/// Cosine similarity between two f32 vectors.
fn cosine_similarity_f64(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0_f64;
    let mut norm_a = 0.0_f64;
    let mut norm_b = 0.0_f64;
    for (x, y) in a.iter().zip(b.iter()) {
        let xf = *x as f64;
        let yf = *y as f64;
        dot += xf * yf;
        norm_a += xf * xf;
        norm_b += yf * yf;
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < 1e-10 {
        0.0
    } else {
        dot / denom
    }
}

/// Generate an embedding for the query string using the fast provider.
fn generate_query_embedding(query: &str) -> Option<Vec<f32>> {
    let provider = get_fast_provider()?;
    let rt = tokio::runtime::Runtime::new().ok()?;
    match rt.block_on(provider.generate_embedding(query)) {
        Ok(emb) => {
            debug!(query, dim = emb.len(), "Generated query embedding for smart prime");
            Some(emb)
        }
        Err(e) => {
            warn!(query, error = %e, "Failed to generate query embedding");
            None
        }
    }
}

// ============================================================================
// MMR Diversity Re-ranking
// ============================================================================

/// Maximal Marginal Relevance: re-rank items to balance relevance and diversity.
///
/// Items without embeddings are appended after MMR-ranked items in their original score order.
fn apply_mmr(items: Vec<ScoredItem>, lambda: f64) -> Vec<ScoredItem> {
    // Separate items with and without embeddings
    let mut with_emb: Vec<ScoredItem> = Vec::new();
    let mut without_emb: Vec<ScoredItem> = Vec::new();

    for item in items {
        if item.embedding.is_some() {
            with_emb.push(item);
        } else {
            without_emb.push(item);
        }
    }

    if with_emb.is_empty() {
        // No embeddings — return original order (already sorted by score)
        without_emb.extend(with_emb);
        return without_emb;
    }

    // Normalize scores to [0, 1] for MMR
    let max_score = with_emb.iter().map(|s| s.score).fold(f64::NEG_INFINITY, f64::max);
    let min_score = with_emb.iter().map(|s| s.score).fold(f64::INFINITY, f64::min);
    let score_range = (max_score - min_score).max(1e-10);

    let mut selected: Vec<ScoredItem> = Vec::new();
    let mut candidates = with_emb;

    while !candidates.is_empty() {
        let mut best_idx = 0;
        let mut best_mmr = f64::NEG_INFINITY;

        for (i, candidate) in candidates.iter().enumerate() {
            let relevance = (candidate.score - min_score) / score_range;

            // Max similarity to any already-selected item
            let max_sim = if selected.is_empty() {
                0.0
            } else {
                selected
                    .iter()
                    .filter_map(|s| {
                        let c_emb = candidate.embedding.as_deref()?;
                        let s_emb = s.embedding.as_deref()?;
                        Some(cosine_similarity_f64(c_emb, s_emb))
                    })
                    .fold(f64::NEG_INFINITY, f64::max)
                    .max(0.0) // clamp negative similarities
            };

            let mmr = lambda * relevance - (1.0 - lambda) * max_sim;
            if mmr > best_mmr {
                best_mmr = mmr;
                best_idx = i;
            }
        }

        selected.push(candidates.remove(best_idx));
    }

    // Append items without embeddings at the end
    selected.extend(without_emb);
    selected
}

// ============================================================================
// Token Budget Packing
// ============================================================================

/// Greedy packing: include items in rank order that fit within the token budget.
///
/// Uses `continue` (not `break`) so smaller items further down can fill gaps.
fn pack_to_budget(items: Vec<ScoredItem>, budget: usize) -> Vec<ScoredItem> {
    let available = budget.saturating_sub(HEADER_TOKEN_RESERVE);
    let mut used = 0usize;
    let mut packed = Vec::new();

    for item in items {
        if used + item.token_estimate <= available {
            used += item.token_estimate;
            packed.push(item);
        }
        // continue — smaller items may still fit
    }

    packed
}

// ============================================================================
// Smart Output Formatters
// ============================================================================

fn output_smart_json(
    stats: &SmartPrimeStats,
    items: &[ScoredItem],
    active_issues: &[crate::storage::Issue],
    ready_issues: &[crate::storage::Issue],
    all_open: &[crate::storage::Issue],
    memory: &[crate::storage::Memory],
    transcript: &Option<TranscriptBlock>,
    cmd_ref: &[CmdRef],
) -> Result<()> {
    let output = SmartPrimeOutput {
        stats: SmartPrimeStats {
            total_items: stats.total_items,
            selected_items: stats.selected_items,
            tokens_used: stats.tokens_used,
            tokens_budget: stats.tokens_budget,
            embeddings_available: stats.embeddings_available,
            mmr_applied: stats.mmr_applied,
            query_boosted: stats.query_boosted,
        },
        scored_context: items
            .iter()
            .map(|s| ScoredContextEntry {
                key: s.item.key.clone(),
                value: s.item.value.clone(),
                category: s.item.category.clone(),
                priority: s.item.priority.clone(),
                score: (s.score * 100.0).round() / 100.0, // 2 decimal places
                token_estimate: s.token_estimate,
            })
            .collect(),
        issues: IssueBlock {
            active: active_issues.iter().map(to_issue_summary).collect(),
            ready: ready_issues.iter().map(to_issue_summary).collect(),
            total_open: all_open.len(),
        },
        memory: memory
            .iter()
            .take(MEMORY_DISPLAY_LIMIT)
            .map(|m| MemoryEntry {
                key: m.key.clone(),
                value: m.value.clone(),
                category: m.category.clone(),
            })
            .collect(),
        transcript: transcript.clone(),
        command_reference: cmd_ref.to_vec(),
    };
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn output_smart_compact(
    session: &crate::storage::Session,
    git_branch: &Option<String>,
    stats: &SmartPrimeStats,
    items: &[ScoredItem],
    active_issues: &[crate::storage::Issue],
    ready_issues: &[crate::storage::Issue],
    all_open: &[crate::storage::Issue],
    memory: &[crate::storage::Memory],
    transcript: &Option<TranscriptBlock>,
    cmd_ref: &[CmdRef],
) {
    println!("# SaveContext Smart Prime");
    print!("Session: \"{}\" ({})", session.name, session.status);
    if let Some(branch) = git_branch {
        print!(" | Branch: {branch}");
    }
    println!(" | {} items", stats.total_items);
    println!(
        "Budget: {}/{} tokens | {} selected | MMR: {}",
        stats.tokens_used,
        stats.tokens_budget,
        stats.selected_items,
        if stats.mmr_applied { "yes" } else { "no" }
    );
    println!();

    if !items.is_empty() {
        println!("## Context (ranked by relevance)");
        for s in items {
            println!(
                "- [{:.2}] {}: {} [{}/{}]",
                s.score,
                s.item.key,
                truncate(&s.item.value, 100),
                s.item.category,
                s.item.priority
            );
        }
        println!();
    }

    if !active_issues.is_empty() || !ready_issues.is_empty() {
        println!("## Issues ({} open)", all_open.len());
        for issue in active_issues {
            let id = issue.short_id.as_deref().unwrap_or("??");
            println!(
                "- [{}] {} ({}/P{})",
                id, issue.title, issue.status, issue.priority
            );
        }
        for issue in ready_issues.iter().take(5) {
            let id = issue.short_id.as_deref().unwrap_or("??");
            println!("- [{}] {} (ready/P{})", id, issue.title, issue.priority);
        }
        println!();
    }

    if !memory.is_empty() {
        println!("## Memory");
        for item in memory.iter().take(10) {
            println!("- {} [{}]: {}", item.key, item.category, truncate(&item.value, 80));
        }
        println!();
    }

    if let Some(t) = transcript {
        println!("## Recent Transcripts");
        for entry in &t.entries {
            println!("- {}", truncate(&entry.summary, 120));
        }
        println!();
    }

    println!("## Quick Reference");
    for c in cmd_ref {
        println!("- `{}` -- {}", c.cmd, c.desc);
    }
}

#[allow(clippy::too_many_arguments)]
fn output_smart_terminal(
    session: &crate::storage::Session,
    git_branch: &Option<String>,
    git_status: &Option<String>,
    stats: &SmartPrimeStats,
    items: &[ScoredItem],
    active_issues: &[crate::storage::Issue],
    ready_issues: &[crate::storage::Issue],
    all_open: &[crate::storage::Issue],
    memory: &[crate::storage::Memory],
    transcript: &Option<TranscriptBlock>,
    cmd_ref: &[CmdRef],
) {
    use colored::Colorize;

    println!();
    println!(
        "{}",
        "━━━ SaveContext Smart Prime ━━━━━━━━━━━━━━━━━━━━━━━━━━━━".magenta().bold()
    );
    println!();

    // Session
    println!("{}", "Session".cyan().bold());
    println!("  Name:    {}", session.name);
    println!("  Status:  {}", session.status);
    if let Some(branch) = git_branch {
        println!("  Branch:  {}", branch);
    }
    println!();

    // Stats
    println!("{}", "Smart Stats".cyan().bold());
    println!(
        "  Budget:     {}/{} tokens",
        stats.tokens_used, stats.tokens_budget
    );
    println!(
        "  Selected:   {}/{} items",
        stats.selected_items, stats.total_items
    );
    println!(
        "  Embeddings: {}",
        if stats.embeddings_available { "yes" } else { "no" }
    );
    println!("  MMR:        {}", if stats.mmr_applied { "yes" } else { "no" });
    println!(
        "  Query:      {}",
        if stats.query_boosted { "boosted" } else { "none" }
    );
    println!();

    // Git
    if let Some(status) = git_status {
        let lines: Vec<&str> = status.lines().take(10).collect();
        if !lines.is_empty() {
            println!("{}", "Git Changes".cyan().bold());
            for line in &lines {
                println!("  {line}");
            }
            println!();
        }
    }

    // Ranked context items
    if !items.is_empty() {
        println!("{}", "Context (ranked)".yellow().bold());
        for s in items {
            let score_str = format!("[{:.2}]", s.score);
            let meta = format!("[{}/{}]", s.item.category, s.item.priority);
            println!(
                "  {} {} {} {}",
                score_str.yellow(),
                s.item.key.bold(),
                meta.dimmed(),
                truncate(&s.item.value, 60)
            );
        }
        println!();
    }

    // Issues
    if !active_issues.is_empty() || !ready_issues.is_empty() {
        println!(
            "{} ({} open)",
            "Issues".cyan().bold(),
            all_open.len()
        );
        for issue in active_issues {
            let id = issue.short_id.as_deref().unwrap_or("??");
            println!(
                "    {} {} {} {}",
                id.cyan(),
                issue.title,
                format!("[{}]", issue.issue_type).dimmed(),
                format!("P{}", issue.priority).dimmed()
            );
        }
        for issue in ready_issues.iter().take(5) {
            let id = issue.short_id.as_deref().unwrap_or("??");
            println!(
                "    {} {} {} {}",
                id.dimmed(),
                issue.title,
                format!("[{}]", issue.issue_type).dimmed(),
                format!("P{}", issue.priority).dimmed()
            );
        }
        println!();
    }

    // Memory
    if !memory.is_empty() {
        println!("{}", "Project Memory".cyan().bold());
        for item in memory.iter().take(10) {
            println!(
                "  {} {} {}",
                item.key.bold(),
                format!("[{}]", item.category).dimmed(),
                truncate(&item.value, 60)
            );
        }
        println!();
    }

    // Transcript
    if let Some(t) = transcript {
        println!("{}", "Recent Transcripts".magenta().bold());
        for entry in &t.entries {
            if let Some(ts) = &entry.timestamp {
                println!("  {} {}", ts.dimmed(), truncate(&entry.summary, 100));
            } else {
                println!("  {}", truncate(&entry.summary, 100));
            }
        }
        println!();
    }

    // Command reference
    println!("{}", "Quick Reference".dimmed().bold());
    for c in cmd_ref {
        println!("  {} {}", c.cmd.cyan(), format!("# {}", c.desc).dimmed());
    }
    println!();
    println!(
        "{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".magenta()
    );
    println!();
}

// ============================================================================
// Transcript Parsing
// ============================================================================

/// Parse Claude Code transcript files for conversation summaries.
///
/// Claude Code stores session transcripts at:
///   `~/.claude/projects/<encoded-path>/<uuid>.jsonl`
///
/// Where `<encoded-path>` replaces `/` with `-` in the project path.
/// Each line is a JSON object; lines with `"type": "summary"` contain
/// conversation summaries from previous sessions.
fn parse_claude_transcripts(project_path: &str, limit: usize) -> Option<TranscriptBlock> {
    let home = directories::BaseDirs::new()?.home_dir().to_path_buf();
    let encoded_path = encode_project_path(project_path);
    let transcript_dir = home.join(".claude").join("projects").join(&encoded_path);

    if !transcript_dir.exists() {
        return None;
    }

    // Find .jsonl files, sorted by modification time (most recent first)
    let mut jsonl_files: Vec<_> = fs::read_dir(&transcript_dir)
        .ok()?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                let modified = entry.metadata().ok()?.modified().ok()?;
                Some((path, modified))
            } else {
                None
            }
        })
        .collect();

    jsonl_files.sort_by(|a, b| b.1.cmp(&a.1));

    let mut entries = Vec::new();

    // Scan files from most recent, collecting summary entries
    for (path, _) in &jsonl_files {
        if entries.len() >= limit {
            break;
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for line in content.lines().rev() {
            if entries.len() >= limit {
                break;
            }

            let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };

            // Look for summary entries
            if val.get("type").and_then(|t| t.as_str()) == Some("summary") {
                if let Some(summary) = val.get("summary").and_then(|s| s.as_str()) {
                    let timestamp = val
                        .get("timestamp")
                        .and_then(|t| t.as_str())
                        .map(ToString::to_string);
                    entries.push(TranscriptEntry {
                        summary: truncate(summary, 500),
                        timestamp,
                    });
                }
            }
        }
    }

    if entries.is_empty() {
        return None;
    }

    Some(TranscriptBlock {
        source: transcript_dir.to_string_lossy().to_string(),
        entries,
    })
}

/// Encode a project path for Claude Code's directory naming.
///
/// Replaces `/` with `-` to match Claude Code's convention:
///   `/Users/shane/code/project` → `-Users-shane-code-project`
fn encode_project_path(path: &str) -> String {
    path.replace('/', "-")
}

// ============================================================================
// Command Reference
// ============================================================================

fn build_command_reference() -> Vec<CmdRef> {
    vec![
        CmdRef {
            cmd: "sc save <key> <value> -c <cat> -p <pri>".into(),
            desc: "Save context item".into(),
        },
        CmdRef {
            cmd: "sc get -s <query>".into(),
            desc: "Search context items".into(),
        },
        CmdRef {
            cmd: "sc issue create <title> -t <type> -p <pri>".into(),
            desc: "Create issue".into(),
        },
        CmdRef {
            cmd: "sc issue list -s <status>".into(),
            desc: "List issues".into(),
        },
        CmdRef {
            cmd: "sc issue complete <id>".into(),
            desc: "Complete issue".into(),
        },
        CmdRef {
            cmd: "sc issue claim <id>".into(),
            desc: "Claim issue".into(),
        },
        CmdRef {
            cmd: "sc status".into(),
            desc: "Show session status".into(),
        },
        CmdRef {
            cmd: "sc checkpoint create <name>".into(),
            desc: "Create checkpoint".into(),
        },
        CmdRef {
            cmd: "sc memory save <key> <value>".into(),
            desc: "Save project memory".into(),
        },
        CmdRef {
            cmd: "sc compaction".into(),
            desc: "Prepare for context compaction".into(),
        },
    ]
}

// ============================================================================
// Converters
// ============================================================================

fn to_context_entry(item: &crate::storage::ContextItem) -> ContextEntry {
    ContextEntry {
        key: item.key.clone(),
        value: item.value.clone(),
        category: item.category.clone(),
        priority: item.priority.clone(),
    }
}

fn to_issue_summary(issue: &crate::storage::Issue) -> IssueSummary {
    IssueSummary {
        short_id: issue.short_id.clone(),
        title: issue.title.clone(),
        status: issue.status.clone(),
        priority: issue.priority,
        issue_type: issue.issue_type.clone(),
    }
}

// ============================================================================
// Human-Readable Output (Full)
// ============================================================================

#[allow(clippy::too_many_arguments)]
fn print_full(
    session: &crate::storage::Session,
    git_branch: &Option<String>,
    git_status: &Option<String>,
    high_priority: &[crate::storage::ContextItem],
    decisions: &[crate::storage::ContextItem],
    reminders: &[crate::storage::ContextItem],
    progress: &[crate::storage::ContextItem],
    active_issues: &[crate::storage::Issue],
    ready_issues: &[crate::storage::Issue],
    all_open: &[crate::storage::Issue],
    memory: &[crate::storage::Memory],
    transcript: &Option<TranscriptBlock>,
    total_items: usize,
    cmd_ref: &[CmdRef],
) {
    use colored::Colorize;

    println!();
    println!(
        "{}",
        "━━━ SaveContext Prime ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".magenta().bold()
    );
    println!();

    // Session
    println!("{}", "Session".cyan().bold());
    println!("  Name:    {}", session.name);
    if let Some(desc) = &session.description {
        println!("  Desc:    {}", desc);
    }
    println!("  Status:  {}", session.status);
    if let Some(branch) = git_branch {
        println!("  Branch:  {}", branch);
    }
    println!("  Items:   {total_items}");
    println!();

    // Git
    if let Some(status) = git_status {
        let lines: Vec<&str> = status.lines().take(10).collect();
        if !lines.is_empty() {
            println!("{}", "Git Changes".cyan().bold());
            for line in &lines {
                println!("  {line}");
            }
            println!();
        }
    }

    // High priority
    if !high_priority.is_empty() {
        println!("{}", "High Priority".red().bold());
        for item in high_priority.iter().take(5) {
            println!(
                "  {} {} {}",
                "•".red(),
                item.key,
                format!("[{}]", item.category).dimmed()
            );
            println!("    {}", truncate(&item.value, 80));
        }
        println!();
    }

    // Decisions
    if !decisions.is_empty() {
        println!("{}", "Key Decisions".yellow().bold());
        for item in decisions.iter().take(5) {
            println!("  {} {}", "•".yellow(), item.key);
            println!("    {}", truncate(&item.value, 80));
        }
        println!();
    }

    // Reminders
    if !reminders.is_empty() {
        println!("{}", "Reminders".blue().bold());
        for item in reminders.iter().take(5) {
            println!("  {} {}", "•".blue(), item.key);
            println!("    {}", truncate(&item.value, 80));
        }
        println!();
    }

    // Progress
    if !progress.is_empty() {
        println!("{}", "Recent Progress".green().bold());
        for item in progress {
            println!("  {} {}", "✓".green(), item.key);
            println!("    {}", truncate(&item.value, 80));
        }
        println!();
    }

    // Issues
    if !active_issues.is_empty() || !ready_issues.is_empty() {
        println!(
            "{} ({} open)",
            "Issues".cyan().bold(),
            all_open.len()
        );

        if !active_issues.is_empty() {
            println!("  {}", "In Progress:".bold());
            for issue in active_issues {
                let id = issue.short_id.as_deref().unwrap_or("??");
                println!(
                    "    {} {} {} {}",
                    id.cyan(),
                    issue.title,
                    format!("[{}]", issue.issue_type).dimmed(),
                    format!("P{}", issue.priority).dimmed()
                );
            }
        }

        if !ready_issues.is_empty() {
            println!("  {}", "Ready:".bold());
            for issue in ready_issues.iter().take(5) {
                let id = issue.short_id.as_deref().unwrap_or("??");
                println!(
                    "    {} {} {} {}",
                    id.dimmed(),
                    issue.title,
                    format!("[{}]", issue.issue_type).dimmed(),
                    format!("P{}", issue.priority).dimmed()
                );
            }
        }
        println!();
    }

    // Memory
    if !memory.is_empty() {
        println!("{}", "Project Memory".cyan().bold());
        for item in memory.iter().take(10) {
            println!(
                "  {} {} {}",
                item.key.bold(),
                format!("[{}]", item.category).dimmed(),
                truncate(&item.value, 60)
            );
        }
        println!();
    }

    // Transcript
    if let Some(t) = transcript {
        println!("{}", "Recent Transcripts".magenta().bold());
        for entry in &t.entries {
            if let Some(ts) = &entry.timestamp {
                println!("  {} {}", ts.dimmed(), truncate(&entry.summary, 100));
            } else {
                println!("  {}", truncate(&entry.summary, 100));
            }
        }
        println!();
    }

    // Command reference
    println!("{}", "Quick Reference".dimmed().bold());
    for c in cmd_ref {
        println!("  {} {}", c.cmd.cyan(), format!("# {}", c.desc).dimmed());
    }
    println!();
    println!(
        "{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".magenta()
    );
    println!();
}

// ============================================================================
// Human-Readable Output (Compact — for agent injection)
// ============================================================================

#[allow(clippy::too_many_arguments)]
fn print_compact(
    session: &crate::storage::Session,
    git_branch: &Option<String>,
    _git_status: &Option<String>,
    high_priority: &[crate::storage::ContextItem],
    decisions: &[crate::storage::ContextItem],
    reminders: &[crate::storage::ContextItem],
    _progress: &[crate::storage::ContextItem],
    active_issues: &[crate::storage::Issue],
    ready_issues: &[crate::storage::Issue],
    all_open: &[crate::storage::Issue],
    memory: &[crate::storage::Memory],
    transcript: &Option<TranscriptBlock>,
    total_items: usize,
    cmd_ref: &[CmdRef],
) {
    // Compact markdown format for direct agent injection
    println!("# SaveContext Prime");
    print!("Session: \"{}\" ({})", session.name, session.status);
    if let Some(branch) = git_branch {
        print!(" | Branch: {branch}");
    }
    println!(" | {total_items} context items");
    println!();

    if !high_priority.is_empty() {
        println!("## High Priority");
        for item in high_priority.iter().take(5) {
            println!(
                "- {}: {} [{}]",
                item.key,
                truncate(&item.value, 100),
                item.category
            );
        }
        println!();
    }

    if !decisions.is_empty() {
        println!("## Decisions");
        for item in decisions.iter().take(5) {
            println!("- {}: {}", item.key, truncate(&item.value, 100));
        }
        println!();
    }

    if !reminders.is_empty() {
        println!("## Reminders");
        for item in reminders.iter().take(5) {
            println!("- {}: {}", item.key, truncate(&item.value, 100));
        }
        println!();
    }

    if !active_issues.is_empty() || !ready_issues.is_empty() {
        println!("## Issues ({} open)", all_open.len());
        for issue in active_issues {
            let id = issue.short_id.as_deref().unwrap_or("??");
            println!(
                "- [{}] {} ({}/P{})",
                id, issue.title, issue.status, issue.priority
            );
        }
        for issue in ready_issues.iter().take(5) {
            let id = issue.short_id.as_deref().unwrap_or("??");
            println!("- [{}] {} (ready/P{})", id, issue.title, issue.priority);
        }
        println!();
    }

    if !memory.is_empty() {
        println!("## Memory");
        for item in memory.iter().take(10) {
            println!("- {} [{}]: {}", item.key, item.category, truncate(&item.value, 80));
        }
        println!();
    }

    if let Some(t) = transcript {
        println!("## Recent Transcripts");
        for entry in &t.entries {
            println!("- {}", truncate(&entry.summary, 120));
        }
        println!();
    }

    println!("## Quick Reference");
    for c in cmd_ref {
        println!("- `{}` — {}", c.cmd, c.desc);
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Get current git status output.
fn get_git_status() -> Option<String> {
    std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
}

/// Truncate a string to max length with ellipsis.
fn truncate(s: &str, max_len: usize) -> String {
    // Work on first line only to avoid multi-line blowup
    let first_line = s.lines().next().unwrap_or(s);
    if first_line.len() <= max_len {
        first_line.to_string()
    } else {
        format!("{}...", &first_line[..max_len.saturating_sub(3)])
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_temporal_decay_now() {
        let now = 1_700_000_000_000i64;
        assert!((temporal_decay(now, now, 14.0) - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_temporal_decay_half_life() {
        let now = 1_700_000_000_000i64;
        let fourteen_days_ago = now - 14 * 86_400_000;
        let decay = temporal_decay(fourteen_days_ago, now, 14.0);
        assert!((decay - 0.5).abs() < 0.01, "Expected ~0.5, got {decay}");
    }

    #[test]
    fn test_temporal_decay_double_half_life() {
        let now = 1_700_000_000_000i64;
        let twenty_eight_days_ago = now - 28 * 86_400_000;
        let decay = temporal_decay(twenty_eight_days_ago, now, 14.0);
        assert!((decay - 0.25).abs() < 0.01, "Expected ~0.25, got {decay}");
    }

    #[test]
    fn test_temporal_decay_future_item() {
        let now = 1_700_000_000_000i64;
        // Item from the future should return 1.0
        assert!((temporal_decay(now + 1000, now, 14.0) - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_priority_weight_values() {
        assert!((priority_weight("high") - 3.0).abs() < 1e-10);
        assert!((priority_weight("normal") - 1.0).abs() < 1e-10);
        assert!((priority_weight("low") - 0.5).abs() < 1e-10);
        assert!((priority_weight("unknown") - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_category_weight_values() {
        assert!((category_weight("decision") - 2.0).abs() < 1e-10);
        assert!((category_weight("reminder") - 1.5).abs() < 1e-10);
        assert!((category_weight("progress") - 1.0).abs() < 1e-10);
        assert!((category_weight("note") - 0.5).abs() < 1e-10);
        assert!((category_weight("other") - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_semantic_boost_no_embeddings() {
        assert!((semantic_boost(None, None) - 1.0).abs() < 1e-10);
        assert!((semantic_boost(Some(&[1.0, 0.0]), None) - 1.0).abs() < 1e-10);
        assert!((semantic_boost(None, Some(&[1.0, 0.0])) - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_semantic_boost_identical() {
        let emb = vec![1.0, 0.0, 0.0];
        let boost = semantic_boost(Some(&emb), Some(&emb));
        // cos_sim = 1.0, boost = 1.0 + 1.0 * 1.5 = 2.5
        assert!((boost - 2.5).abs() < 0.01, "Expected 2.5, got {boost}");
    }

    #[test]
    fn test_semantic_boost_orthogonal() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let boost = semantic_boost(Some(&a), Some(&b));
        // cos_sim = 0.0, boost = 1.0
        assert!((boost - 1.0).abs() < 0.01, "Expected 1.0, got {boost}");
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let v = vec![1.0f32, 2.0, 3.0];
        let sim = cosine_similarity_f64(&v, &v);
        assert!((sim - 1.0).abs() < 1e-6, "Expected 1.0, got {sim}");
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0f32, 0.0];
        let b = vec![0.0f32, 1.0];
        let sim = cosine_similarity_f64(&a, &b);
        assert!(sim.abs() < 1e-6, "Expected 0.0, got {sim}");
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let a = vec![1.0f32, 0.0];
        let b = vec![-1.0f32, 0.0];
        let sim = cosine_similarity_f64(&a, &b);
        assert!((sim - (-1.0)).abs() < 1e-6, "Expected -1.0, got {sim}");
    }

    #[test]
    fn test_cosine_similarity_empty() {
        let sim = cosine_similarity_f64(&[], &[]);
        assert!((sim - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_cosine_similarity_mismatched_length() {
        let a = vec![1.0f32, 2.0];
        let b = vec![1.0f32];
        assert!((cosine_similarity_f64(&a, &b) - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_estimate_tokens() {
        // (3 + 5 + 20) / 4 = 7
        assert_eq!(estimate_tokens("key", "value"), 7);
        // (0 + 0 + 20) / 4 = 5
        assert_eq!(estimate_tokens("", ""), 5);
    }

    fn make_scored_item(key: &str, value: &str, score: f64, embedding: Option<Vec<f32>>) -> ScoredItem {
        ScoredItem {
            item: ContextItem {
                id: format!("id_{key}"),
                session_id: "sess_test".to_string(),
                key: key.to_string(),
                value: value.to_string(),
                category: "note".to_string(),
                priority: "normal".to_string(),
                channel: None,
                tags: None,
                size: value.len() as i64,
                created_at: 0,
                updated_at: 0,
            },
            score,
            token_estimate: estimate_tokens(key, value),
            embedding,
        }
    }

    #[test]
    fn test_pack_to_budget_all_fit() {
        let items = vec![
            make_scored_item("a", "short", 3.0, None),
            make_scored_item("b", "also short", 2.0, None),
        ];
        let packed = pack_to_budget(items, 4000);
        assert_eq!(packed.len(), 2);
    }

    #[test]
    fn test_pack_to_budget_overflow() {
        // Create items that exceed budget
        let big_value = "x".repeat(4000);
        let items = vec![
            make_scored_item("a", &big_value, 3.0, None),
            make_scored_item("b", "fits", 2.0, None),
        ];
        let packed = pack_to_budget(items, 500);
        // Big item won't fit, but small item should
        assert_eq!(packed.len(), 1);
        assert_eq!(packed[0].item.key, "b");
    }

    #[test]
    fn test_pack_to_budget_empty() {
        let packed = pack_to_budget(vec![], 4000);
        assert!(packed.is_empty());
    }

    #[test]
    fn test_mmr_no_embeddings() {
        let items = vec![
            make_scored_item("a", "one", 3.0, None),
            make_scored_item("b", "two", 2.0, None),
        ];
        let result = apply_mmr(items, 0.7);
        // Without embeddings, should preserve order
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].item.key, "a");
        assert_eq!(result[1].item.key, "b");
    }

    #[test]
    fn test_mmr_with_embeddings_preserves_count() {
        let items = vec![
            make_scored_item("a", "one", 3.0, Some(vec![1.0, 0.0, 0.0])),
            make_scored_item("b", "two", 2.0, Some(vec![0.0, 1.0, 0.0])),
            make_scored_item("c", "three", 1.0, Some(vec![0.0, 0.0, 1.0])),
        ];
        let result = apply_mmr(items, 0.7);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_mmr_diverse_items_keep_order() {
        // Three orthogonal items — diversity doesn't change relevance order
        let items = vec![
            make_scored_item("a", "one", 3.0, Some(vec![1.0, 0.0, 0.0])),
            make_scored_item("b", "two", 2.0, Some(vec![0.0, 1.0, 0.0])),
            make_scored_item("c", "three", 1.0, Some(vec![0.0, 0.0, 1.0])),
        ];
        let result = apply_mmr(items, 0.7);
        assert_eq!(result[0].item.key, "a");
    }

    #[test]
    fn test_mmr_penalizes_duplicates() {
        // "b" is a near-duplicate of "a" (same embedding), "c" is diverse
        // Scores are close enough that diversity penalty should flip the order
        let items = vec![
            make_scored_item("a", "one", 3.0, Some(vec![1.0, 0.0])),
            make_scored_item("b", "two", 2.5, Some(vec![1.0, 0.0])), // near-dup of a
            make_scored_item("c", "three", 2.5, Some(vec![0.0, 1.0])), // diverse, same score
        ];
        let result = apply_mmr(items, 0.7);
        // After "a" is selected, "c" should rank above "b" due to diversity
        // Both have same relevance, but "b" has max_sim=1.0 to "a" while "c" has 0.0
        assert_eq!(result[0].item.key, "a");
        assert_eq!(result[1].item.key, "c", "Diverse item should rank above near-duplicate");
    }

    #[test]
    fn test_mmr_mixed_embeddings() {
        // Items with and without embeddings
        let items = vec![
            make_scored_item("a", "one", 3.0, Some(vec![1.0, 0.0])),
            make_scored_item("b", "two", 2.0, None), // no embedding
            make_scored_item("c", "three", 1.0, Some(vec![0.0, 1.0])),
        ];
        let result = apply_mmr(items, 0.7);
        assert_eq!(result.len(), 3);
        // Items without embeddings go at the end
        assert_eq!(result[2].item.key, "b");
    }
}
