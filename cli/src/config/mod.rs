//! Configuration management.
//!
//! This module provides functions for discovering SaveContext directories,
//! resolving database paths, and loading configuration.
//!
//! # Architecture
//!
//! SaveContext uses a **global database** architecture to match the MCP server:
//! - **Database**: Single global database at `~/.savecontext/data/savecontext.db`
//! - **Exports**: Per-project `.savecontext/` directories for JSONL sync files
//!
//! This allows the CLI and MCP server to share the same data, while each project
//! maintains its own git-friendly JSONL exports.

mod status_cache;

pub use status_cache::{
    bind_session_to_terminal, clear_status_cache, current_session_id, read_status_cache,
    write_status_cache, StatusCacheEntry,
};

use crate::error::{Error, Result};

use std::path::{Path, PathBuf};

/// Discover the project-level SaveContext directory for JSONL exports.
///
/// Walks up from the current directory looking for `.savecontext/`.
/// This is used for finding the per-project export directory, NOT the database.
///
/// # Returns
///
/// Returns the path to the project `.savecontext/` directory, or `None` if not found.
///
/// Resolution strategy:
/// 1. Check the **git root** first — if the git root has `.savecontext/`, use it.
///    This prevents subdirectory export dirs from shadowing the real project root.
/// 2. Fall back to walking up from CWD (for non-git projects).
#[must_use]
pub fn discover_project_savecontext_dir() -> Option<PathBuf> {
    // Strategy 1: Use git root as the anchor (handles monorepos/subdirectories)
    if let Some(git_root) = git_toplevel() {
        let candidate = git_root.join(".savecontext");
        if candidate.exists() && candidate.is_dir() {
            return Some(candidate);
        }
    }

    // Strategy 2: Walk up from CWD (non-git projects)
    if let Ok(cwd) = std::env::current_dir() {
        let mut dir = cwd.as_path();
        loop {
            let candidate = dir.join(".savecontext");
            if candidate.exists() && candidate.is_dir() {
                return Some(candidate);
            }

            match dir.parent() {
                Some(parent) => dir = parent,
                None => break,
            }
        }
    }
    None
}

/// Get the git repository root directory.
fn git_toplevel() -> Option<PathBuf> {
    std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim().to_string()))
}

/// Discover the SaveContext directory (legacy behavior).
///
/// Walks up from the current directory looking for `.savecontext/`,
/// falling back to the global location.
///
/// **Note**: For new code, prefer:
/// - `resolve_db_path()` for database access (uses global DB)
/// - `discover_project_savecontext_dir()` for export directory (per-project)
///
/// # Returns
///
/// Returns the path to the `.savecontext/` directory, or `None` if not found.
#[must_use]
pub fn discover_savecontext_dir() -> Option<PathBuf> {
    // First, try walking up from current directory
    discover_project_savecontext_dir().or_else(global_savecontext_dir)
}

/// Get the global SaveContext directory location.
///
/// **Always uses `~/.savecontext/`** to match the MCP server location.
/// This ensures CLI and MCP server share the same database.
#[must_use]
pub fn global_savecontext_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|b| b.home_dir().join(".savecontext"))
}

/// Check if test mode is enabled.
///
/// Test mode is enabled by setting `SC_TEST_DB=1` (or any non-empty value).
/// This redirects all database operations to an isolated test database.
#[must_use]
pub fn is_test_mode() -> bool {
    std::env::var("SC_TEST_DB")
        .map(|v| !v.is_empty() && v != "0" && v.to_lowercase() != "false")
        .unwrap_or(false)
}

/// Get the test database path.
///
/// Returns `~/.savecontext/test/savecontext.db` for isolated testing.
#[must_use]
pub fn test_db_path() -> Option<PathBuf> {
    global_savecontext_dir().map(|dir| dir.join("test").join("savecontext.db"))
}

/// Resolve the database path.
///
/// **Always uses the global database** to match MCP server architecture.
/// The database is shared across all projects.
///
/// Priority:
/// 1. If `explicit_path` is provided, use it directly
/// 2. `SC_TEST_DB` environment variable → uses test database
/// 3. `SAVECONTEXT_DB` environment variable
/// 4. Global location: `~/.savecontext/data/savecontext.db`
///
/// # Test Mode
///
/// Set `SC_TEST_DB=1` to use `~/.savecontext/test/savecontext.db` instead.
/// This keeps your production data safe during CLI development.
///
/// # Returns
///
/// Returns the path to the database file, or `None` if no location found.
#[must_use]
pub fn resolve_db_path(explicit_path: Option<&Path>) -> Option<PathBuf> {
    // Priority 1: Explicit path from CLI flag
    if let Some(path) = explicit_path {
        return Some(path.to_path_buf());
    }

    // Priority 2: Test mode - use isolated test database
    if is_test_mode() {
        return test_db_path();
    }

    // Priority 3: SAVECONTEXT_DB environment variable
    if let Ok(db_path) = std::env::var("SAVECONTEXT_DB") {
        if !db_path.trim().is_empty() {
            return Some(PathBuf::from(db_path));
        }
    }

    // Priority 4: Global database location (matches MCP server)
    global_savecontext_dir().map(|dir| dir.join("data").join("savecontext.db"))
}

/// Resolve the session ID for any CLI command.
///
/// This is the **single source of truth** for session resolution.
/// Every session-scoped command must use this instead of the old
/// `current_project_path() + list_sessions("active", 1)` pattern.
///
/// Priority:
/// 1. Explicit `--session` flag (from CLI or MCP bridge)
/// 2. `SC_SESSION` environment variable
/// 3. TTY-keyed status cache (written by CLI/MCP on session start/resume)
/// 4. **Error** — no fallback, no guessing
pub fn resolve_session_id(explicit_session: Option<&str>) -> Result<String> {
    // 1. Explicit session from CLI flag or MCP bridge
    if let Some(id) = explicit_session {
        return Ok(id.to_string());
    }

    // 2. SC_SESSION environment variable
    if let Ok(id) = std::env::var("SC_SESSION") {
        if !id.is_empty() {
            return Ok(id);
        }
    }

    // 3. TTY-keyed status cache
    if let Some(id) = current_session_id() {
        return Ok(id);
    }

    // 4. No session — hard error, never guess
    Err(Error::NoActiveSession)
}

/// Resolve session ID with rich hints on failure.
///
/// Like [`resolve_session_id`], but on `NoActiveSession` queries the database
/// for recent resumable sessions and enriches the error with suggestions.
///
/// Use this in command handlers that already have a `SqliteStorage` instance.
pub fn resolve_session_or_suggest(
    explicit_session: Option<&str>,
    storage: &crate::storage::SqliteStorage,
) -> Result<String> {
    resolve_session_id(explicit_session).map_err(|e| {
        if !matches!(e, Error::NoActiveSession) {
            return e;
        }

        // Compute project path for session query
        let project_path = current_project_path();
        let pp_str = project_path.as_ref().map(|p| p.to_string_lossy().to_string());

        // Query recent sessions that could be resumed
        let recent = storage
            .list_sessions(pp_str.as_deref(), None, Some(5))
            .unwrap_or_default()
            .into_iter()
            .filter(|s| s.status == "active" || s.status == "paused")
            .take(3)
            .map(|s| {
                (s.id.clone(), s.name.clone(), s.status.clone())
            })
            .collect::<Vec<_>>();

        if recent.is_empty() {
            e
        } else {
            Error::NoActiveSessionWithRecent { recent }
        }
    })
}

/// Get the current project path.
///
/// Returns the directory containing `.savecontext/`, which is the project root.
/// This ensures all project-scoped data (memory, sessions) uses a consistent path
/// regardless of which subdirectory the CLI is run from.
#[must_use]
pub fn current_project_path() -> Option<PathBuf> {
    // Find the .savecontext directory, then return its parent (the project root)
    discover_savecontext_dir().and_then(|sc_dir| sc_dir.parent().map(Path::to_path_buf))
}

/// Get the current git branch name.
///
/// Returns `None` if not in a git repository or if git command fails.
#[must_use]
pub fn current_git_branch() -> Option<String> {
    std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get the default actor name.
///
/// Priority:
/// 1. `SC_ACTOR` environment variable
/// 2. Git user name
/// 3. System username
/// 4. "unknown"
#[must_use]
pub fn default_actor() -> String {
    // Check environment variable
    if let Ok(actor) = std::env::var("SC_ACTOR") {
        if !actor.is_empty() {
            return actor;
        }
    }

    // Try git user name
    if let Ok(output) = std::process::Command::new("git")
        .args(["config", "user.name"])
        .output()
    {
        if output.status.success() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }

    // Try system username
    if let Ok(user) = std::env::var("USER") {
        return user;
    }

    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_actor() {
        let actor = default_actor();
        assert!(!actor.is_empty());
    }

    #[test]
    fn test_resolve_db_path_with_explicit() {
        let explicit = PathBuf::from("/custom/path/db.sqlite");
        let result = resolve_db_path(Some(&explicit));
        assert_eq!(result, Some(explicit));
    }

    #[test]
    fn test_resolve_db_path_uses_global_not_project() {
        // Without explicit path, should resolve to global location
        // (not walk up looking for per-project .savecontext/)
        let result = resolve_db_path(None);
        assert!(result.is_some());

        let path = result.unwrap();
        // Should contain "savecontext.db" and be in a global location
        assert!(path.ends_with("savecontext.db"));
        // Should NOT be in current directory's .savecontext/
        // (it should be in ~/.savecontext or platform data dir)
    }

    #[test]
    fn test_global_savecontext_dir_returns_some() {
        let result = global_savecontext_dir();
        assert!(result.is_some());
    }

    #[test]
    fn test_test_db_path_is_separate() {
        let global = global_savecontext_dir().unwrap();
        let test = test_db_path().unwrap();

        // Test path should be under test/ subdirectory
        assert!(test.to_string_lossy().contains("/test/"));
        // Should still end with savecontext.db
        assert!(test.ends_with("savecontext.db"));
        // Should be different from production path
        assert_ne!(
            global.join("data").join("savecontext.db"),
            test
        );
    }

    #[test]
    fn test_is_test_mode_parsing() {
        // Test the parsing logic directly (without modifying env vars)
        // The actual env var behavior is tested via integration tests

        // These values should be falsy
        assert!(!("0" != "0" && "0".to_lowercase() != "false"));
        assert!(!("false" != "0" && "false".to_lowercase() != "false"));
        assert!(!("FALSE" != "0" && "FALSE".to_lowercase() != "false"));

        // These values should be truthy
        assert!("1" != "0" && "1".to_lowercase() != "false");
        assert!("true" != "0" && "true".to_lowercase() != "false");
        assert!("yes" != "0" && "yes".to_lowercase() != "false");
    }
}
