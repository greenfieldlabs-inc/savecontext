//! Session command implementations.

use crate::cli::SessionCommands;
use crate::config::{
    bind_session_to_terminal, clear_status_cache, current_git_branch, current_project_path,
    default_actor, resolve_db_path, resolve_session_or_suggest,
};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;

/// Output for session list command.
#[derive(Serialize)]
struct SessionListOutput {
    sessions: Vec<crate::storage::Session>,
    count: usize,
}

/// Execute session commands.
///
/// # Errors
///
/// Returns an error if the database operation fails.
pub fn execute(
    command: &SessionCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    session_id: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or_else(|| Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let actor = actor
        .map(ToString::to_string)
        .unwrap_or_else(default_actor);

    match command {
        SessionCommands::Start {
            name,
            description,
            project,
            channel,
            force_new,
        } => start(
            &db_path,
            name,
            description.as_deref(),
            project.as_deref(),
            channel.as_deref(),
            *force_new,
            &actor,
            json,
        ),
        SessionCommands::End => end(&db_path, session_id, &actor, json),
        SessionCommands::Pause => pause(&db_path, session_id, &actor, json),
        SessionCommands::Resume { id } => resume(&db_path, id, &actor, json),
        SessionCommands::List {
            status,
            limit,
            search,
            project,
            all_projects,
            include_completed,
        } => list(
            &db_path,
            status,
            *limit,
            search.as_deref(),
            project.as_deref(),
            *all_projects,
            *include_completed,
            json,
        ),
        SessionCommands::Switch { id } => switch(&db_path, id, &actor, json),
        SessionCommands::Rename { name } => rename(&db_path, session_id, name, &actor, json),
        SessionCommands::Delete { id, force } => delete(&db_path, id, *force, &actor, json),
        SessionCommands::AddPath { id, path } => {
            add_path(&db_path, id.as_deref(), path.as_deref(), &actor, json)
        }
        SessionCommands::RemovePath { id, path } => {
            remove_path(&db_path, id.as_deref(), path, &actor, json)
        }
    }
}

/// Start a new session.
fn start(
    db_path: &PathBuf,
    name: &str,
    description: Option<&str>,
    project: Option<&str>,
    channel: Option<&str>,
    force_new: bool,
    actor: &str,
    json: bool,
) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    // Use provided project path or fall back to current directory
    let project_path = match project {
        Some(p) => {
            // Canonicalize if possible for consistent paths
            std::path::PathBuf::from(p)
                .canonicalize()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| p.to_string())
        }
        None => current_project_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string()),
    };
    let branch = current_git_branch();

    // Use provided channel or derive from git branch
    let resolved_channel = channel
        .map(ToString::to_string)
        .or_else(|| branch.clone());

    // Check for existing session to resume (unless force_new)
    if !force_new {
        // Look for a session with matching name + project that can be resumed
        let existing = storage.list_sessions(Some(&project_path), Some("paused"), Some(10))?;
        if let Some(session) = existing.iter().find(|s| s.name == name) {
            // Resume the existing session
            storage.update_session_status(&session.id, "active", actor)?;

            // Bind terminal to this session
            bind_session_to_terminal(&session.id, &session.name, &project_path, "active");

            if crate::is_silent() {
                println!("{}", session.id);
                return Ok(());
            }

            if json {
                let output = serde_json::json!({
                    "id": session.id,
                    "name": session.name,
                    "status": "active",
                    "project_path": session.project_path,
                    "branch": branch,
                    "resumed": true
                });
                println!("{output}");
            } else {
                println!("Resumed session: {name}");
                println!("  ID: {}", session.id);
                println!("  Project: {project_path}");
                if let Some(ref branch) = branch {
                    println!("  Branch: {branch}");
                }
            }
            return Ok(());
        }
    }

    // Generate session ID
    let id = format!("sess_{}", &uuid::Uuid::new_v4().to_string()[..12]);

    storage.create_session(
        &id,
        name,
        description,
        Some(&project_path),
        resolved_channel.as_deref(),
        actor,
    )?;

    // Bind terminal to new session
    bind_session_to_terminal(&id, name, &project_path, "active");

    if crate::is_silent() {
        println!("{id}");
        return Ok(());
    }

    if json {
        let output = serde_json::json!({
            "id": id,
            "name": name,
            "status": "active",
            "project_path": project_path,
            "branch": branch,
            "resumed": false
        });
        println!("{output}");
    } else {
        println!("Started session: {name}");
        println!("  ID: {id}");
        println!("  Project: {project_path}");
        if let Some(ref branch) = branch {
            println!("  Branch: {branch}");
        }
    }

    Ok(())
}

/// End (complete) the current session.
fn end(db_path: &PathBuf, session_id: Option<&str>, actor: &str, json: bool) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    let sid = resolve_session_or_suggest(session_id, &storage)?;
    let session = storage
        .get_session(&sid)?
        .ok_or_else(|| Error::SessionNotFound { id: sid })?;

    storage.update_session_status(&session.id, "completed", actor)?;

    // Unbind terminal from this session
    clear_status_cache();

    if json {
        let output = serde_json::json!({
            "id": session.id,
            "name": session.name,
            "status": "completed"
        });
        println!("{output}");
    } else {
        println!("Completed session: {}", session.name);
    }

    Ok(())
}

/// Pause the current session.
fn pause(db_path: &PathBuf, session_id: Option<&str>, actor: &str, json: bool) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    let sid = resolve_session_or_suggest(session_id, &storage)?;
    let session = storage
        .get_session(&sid)?
        .ok_or_else(|| Error::SessionNotFound { id: sid })?;

    storage.update_session_status(&session.id, "paused", actor)?;

    // Unbind terminal from this session
    clear_status_cache();

    if json {
        let output = serde_json::json!({
            "id": session.id,
            "name": session.name,
            "status": "paused"
        });
        println!("{output}");
    } else {
        println!("Paused session: {}", session.name);
    }

    Ok(())
}

/// Resume a paused, completed, or even active session.
/// Active sessions are allowed because the user may be resuming in a new terminal instance.
fn resume(db_path: &PathBuf, id: &str, actor: &str, json: bool) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    // Get the session to verify it exists
    let session = storage
        .get_session(id)?
        .ok_or_else(|| {
            let all_ids = storage.get_all_session_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::SessionNotFound { id: id.to_string() }
            } else {
                Error::SessionNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    // Allow resuming any session including active ones (for new terminal instances)
    // This matches the MCP server behavior where resumeSession() doesn't check status

    // Set to active and clear ended_at (matching MCP server behavior)
    storage.update_session_status(id, "active", actor)?;

    // Bind terminal to this session
    let project_path = session
        .project_path
        .as_deref()
        .unwrap_or(".");
    bind_session_to_terminal(&session.id, &session.name, project_path, "active");

    if json {
        let output = serde_json::json!({
            "id": session.id,
            "name": session.name,
            "status": "active"
        });
        println!("{output}");
    } else {
        println!("Resumed session: {}", session.name);
    }

    Ok(())
}

/// List sessions.
#[allow(clippy::too_many_arguments)]
fn list(
    db_path: &PathBuf,
    status: &str,
    limit: usize,
    search: Option<&str>,
    project: Option<&str>,
    all_projects: bool,
    include_completed: bool,
    json: bool,
) -> Result<()> {
    let storage = SqliteStorage::open(db_path)?;

    // Determine project path filter:
    // - If all_projects is true, don't filter by project
    // - If project is provided, use that
    // - Otherwise, use current directory
    let project_path = if all_projects {
        None
    } else {
        project.map(ToString::to_string).or_else(|| {
            current_project_path().map(|p| p.to_string_lossy().to_string())
        })
    };

    // Determine status filter
    // - "all" means no status filter
    // - include_completed means we fetch more and filter client-side
    let status_filter = if status == "all" {
        None
    } else if include_completed {
        // Fetch all statuses and filter client-side to include both the requested status and completed
        None
    } else {
        Some(status)
    };

    #[allow(clippy::cast_possible_truncation)]
    let mut sessions = storage.list_sessions_with_search(
        project_path.as_deref(),
        status_filter,
        Some(limit as u32 * 2), // Fetch extra to allow filtering
        search,
    )?;

    // If we're not fetching "all" status and include_completed is set,
    // filter to only include the requested status OR completed
    if status != "all" && include_completed {
        sessions.retain(|s| s.status == status || s.status == "completed");
    }

    // Apply limit after filtering
    sessions.truncate(limit);

    if crate::is_csv() {
        println!("id,name,status,project_path");
        for s in &sessions {
            let path = s.project_path.as_deref().unwrap_or("");
            println!("{},{},{},{}", s.id, crate::csv_escape(&s.name), s.status, crate::csv_escape(path));
        }
    } else if json {
        let output = SessionListOutput {
            count: sessions.len(),
            sessions,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if sessions.is_empty() {
        println!("No sessions found.");
    } else {
        println!("Sessions ({} found):", sessions.len());
        println!();
        for session in &sessions {
            let status_icon = match session.status.as_str() {
                "active" => "●",
                "paused" => "◐",
                "completed" => "○",
                _ => "?",
            };
            println!("{} {} [{}]", status_icon, session.name, session.status);
            println!("  ID: {}", session.id);
            if let Some(ref path) = session.project_path {
                println!("  Project: {path}");
            }
            if let Some(ref branch) = session.branch {
                println!("  Branch: {branch}");
            }
            println!();
        }
    }

    Ok(())
}

/// Switch to a different session.
fn switch(db_path: &PathBuf, id: &str, actor: &str, json: bool) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    // Pause the currently bound session (if any) via status cache
    if let Some(current_sid) = crate::config::current_session_id() {
        if current_sid != id {
            // Only pause if it's a different session
            if let Ok(Some(_)) = storage.get_session(&current_sid) {
                storage.update_session_status(&current_sid, "paused", actor)?;
            }
        }
    }

    // Get the target session
    let target = storage
        .get_session(id)?
        .ok_or_else(|| {
            let all_ids = storage.get_all_session_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::SessionNotFound { id: id.to_string() }
            } else {
                Error::SessionNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    // Activate the target session if not already active
    if target.status != "active" {
        storage.update_session_status(id, "active", actor)?;
    }

    // Bind terminal to the new session
    let project_path = target
        .project_path
        .as_deref()
        .unwrap_or(".");
    bind_session_to_terminal(&target.id, &target.name, project_path, "active");

    if json {
        let output = serde_json::json!({
            "id": target.id,
            "name": target.name,
            "status": "active"
        });
        println!("{output}");
    } else {
        println!("Switched to session: {}", target.name);
    }

    Ok(())
}

/// Rename the current session.
fn rename(db_path: &PathBuf, session_id: Option<&str>, new_name: &str, actor: &str, json: bool) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    let sid = resolve_session_or_suggest(session_id, &storage)?;
    let session = storage
        .get_session(&sid)?
        .ok_or_else(|| Error::SessionNotFound { id: sid })?;

    storage.rename_session(&session.id, new_name, actor)?;

    // Update the status cache with the new name
    if let Some(ref path) = session.project_path {
        bind_session_to_terminal(&session.id, new_name, path, &session.status);
    }

    if json {
        let output = serde_json::json!({
            "id": session.id,
            "name": new_name,
            "old_name": session.name
        });
        println!("{output}");
    } else {
        println!("Renamed session to: {new_name}");
    }

    Ok(())
}

/// Delete a session permanently.
fn delete(db_path: &PathBuf, id: &str, force: bool, actor: &str, json: bool) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    // Get the session to verify it exists and show info
    let session = storage
        .get_session(id)?
        .ok_or_else(|| {
            let all_ids = storage.get_all_session_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::SessionNotFound { id: id.to_string() }
            } else {
                Error::SessionNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    // Cannot delete active session without force
    if session.status == "active" && !force {
        return Err(Error::InvalidSessionStatus {
            expected: "paused or completed (use --force to delete active session)".to_string(),
            actual: session.status.clone(),
        });
    }

    // Perform deletion
    storage.delete_session(id, actor)?;

    if json {
        let output = serde_json::json!({
            "id": session.id,
            "name": session.name,
            "deleted": true
        });
        println!("{output}");
    } else {
        println!("Deleted session: {}", session.name);
    }

    Ok(())
}

/// Add a project path to a session.
fn add_path(
    db_path: &PathBuf,
    id: Option<&str>,
    path: Option<&str>,
    actor: &str,
    json: bool,
) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    // Resolve session ID: explicit -i flag first, then standard resolution
    let session_id = resolve_session_or_suggest(id, &storage)?;

    // Resolve path (use provided or current directory)
    let project_path = match path {
        Some(p) => std::path::PathBuf::from(p)
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| p.to_string()),
        None => std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| Error::Io(e))?,
    };

    // Get session info for output
    let session = storage
        .get_session(&session_id)?
        .ok_or_else(|| Error::SessionNotFound {
            id: session_id.clone(),
        })?;

    // Add the path
    storage.add_session_path(&session_id, &project_path, actor)?;

    if json {
        let output = serde_json::json!({
            "session_id": session.id,
            "session_name": session.name,
            "path_added": project_path
        });
        println!("{output}");
    } else {
        println!("Added path to session: {}", session.name);
        println!("  Path: {project_path}");
    }

    Ok(())
}

/// Remove a project path from a session.
fn remove_path(
    db_path: &PathBuf,
    id: Option<&str>,
    path: &str,
    actor: &str,
    json: bool,
) -> Result<()> {
    let mut storage = SqliteStorage::open(db_path)?;

    // Resolve session ID: explicit -i flag first, then standard resolution
    let session_id = resolve_session_or_suggest(id, &storage)?;

    // Get session info for output
    let session = storage
        .get_session(&session_id)?
        .ok_or_else(|| Error::SessionNotFound {
            id: session_id.clone(),
        })?;

    // Canonicalize path if possible (to match stored paths)
    let project_path = std::path::PathBuf::from(path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string());

    // Remove the path
    storage.remove_session_path(&session_id, &project_path, actor)?;

    if json {
        let output = serde_json::json!({
            "session_id": session.id,
            "session_name": session.name,
            "path_removed": project_path
        });
        println!("{output}");
    } else {
        println!("Removed path from session: {}", session.name);
        println!("  Path: {project_path}");
    }

    Ok(())
}
