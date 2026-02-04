//! Initialize a SaveContext workspace.
//!
//! # Architecture
//!
//! SaveContext uses a **global database** architecture:
//! - **Global init (`sc init --global`)**: Creates the shared database at
//!   `~/.savecontext/data/savecontext.db`. Run this once per machine.
//! - **Project init (`sc init`)**: Creates per-project `.savecontext/` directory
//!   for JSONL sync exports. Does NOT create a database.
//!
//! The database is shared across all projects, while each project maintains
//! its own git-friendly JSONL exports.

use crate::config::{global_savecontext_dir, is_test_mode};
use crate::error::{Error, Result};
use crate::sync::gitignore_content;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct InitOutput {
    path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    database: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    export_dir: Option<PathBuf>,
}

/// Execute the init command.
///
/// - **Global mode**: Creates the shared database at `~/.savecontext/data/savecontext.db`
/// - **Project mode**: Creates per-project `.savecontext/` for JSONL exports only
///
/// # Errors
///
/// Returns an error if the directory or database cannot be created.
pub fn execute(global: bool, force: bool, json: bool) -> Result<()> {
    if global {
        execute_global_init(force, json)
    } else {
        execute_project_init(force, json)
    }
}

/// Initialize the global SaveContext database.
///
/// Creates `~/.savecontext/data/savecontext.db`.
/// When `SC_TEST_DB=1` is set, creates `~/.savecontext/test/savecontext.db` instead.
/// This is a one-time setup per machine (or once per test cycle).
fn execute_global_init(force: bool, json: bool) -> Result<()> {
    let base_dir = global_savecontext_dir().ok_or_else(|| {
        Error::Config("Could not determine global SaveContext directory".to_string())
    })?;

    // Use test/ subdirectory in test mode, data/ otherwise
    let data_dir = if is_test_mode() {
        base_dir.join("test")
    } else {
        base_dir.join("data")
    };

    // Check if already initialized
    let db_path = data_dir.join("savecontext.db");
    if db_path.exists() && !force {
        return Err(Error::AlreadyInitialized { path: db_path });
    }

    // Create directory structure
    fs::create_dir_all(&data_dir)?;

    // Create empty database file (schema will be applied on first open)
    if !db_path.exists() || force {
        fs::File::create(&db_path)?;
    }

    // Write global .gitignore (for safety if someone puts this in git)
    let gitignore_path = base_dir.join(".gitignore");
    if !gitignore_path.exists() || force {
        let gitignore = "# Everything in global SaveContext is local-only\n*\n";
        fs::write(&gitignore_path, gitignore)?;
    }

    if json {
        let output = InitOutput {
            path: base_dir,
            database: Some(db_path),
            export_dir: None,
        };
        let payload = serde_json::to_string(&output)?;
        println!("{payload}");
    } else {
        println!("Initialized global SaveContext database");
        println!("  Database: {}", db_path.display());
        println!();
        println!("Next: Run 'sc init' in your project directories to set up JSONL sync.");
    }

    Ok(())
}

/// Initialize a project-level SaveContext directory for JSONL exports.
///
/// Creates `.savecontext/` in the current directory with config and gitignore.
/// Does NOT create a database (uses global database).
fn execute_project_init(force: bool, json: bool) -> Result<()> {
    let base_dir = Path::new(".").join(".savecontext");

    // Check if already initialized
    if base_dir.exists() && !force {
        return Err(Error::AlreadyInitialized { path: base_dir });
    }

    // Create directory
    fs::create_dir_all(&base_dir)?;

    // Write .gitignore (tracks JSONL files, ignores temp files)
    let gitignore_path = base_dir.join(".gitignore");
    if !gitignore_path.exists() || force {
        fs::write(&gitignore_path, gitignore_content())?;
    }

    // Write config.json template
    let config_path = base_dir.join("config.json");
    if !config_path.exists() {
        let config = r#"{
  "default_priority": 2,
  "default_type": "task"
}
"#;
        fs::write(&config_path, config)?;
    }

    // Check if global database exists (respects test mode)
    let db_subdir = if is_test_mode() { "test" } else { "data" };
    let global_db = global_savecontext_dir()
        .map(|dir| dir.join(db_subdir).join("savecontext.db"))
        .filter(|p| p.exists());

    if json {
        let output = InitOutput {
            path: base_dir,
            database: global_db.clone(),
            export_dir: Some(PathBuf::from(".savecontext")),
        };
        let payload = serde_json::to_string(&output)?;
        println!("{payload}");
    } else {
        println!(
            "Initialized SaveContext project in {}",
            std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| ".".to_string())
        );
        println!("  Export directory: .savecontext/");

        if let Some(db) = global_db {
            println!("  Database: {}", db.display());
        } else {
            println!();
            println!(
                "⚠️  Global database not found. Run 'sc init --global' first to create it."
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::TempDir;

    // Mutex to serialize tests that change current directory
    static CWD_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_cwd<F, R>(f: F) -> R
    where
        F: FnOnce(&Path) -> R,
    {
        let _lock = CWD_LOCK.lock().unwrap();
        let original_cwd = std::env::current_dir().unwrap();
        let temp_dir = TempDir::new().unwrap();
        std::env::set_current_dir(temp_dir.path()).unwrap();

        let result = f(temp_dir.path());

        std::env::set_current_dir(original_cwd).unwrap();
        result
    }

    #[test]
    fn test_project_init_creates_export_directory() {
        with_temp_cwd(|temp_path| {
            let result = execute(false, false, false);
            assert!(result.is_ok());

            // Project init creates export directory
            assert!(temp_path.join(".savecontext").exists());
            assert!(temp_path.join(".savecontext/.gitignore").exists());
            assert!(temp_path.join(".savecontext/config.json").exists());

            // Project init does NOT create database (that's global)
            assert!(!temp_path.join(".savecontext/data").exists());
            assert!(!temp_path.join(".savecontext/data/savecontext.db").exists());
        });
    }

    #[test]
    fn test_project_init_fails_if_already_initialized() {
        with_temp_cwd(|_| {
            // First init should succeed
            assert!(execute(false, false, false).is_ok());

            // Second init without force should fail
            let result = execute(false, false, false);
            assert!(matches!(result, Err(Error::AlreadyInitialized { .. })));
        });
    }

    #[test]
    fn test_project_init_force_overwrites() {
        with_temp_cwd(|_| {
            assert!(execute(false, false, false).is_ok());
            assert!(execute(false, true, false).is_ok()); // Force should succeed
        });
    }

    // Note: Global init tests are harder to run in CI because they touch
    // the user's actual home directory. In practice, global init is tested
    // manually or with environment variable overrides.
}
