//! Compaction command implementation.
//!
//! Prepares context for compaction by creating an auto-checkpoint
//! and returning a summary of critical context items.

use crate::config::{
    current_git_branch, default_actor, resolve_db_path, resolve_session_or_suggest,
};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;

/// Limits for compaction context items (matching MCP server)
const HIGH_PRIORITY_LIMIT: u32 = 50;
const DECISION_LIMIT: u32 = 20;
const REMINDER_LIMIT: u32 = 20;
const PROGRESS_LIMIT: u32 = 10;

/// Output for compaction command.
#[derive(Serialize)]
struct CompactionOutput {
    checkpoint: CheckpointInfo,
    stats: CompactionStats,
    git_context: Option<GitContext>,
    critical_context: CriticalContext,
    restore_instructions: RestoreInstructions,
}

#[derive(Serialize)]
struct CheckpointInfo {
    id: String,
    name: String,
    session_id: String,
    created_at: i64,
}

#[derive(Serialize)]
struct CompactionStats {
    total_items_saved: i64,
    critical_items: usize,
    pending_tasks: usize,
    decisions_made: usize,
}

#[derive(Serialize)]
struct GitContext {
    branch: String,
    files: Vec<String>,
}

#[derive(Serialize)]
struct CriticalContext {
    high_priority_items: Vec<ContextSummary>,
    next_steps: Vec<ContextSummary>,
    key_decisions: Vec<ContextSummary>,
    recent_progress: Vec<ContextSummary>,
}

#[derive(Serialize)]
struct ContextSummary {
    key: String,
    value: String,
    category: String,
    priority: String,
}

#[derive(Serialize)]
struct RestoreInstructions {
    tool: String,
    checkpoint_id: String,
    message: String,
    summary: String,
}

/// Execute compaction command.
pub fn execute(db_path: Option<&PathBuf>, actor: Option<&str>, session_id: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    let sid = resolve_session_or_suggest(session_id, &storage)?;
    let session = storage
        .get_session(&sid)?
        .ok_or_else(|| Error::SessionNotFound { id: sid })?;

    // Generate checkpoint name with timestamp
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let checkpoint_name = format!("pre-compact-{timestamp}");

    // Get git info
    let git_branch = current_git_branch();
    let git_status = get_git_status();

    // Generate checkpoint ID
    let checkpoint_id = format!("ckpt_{}", &uuid::Uuid::new_v4().to_string()[..12]);

    // Create checkpoint
    storage.create_checkpoint(
        &checkpoint_id,
        &session.id,
        &checkpoint_name,
        Some("Automatic checkpoint before context compaction"),
        git_status.as_deref(),
        git_branch.as_deref(),
        &actor,
    )?;

    // Get current context items to include in checkpoint
    let all_items = storage.get_context_items(&session.id, None, None, Some(1000))?;
    for item in &all_items {
        storage.add_checkpoint_item(&checkpoint_id, &item.id, &actor)?;
    }

    // Analyze critical context
    let high_priority_items =
        storage.get_context_items(&session.id, None, Some("high"), Some(HIGH_PRIORITY_LIMIT))?;

    let reminders =
        storage.get_context_items(&session.id, Some("reminder"), None, Some(REMINDER_LIMIT))?;

    let decisions =
        storage.get_context_items(&session.id, Some("decision"), None, Some(DECISION_LIMIT))?;

    let progress =
        storage.get_context_items(&session.id, Some("progress"), None, Some(PROGRESS_LIMIT))?;

    // Identify unfinished reminders (next steps)
    let next_steps: Vec<_> = reminders
        .iter()
        .filter(|t| {
            let lower = t.value.to_lowercase();
            !lower.contains("completed")
                && !lower.contains("done")
                && !lower.contains("[completed]")
        })
        .take(5)
        .collect();

    // Get checkpoint for stats
    let checkpoint = storage
        .get_checkpoint(&checkpoint_id)?
        .ok_or_else(|| Error::CheckpointNotFound {
            id: checkpoint_id.clone(),
        })?;

    // Parse git status for file list
    let git_files: Vec<String> = git_status
        .as_ref()
        .map(|s| {
            s.lines()
                .take(10)
                .map(|line| line.trim().to_string())
                .collect()
        })
        .unwrap_or_default();

    if json {
        let output = CompactionOutput {
            checkpoint: CheckpointInfo {
                id: checkpoint.id.clone(),
                name: checkpoint.name.clone(),
                session_id: session.id.clone(),
                created_at: checkpoint.created_at,
            },
            stats: CompactionStats {
                total_items_saved: checkpoint.item_count,
                critical_items: high_priority_items.len(),
                pending_tasks: next_steps.len(),
                decisions_made: decisions.len(),
            },
            git_context: git_branch.as_ref().map(|branch| GitContext {
                branch: branch.clone(),
                files: git_files.clone(),
            }),
            critical_context: CriticalContext {
                high_priority_items: high_priority_items
                    .iter()
                    .take(5)
                    .map(|i| ContextSummary {
                        key: i.key.clone(),
                        value: i.value.clone(),
                        category: i.category.clone(),
                        priority: i.priority.clone(),
                    })
                    .collect(),
                next_steps: next_steps
                    .iter()
                    .map(|t| ContextSummary {
                        key: t.key.clone(),
                        value: t.value.clone(),
                        category: t.category.clone(),
                        priority: t.priority.clone(),
                    })
                    .collect(),
                key_decisions: decisions
                    .iter()
                    .take(10)
                    .map(|d| ContextSummary {
                        key: d.key.clone(),
                        value: d.value.clone(),
                        category: d.category.clone(),
                        priority: d.priority.clone(),
                    })
                    .collect(),
                recent_progress: progress
                    .iter()
                    .take(3)
                    .map(|p| ContextSummary {
                        key: p.key.clone(),
                        value: p.value.clone(),
                        category: p.category.clone(),
                        priority: p.priority.clone(),
                    })
                    .collect(),
            },
            restore_instructions: RestoreInstructions {
                tool: "sc checkpoint restore".to_string(),
                checkpoint_id: checkpoint.id.clone(),
                message: format!(
                    "To continue this session, restore from checkpoint: {}",
                    checkpoint.name
                ),
                summary: format!(
                    "Session has {} pending tasks and {} key decisions recorded.",
                    next_steps.len(),
                    decisions.len()
                ),
            },
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Context Compaction Prepared");
        println!("===========================");
        println!();
        println!("Checkpoint: {}", checkpoint.name);
        println!("  ID: {}", checkpoint.id);
        println!("  Items saved: {}", checkpoint.item_count);
        println!();

        if let Some(ref branch) = git_branch {
            println!("Git Context:");
            println!("  Branch: {branch}");
            if !git_files.is_empty() {
                println!("  Changes:");
                for file in git_files.iter().take(5) {
                    println!("    {file}");
                }
            }
            println!();
        }

        println!("Critical Context:");
        println!(
            "  High priority items: {}",
            high_priority_items.len().min(5)
        );
        println!("  Pending tasks: {}", next_steps.len());
        println!("  Key decisions: {}", decisions.len().min(10));
        println!("  Recent progress: {}", progress.len().min(3));
        println!();

        if !next_steps.is_empty() {
            println!("Next Steps:");
            for step in next_steps.iter().take(3) {
                println!("  - {} ({})", step.key, truncate(&step.value, 60));
            }
            println!();
        }

        if !decisions.is_empty() {
            println!("Key Decisions:");
            for decision in decisions.iter().take(3) {
                println!("  - {} ({})", decision.key, truncate(&decision.value, 60));
            }
            println!();
        }

        println!("Restore Instructions:");
        println!("  sc checkpoint restore {}", checkpoint.id);
    }

    Ok(())
}

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
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}
