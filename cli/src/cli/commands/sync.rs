//! Sync command implementations (JSONL export/import).
//!
//! Sync operations are project-scoped, using the current working directory
//! as the project path. JSONL files are written to `<project>/.savecontext/`
//! so they can be committed to git alongside the project code.

use crate::cli::SyncCommands;
use crate::config::resolve_db_path;
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use crate::sync::{project_export_dir, Exporter, Importer, MergeStrategy};
use std::env;
use std::path::PathBuf;

/// Execute sync commands.
pub fn execute(command: &SyncCommands, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    match command {
        SyncCommands::Export { force } => export(*force, db_path, json),
        SyncCommands::Import { force } => import(*force, db_path, json),
        SyncCommands::Status => status(db_path, json),
    }
}

/// Get the current project path from the working directory.
fn get_project_path() -> Result<String> {
    env::current_dir()
        .map_err(|e| Error::Other(format!("Failed to get current directory: {e}")))?
        .to_str()
        .map(String::from)
        .ok_or_else(|| Error::Other("Current directory path is not valid UTF-8".to_string()))
}

fn export(force: bool, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path =
        resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let project_path = get_project_path()?;
    let mut storage = SqliteStorage::open(&db_path)?;
    let output_dir = project_export_dir(&project_path);

    let mut exporter = Exporter::new(&mut storage, project_path.clone());

    match exporter.export(force) {
        Ok(stats) => {
            if json {
                let output = serde_json::json!({
                    "success": true,
                    "project": project_path,
                    "output_dir": output_dir.display().to_string(),
                    "stats": stats,
                });
                println!("{}", serde_json::to_string(&output)?);
            } else if stats.is_empty() {
                println!("No records exported.");
            } else {
                println!("Export complete for: {project_path}");
                println!();
                if stats.sessions > 0 {
                    println!("  Sessions:      {}", stats.sessions);
                }
                if stats.issues > 0 {
                    println!("  Issues:        {}", stats.issues);
                }
                if stats.context_items > 0 {
                    println!("  Context Items: {}", stats.context_items);
                }
                if stats.memories > 0 {
                    println!("  Memories:      {}", stats.memories);
                }
                if stats.checkpoints > 0 {
                    println!("  Checkpoints:   {}", stats.checkpoints);
                }
                println!();
                println!("  Total: {} records", stats.total());
                println!("  Location: {}", output_dir.display());
            }
            Ok(())
        }
        Err(crate::sync::SyncError::NothingToExport) => {
            if json {
                let output = serde_json::json!({
                    "error": "nothing_to_export",
                    "project": project_path,
                    "message": "No dirty records to export for this project. Use --force to export all records."
                });
                println!("{output}");
            } else {
                println!("No dirty records to export for: {project_path}");
                println!("Use --force to export all records regardless of dirty state.");
            }
            Ok(())
        }
        Err(e) => Err(Error::Other(e.to_string())),
    }
}

fn import(force: bool, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path =
        resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let project_path = get_project_path()?;
    let mut storage = SqliteStorage::open(&db_path)?;
    let import_dir = project_export_dir(&project_path);

    // Choose merge strategy based on --force flag
    let strategy = if force {
        MergeStrategy::PreferExternal
    } else {
        MergeStrategy::PreferNewer
    };

    let mut importer = Importer::new(&mut storage, strategy);

    match importer.import_all(&import_dir) {
        Ok(stats) => {
            let total = stats.total_processed();
            if json {
                let output = serde_json::json!({
                    "success": true,
                    "project": project_path,
                    "import_dir": import_dir.display().to_string(),
                    "stats": stats,
                });
                println!("{}", serde_json::to_string(&output)?);
            } else if total == 0 {
                println!("No records to import for: {project_path}");
                println!("Export files not found in: {}", import_dir.display());
            } else {
                println!("Import complete for: {project_path}");
                println!();
                print_entity_stats("Sessions", &stats.sessions);
                print_entity_stats("Issues", &stats.issues);
                print_entity_stats("Context Items", &stats.context_items);
                print_entity_stats("Memories", &stats.memories);
                print_entity_stats("Checkpoints", &stats.checkpoints);
                println!();
                println!(
                    "Total: {} created, {} updated, {} skipped",
                    stats.total_created(),
                    stats.total_updated(),
                    total - stats.total_created() - stats.total_updated()
                );
            }
            Ok(())
        }
        Err(crate::sync::SyncError::FileNotFound(path)) => {
            if json {
                let output = serde_json::json!({
                    "error": "file_not_found",
                    "project": project_path,
                    "path": path
                });
                println!("{output}");
            } else {
                println!("Import file not found: {path}");
                println!("Run 'sc sync export' first to create JSONL files.");
            }
            Ok(())
        }
        Err(e) => Err(Error::Other(e.to_string())),
    }
}

fn print_entity_stats(name: &str, stats: &crate::sync::EntityStats) {
    let total = stats.total();
    if total > 0 {
        println!(
            "  {}: {} created, {} updated, {} skipped",
            name, stats.created, stats.updated, stats.skipped
        );
    }
}

fn status(db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path =
        resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let project_path = get_project_path()?;
    let storage = SqliteStorage::open(&db_path)?;
    let export_dir = project_export_dir(&project_path);

    let sync_status = crate::sync::get_sync_status(&storage, &export_dir, &project_path)
        .map_err(|e| Error::Other(e.to_string()))?;

    if json {
        let output = serde_json::json!({
            "project": project_path,
            "export_dir": export_dir.display().to_string(),
            "status": sync_status,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Sync status for: {project_path}");
        println!("Export directory: {}", export_dir.display());
        println!();
        crate::sync::print_status(&sync_status);
    }

    Ok(())
}
