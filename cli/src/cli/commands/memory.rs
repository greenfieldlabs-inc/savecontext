//! Memory command implementations (project-level persistent storage).

use crate::cli::MemoryCommands;
use crate::config::{default_actor, resolve_db_path, resolve_project_path};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;

/// Output for memory save.
#[derive(Serialize)]
struct MemorySaveOutput {
    key: String,
    category: String,
    project_path: String,
}

/// Output for memory get.
#[derive(Serialize)]
struct MemoryGetOutput {
    key: String,
    value: String,
    category: String,
}

/// Output for memory list.
#[derive(Serialize)]
struct MemoryListOutput {
    items: Vec<MemoryItem>,
    count: usize,
}

#[derive(Serialize)]
struct MemoryItem {
    key: String,
    value: String,
    category: String,
}

/// Execute memory commands.
pub fn execute(
    command: &MemoryCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    match command {
        MemoryCommands::Save {
            key,
            value,
            category,
        } => save(key, value, category, db_path, actor, json),
        MemoryCommands::Get { key } => get(key, db_path, json),
        MemoryCommands::List { category } => list(category.as_deref(), db_path, json),
        MemoryCommands::Delete { key } => delete(key, db_path, actor, json),
    }
}

fn save(
    key: &str,
    value: &str,
    category: &str,
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
    let project_path = resolve_project_path(&storage, None)?;

    // Generate ID
    let id = format!("mem_{}", &uuid::Uuid::new_v4().to_string()[..12]);

    storage.save_memory(&id, &project_path, key, value, category, &actor)?;

    if crate::is_silent() {
        println!("{key}");
        return Ok(());
    }

    if json {
        let output = MemorySaveOutput {
            key: key.to_string(),
            category: category.to_string(),
            project_path,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Saved memory: {key} [{category}]");
    }

    Ok(())
}

fn get(key: &str, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    let memory = storage
        .get_memory(&project_path, key)?
        .ok_or_else(|| Error::Other(format!("Memory not found: {key}")))?;

    if json {
        let output = MemoryGetOutput {
            key: memory.key,
            value: memory.value,
            category: memory.category,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("{}: {}", memory.key, memory.value);
    }

    Ok(())
}

fn list(category: Option<&str>, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    let memories = storage.list_memory(&project_path, category)?;

    if crate::is_csv() {
        println!("key,category,value");
        for m in &memories {
            println!("{},{},{}", m.key, m.category, crate::csv_escape(&m.value));
        }
    } else if json {
        let items: Vec<MemoryItem> = memories
            .iter()
            .map(|m| MemoryItem {
                key: m.key.clone(),
                value: m.value.clone(),
                category: m.category.clone(),
            })
            .collect();
        let output = MemoryListOutput {
            count: items.len(),
            items,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if memories.is_empty() {
        println!("No memory items found.");
    } else {
        println!("Memory items ({} found):", memories.len());
        println!();
        for mem in &memories {
            let cat_icon = match mem.category.as_str() {
                "command" => "$",
                "config" => "⚙",
                "note" => "📝",
                _ => "•",
            };
            println!("{} {} [{}]", cat_icon, mem.key, mem.category);
            // Truncate long values
            let display_value = if mem.value.len() > 80 {
                format!("{}...", &mem.value[..80])
            } else {
                mem.value.clone()
            };
            println!("  {display_value}");
            println!();
        }
    }

    Ok(())
}

fn delete(key: &str, db_path: Option<&PathBuf>, actor: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let project_path = resolve_project_path(&storage, None)?;

    storage.delete_memory(&project_path, key, &actor)?;

    if json {
        let output = serde_json::json!({
            "key": key,
            "deleted": true
        });
        println!("{output}");
    } else {
        println!("Deleted memory: {key}");
    }

    Ok(())
}
