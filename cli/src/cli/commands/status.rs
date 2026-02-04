//! Status command implementation.

use crate::config::{current_git_branch, resolve_db_path, resolve_session_id};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;

/// Output for status command.
#[derive(Serialize)]
struct StatusOutput {
    session: Option<SessionInfo>,
    project_path: Option<String>,
    git_branch: Option<String>,
    item_count: usize,
    high_priority_count: usize,
    categories: CategoryBreakdown,
}

#[derive(Serialize)]
struct SessionInfo {
    id: String,
    name: String,
    status: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize)]
struct CategoryBreakdown {
    reminder: usize,
    decision: usize,
    progress: usize,
    note: usize,
}

/// Execute status command.
///
/// If `session_id` is provided (from MCP bridge), looks up that specific session.
/// Otherwise falls back to finding an active session for the current project path.
pub fn execute(db_path: Option<&PathBuf>, session_id: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;
    let git_branch = current_git_branch();

    // Resolve session via TTY-keyed status cache (soft — no error if missing)
    let session = match resolve_session_id(session_id) {
        Ok(sid) => storage.get_session(&sid)?,
        Err(_) => None,
    };

    // Use the session's project_path for the output
    let project_path = session.as_ref()
        .and_then(|s| s.project_path.clone());

    let (item_count, high_priority_count, categories) = if let Some(ref s) = session {
        // Get all items for the session
        let items = storage.get_context_items(&s.id, None, None, Some(1000))?;

        let high = items.iter().filter(|i| i.priority == "high").count();
        let reminder = items.iter().filter(|i| i.category == "reminder").count();
        let decision = items.iter().filter(|i| i.category == "decision").count();
        let progress = items.iter().filter(|i| i.category == "progress").count();
        let note = items.iter().filter(|i| i.category == "note").count();

        (
            items.len(),
            high,
            CategoryBreakdown {
                reminder,
                decision,
                progress,
                note,
            },
        )
    } else {
        (
            0,
            0,
            CategoryBreakdown {
                reminder: 0,
                decision: 0,
                progress: 0,
                note: 0,
            },
        )
    };

    if json {
        let output = StatusOutput {
            session: session.map(|s| SessionInfo {
                id: s.id.clone(),
                name: s.name.clone(),
                status: s.status.clone(),
                created_at: s.created_at,
                updated_at: s.updated_at,
            }),
            project_path,
            git_branch: git_branch.clone(),
            item_count,
            high_priority_count,
            categories,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("SaveContext Status");
        println!("==================");
        println!();

        if let Some(ref path) = project_path {
            println!("Project: {path}");
        }
        if let Some(ref branch) = git_branch {
            println!("Branch:  {branch}");
        }
        println!();

        if let Some(ref s) = session {
            println!("Active Session: {}", s.name);
            println!("  ID: {}", s.id);
            println!("  Status: {}", s.status);
            println!();
            println!("Context Items: {item_count}");
            if high_priority_count > 0 {
                println!("  High Priority: {high_priority_count}");
            }
            println!("  Reminders: {}", categories.reminder);
            println!("  Decisions: {}", categories.decision);
            println!("  Progress:  {}", categories.progress);
            println!("  Notes:     {}", categories.note);
        } else {
            println!("No active session.");
            println!();
            println!("Start one with: sc session start \"Session Name\"");
        }
    }

    Ok(())
}
