//! Checkpoint command implementations.

use crate::cli::CheckpointCommands;
use crate::config::{
    current_git_branch, default_actor, resolve_db_path, resolve_session_id,
    resolve_session_or_suggest,
};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;

/// Output for checkpoint create.
#[derive(Serialize)]
struct CheckpointCreateOutput {
    id: String,
    name: String,
    session_id: String,
    item_count: usize,
}

/// Output for checkpoint list.
#[derive(Serialize)]
struct CheckpointListOutput {
    checkpoints: Vec<CheckpointInfo>,
    count: usize,
}

#[derive(Serialize)]
struct CheckpointInfo {
    id: String,
    name: String,
    description: Option<String>,
    item_count: i64,
    created_at: i64,
}

/// Execute checkpoint commands.
pub fn execute(
    command: &CheckpointCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    session_id: Option<&str>,
    json: bool,
) -> Result<()> {
    match command {
        CheckpointCommands::Create {
            name,
            description,
            include_git,
        } => create(name, description.as_deref(), *include_git, db_path, actor, session_id, json),
        CheckpointCommands::List {
            search,
            session,
            project,
            all_projects,
            limit,
            offset,
        } => list(
            search.as_deref(),
            session.as_deref().or(session_id),  // Use CLI flag if provided, otherwise MCP session
            project.as_deref(),
            *all_projects,
            *limit,
            *offset,
            db_path,
            json,
        ),
        CheckpointCommands::Show { id } => show(id, db_path, json),
        CheckpointCommands::Restore { id, categories, tags } => restore(
            id,
            categories.as_ref().map(|v| v.as_slice()),
            tags.as_ref().map(|v| v.as_slice()),
            db_path,
            actor,
            session_id,
            json,
        ),
        CheckpointCommands::Delete { id } => delete(id, db_path, actor, json),
        CheckpointCommands::AddItems { id, keys } => add_items(id, keys, db_path, actor, session_id, json),
        CheckpointCommands::RemoveItems { id, keys } => remove_items(id, keys, db_path, actor, json),
        CheckpointCommands::Items { id } => items(id, db_path, json),
    }
}

fn create(
    name: &str,
    description: Option<&str>,
    include_git: bool,
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

    let sid = resolve_session_or_suggest(session_id, &storage)?;
    let session = storage
        .get_session(&sid)?
        .ok_or_else(|| Error::SessionNotFound { id: sid })?;

    // Get git info if requested
    let git_branch = if include_git {
        current_git_branch()
    } else {
        None
    };

    let git_status = if include_git {
        get_git_status()
    } else {
        None
    };

    // Generate checkpoint ID
    let id = format!("ckpt_{}", &uuid::Uuid::new_v4().to_string()[..12]);

    // Get current context items to include
    let items = storage.get_context_items(&session.id, None, None, Some(1000))?;

    storage.create_checkpoint(
        &id,
        &session.id,
        name,
        description,
        git_status.as_deref(),
        git_branch.as_deref(),
        &actor,
    )?;

    // Add items to checkpoint
    for item in &items {
        storage.add_checkpoint_item(&id, &item.id, &actor)?;
    }

    if crate::is_silent() {
        println!("{id}");
        return Ok(());
    }

    if json {
        let output = CheckpointCreateOutput {
            id,
            name: name.to_string(),
            session_id: session.id.clone(),
            item_count: items.len(),
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Created checkpoint: {name}");
        println!("  Items: {}", items.len());
        if let Some(ref branch) = git_branch {
            println!("  Branch: {branch}");
        }
    }

    Ok(())
}

fn list(
    search: Option<&str>,
    session_id: Option<&str>,
    _project: Option<&str>,
    all_projects: bool,
    limit: usize,
    offset: Option<usize>,
    db_path: Option<&PathBuf>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;

    // Determine session filter
    let resolved_session_id = if let Some(sid) = session_id {
        Some(sid.to_string())
    } else if !all_projects {
        // Use TTY-keyed status cache; if no session bound, show nothing (not all)
        resolve_session_id(None).ok()
    } else {
        None
    };

    // Get checkpoints - if we have a session, filter by it; if all_projects, get all
    #[allow(clippy::cast_possible_truncation)]
    let mut checkpoints = if let Some(ref sid) = resolved_session_id {
        storage.list_checkpoints(sid, Some(limit as u32 * 2))?  // Get extra for offset
    } else if all_projects {
        storage.get_all_checkpoints()?
    } else {
        // No session found and not searching all projects
        vec![]
    };

    // Apply search filter
    if let Some(ref search_term) = search {
        let s = search_term.to_lowercase();
        checkpoints.retain(|c| {
            c.name.to_lowercase().contains(&s)
                || c.description
                    .as_ref()
                    .map(|d| d.to_lowercase().contains(&s))
                    .unwrap_or(false)
        });
    }

    // Apply offset and limit
    if let Some(off) = offset {
        if off < checkpoints.len() {
            checkpoints = checkpoints.into_iter().skip(off).collect();
        } else {
            checkpoints = vec![];
        }
    }
    checkpoints.truncate(limit);

    if crate::is_csv() {
        println!("id,name,items,description");
        for cp in &checkpoints {
            let desc = cp.description.as_deref().unwrap_or("");
            println!("{},{},{},{}", cp.id, crate::csv_escape(&cp.name), cp.item_count, crate::csv_escape(desc));
        }
    } else if json {
        let infos: Vec<CheckpointInfo> = checkpoints
            .iter()
            .map(|c| CheckpointInfo {
                id: c.id.clone(),
                name: c.name.clone(),
                description: c.description.clone(),
                item_count: c.item_count,
                created_at: c.created_at,
            })
            .collect();
        let output = CheckpointListOutput {
            count: infos.len(),
            checkpoints: infos,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if checkpoints.is_empty() {
        println!("No checkpoints found.");
    } else {
        println!("Checkpoints ({} found):", checkpoints.len());
        println!();
        for cp in &checkpoints {
            println!("• {} ({} items)", cp.name, cp.item_count);
            println!("  ID: {}", cp.id);
            if let Some(ref desc) = cp.description {
                println!("  {desc}");
            }
            if let Some(ref branch) = cp.git_branch {
                println!("  Branch: {branch}");
            }
            println!();
        }
    }

    Ok(())
}

fn show(id: &str, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;

    let checkpoint = storage
        .get_checkpoint(id)?
        .ok_or_else(|| {
            let all_ids = storage.get_all_checkpoint_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::CheckpointNotFound { id: id.to_string() }
            } else {
                Error::CheckpointNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    if json {
        println!("{}", serde_json::to_string(&checkpoint)?);
    } else {
        println!("Checkpoint: {}", checkpoint.name);
        println!("  ID: {}", checkpoint.id);
        println!("  Items: {}", checkpoint.item_count);
        if let Some(ref desc) = checkpoint.description {
            println!("  Description: {desc}");
        }
        if let Some(ref branch) = checkpoint.git_branch {
            println!("  Git Branch: {branch}");
        }
        if let Some(ref git_status) = checkpoint.git_status {
            println!("  Git Status:");
            for line in git_status.lines().take(10) {
                println!("    {line}");
            }
        }
    }

    Ok(())
}

fn restore(
    id: &str,
    categories: Option<&[String]>,
    tags: Option<&[String]>,
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

    // Get checkpoint to verify it exists
    let checkpoint = storage
        .get_checkpoint(id)?
        .ok_or_else(|| {
            let all_ids = storage.get_all_checkpoint_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::CheckpointNotFound { id: id.to_string() }
            } else {
                Error::CheckpointNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    // Determine target session via TTY-keyed status cache
    let target_session_id = resolve_session_or_suggest(session_id, &storage)?;

    // Restore items from checkpoint to target session
    let restored_count = storage.restore_checkpoint(
        id,
        &target_session_id,
        categories,
        tags,
        &actor,
    )?;

    if json {
        let output = serde_json::json!({
            "id": checkpoint.id,
            "name": checkpoint.name,
            "restored": true,
            "item_count": restored_count,
            "target_session_id": target_session_id
        });
        println!("{output}");
    } else {
        println!("Restored checkpoint: {}", checkpoint.name);
        println!("  Items restored: {restored_count}");
        println!("  Target session: {target_session_id}");
    }

    Ok(())
}

fn delete(id: &str, db_path: Option<&PathBuf>, actor: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    storage.delete_checkpoint(id, &actor)?;

    if json {
        let output = serde_json::json!({
            "id": id,
            "deleted": true
        });
        println!("{output}");
    } else {
        println!("Deleted checkpoint: {id}");
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

fn add_items(
    id: &str,
    keys: &[String],
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

    let sid = resolve_session_or_suggest(session_id, &storage)?;
    let session = storage
        .get_session(&sid)?
        .ok_or_else(|| Error::SessionNotFound { id: sid })?;

    // Verify checkpoint exists
    let checkpoint = storage
        .get_checkpoint(id)?
        .ok_or_else(|| {
            let all_ids = storage.get_all_checkpoint_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::CheckpointNotFound { id: id.to_string() }
            } else {
                Error::CheckpointNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    let added = storage.add_checkpoint_items_by_keys(id, &session.id, keys, &actor)?;

    if json {
        let output = serde_json::json!({
            "checkpoint_id": id,
            "checkpoint_name": checkpoint.name,
            "keys_requested": keys.len(),
            "items_added": added
        });
        println!("{output}");
    } else {
        println!("Added {} items to checkpoint: {}", added, checkpoint.name);
        if added < keys.len() {
            println!("  ({} keys not found in current session)", keys.len() - added);
        }
    }

    Ok(())
}

fn remove_items(
    id: &str,
    keys: &[String],
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    // Verify checkpoint exists
    let checkpoint = storage
        .get_checkpoint(id)?
        .ok_or_else(|| {
            let all_ids = storage.get_all_checkpoint_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::CheckpointNotFound { id: id.to_string() }
            } else {
                Error::CheckpointNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    let removed = storage.remove_checkpoint_items_by_keys(id, keys, &actor)?;

    if json {
        let output = serde_json::json!({
            "checkpoint_id": id,
            "checkpoint_name": checkpoint.name,
            "keys_requested": keys.len(),
            "items_removed": removed
        });
        println!("{output}");
    } else {
        println!("Removed {} items from checkpoint: {}", removed, checkpoint.name);
        if removed < keys.len() {
            println!("  ({} keys not found in checkpoint)", keys.len() - removed);
        }
    }

    Ok(())
}

fn items(id: &str, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;

    // Verify checkpoint exists
    let checkpoint = storage
        .get_checkpoint(id)?
        .ok_or_else(|| {
            let all_ids = storage.get_all_checkpoint_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::CheckpointNotFound { id: id.to_string() }
            } else {
                Error::CheckpointNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    let items = storage.get_checkpoint_items(id)?;

    if json {
        let output = serde_json::json!({
            "checkpoint_id": id,
            "checkpoint_name": checkpoint.name,
            "count": items.len(),
            "items": items
        });
        println!("{}", serde_json::to_string(&output)?);
    } else if items.is_empty() {
        println!("Checkpoint '{}' has no items.", checkpoint.name);
    } else {
        println!("Checkpoint '{}' ({} items):", checkpoint.name, items.len());
        println!();
        for item in &items {
            let priority_icon = match item.priority.as_str() {
                "high" => "!",
                "low" => "-",
                _ => " ",
            };
            println!("[{}] {} ({})", priority_icon, item.key, item.category);
            let display_value = if item.value.len() > 80 {
                format!("{}...", &item.value[..80])
            } else {
                item.value.clone()
            };
            println!("    {display_value}");
            println!();
        }
    }

    Ok(())
}
