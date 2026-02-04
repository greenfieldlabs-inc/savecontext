//! Status cache reader for session resolution.
//!
//! Reads the status cache written by the MCP server to determine the
//! current session for this terminal. This provides a single source of
//! truth for session state, eliminating guesswork.
//!
//! # TTY Resolution Strategy (matches MCP server)
//!
//! 1. `SAVECONTEXT_STATUS_KEY` env var (explicit override)
//! 2. Parent process TTY via `ps -o tty= -p $PPID`
//! 3. `TERM_SESSION_ID` env var (macOS Terminal.app)
//! 4. `ITERM_SESSION_ID` env var (iTerm2)
//! 5. None if no key available

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Cache TTL: 2 hours (matches MCP server)
const CACHE_TTL_MS: u64 = 2 * 60 * 60 * 1000;

/// Status cache entry (matches MCP server format)
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusCacheEntry {
    pub session_id: String,
    pub session_name: String,
    pub project_path: String,
    pub timestamp: u64,
    pub provider: Option<String>,
    pub item_count: Option<u32>,
    pub session_status: Option<String>,
}

/// Get the status cache directory path.
fn cache_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|b| b.home_dir().join(".savecontext").join("status-cache"))
}

/// Sanitize a key for use as a filename.
fn sanitize_key(key: &str) -> Option<String> {
    let sanitized: String = key
        .trim()
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' || c == '*' || c == '?'
               || c == '"' || c == '<' || c == '>' || c == '|' || c.is_whitespace() {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();

    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

/// Walk the process tree to find the controlling terminal.
///
/// Agent-spawned processes (e.g. Claude Code → shell → sc) often have
/// no TTY ("??") on themselves and their immediate parent. The real
/// terminal is held by the agent process further up the tree.
/// Walk up to 5 ancestors to find it.
fn find_tty_from_ancestors() -> Option<String> {
    let mut current_pid = std::process::id().to_string();

    for _ in 0..5 {
        // Check this PID's TTY
        if let Ok(output) = Command::new("ps")
            .args(["-o", "tty=", "-p", &current_pid])
            .output()
        {
            if output.status.success() {
                let tty = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !tty.is_empty() && tty != "?" && tty != "??" {
                    return Some(tty);
                }
            }
        }

        // Walk to parent
        let Ok(output) = Command::new("ps")
            .args(["-o", "ppid=", "-p", &current_pid])
            .output()
        else {
            break;
        };

        if !output.status.success() {
            break;
        }

        let ppid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if ppid.is_empty() || ppid == "0" || ppid == "1" || ppid == current_pid {
            break;
        }
        current_pid = ppid;
    }

    None
}

/// Get the status key for this terminal.
///
/// Uses the same resolution strategy as the MCP server to ensure
/// consistency between CLI and MCP session tracking.
pub fn get_status_key() -> Option<String> {
    // 1. Explicit override via environment variable
    if let Ok(key) = std::env::var("SAVECONTEXT_STATUS_KEY") {
        if !key.is_empty() {
            return sanitize_key(&key);
        }
    }

    // 2. Walk ancestor processes to find the controlling terminal
    if let Some(tty) = find_tty_from_ancestors() {
        return sanitize_key(&format!("tty-{}", tty));
    }

    // 3. macOS Terminal.app session ID
    if let Ok(term_id) = std::env::var("TERM_SESSION_ID") {
        if !term_id.is_empty() {
            return sanitize_key(&format!("term-{}", term_id));
        }
    }

    // 4. iTerm2 session ID
    if let Ok(iterm_id) = std::env::var("ITERM_SESSION_ID") {
        if !iterm_id.is_empty() {
            return sanitize_key(&format!("iterm-{}", iterm_id));
        }
    }

    // 5. No key available
    None
}

/// Read the status cache entry for this terminal.
///
/// Returns `None` if:
/// - No status key can be determined
/// - Cache file doesn't exist
/// - Cache entry is stale (older than 2 hours)
/// - Cache file is corrupted
pub fn read_status_cache() -> Option<StatusCacheEntry> {
    let key = get_status_key()?;
    let cache_path = cache_dir()?.join(format!("{}.json", key));

    if !cache_path.exists() {
        return None;
    }

    let content = fs::read_to_string(&cache_path).ok()?;
    let entry: StatusCacheEntry = serde_json::from_str(&content).ok()?;

    // Check TTL
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64;

    if now.saturating_sub(entry.timestamp) > CACHE_TTL_MS {
        // Stale entry - try to remove it (ignore errors)
        let _ = fs::remove_file(&cache_path);
        return None;
    }

    Some(entry)
}

/// Get the current session ID from the status cache.
///
/// This is the primary function for CLI commands to determine which
/// session they should operate on.
pub fn current_session_id() -> Option<String> {
    read_status_cache().map(|e| e.session_id)
}

/// Write a status cache entry for this terminal.
///
/// Uses the same atomic write pattern as the MCP server:
/// write to temp file → rename to final path. This prevents
/// partial reads from concurrent CLI/MCP access.
///
/// Returns `true` if the cache was written successfully.
pub fn write_status_cache(entry: &StatusCacheEntry) -> bool {
    let Some(key) = get_status_key() else {
        return false;
    };

    let Some(dir) = cache_dir() else {
        return false;
    };

    // Ensure cache directory exists
    if let Err(_) = fs::create_dir_all(&dir) {
        return false;
    }

    let file_path = dir.join(format!("{key}.json"));
    let temp_path = dir.join(format!("{key}.json.tmp"));

    // Serialize with pretty-print to match MCP server format
    let Ok(json) = serde_json::to_string_pretty(entry) else {
        return false;
    };

    // Write to temp file with restrictive permissions, then atomic rename
    let result = (|| -> std::io::Result<()> {
        {
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create(true).truncate(true);
            #[cfg(unix)]
            opts.mode(0o600);
            let mut file = opts.open(&temp_path)?;
            file.write_all(json.as_bytes())?;
            file.flush()?;
        }
        fs::rename(&temp_path, &file_path)?;
        Ok(())
    })();

    result.is_ok()
}

/// Clear the status cache for this terminal.
///
/// Called when a session is paused or ended to unbind the
/// terminal from that session.
pub fn clear_status_cache() -> bool {
    let Some(key) = get_status_key() else {
        return false;
    };

    let Some(dir) = cache_dir() else {
        return false;
    };

    let file_path = dir.join(format!("{key}.json"));

    if file_path.exists() {
        fs::remove_file(&file_path).is_ok()
    } else {
        true // Already clear
    }
}

/// Build a `StatusCacheEntry` for a session and write it to the cache.
///
/// Convenience function that mirrors the MCP server's `updateStatusLine()`.
/// Call this on session start/resume to bind the terminal to a session.
pub fn bind_session_to_terminal(
    session_id: &str,
    session_name: &str,
    project_path: &str,
    status: &str,
) -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64;

    let entry = StatusCacheEntry {
        session_id: session_id.to_string(),
        session_name: session_name.to_string(),
        project_path: project_path.to_string(),
        timestamp: now,
        provider: Some("cli".to_string()),
        item_count: None,
        session_status: Some(status.to_string()),
    };

    write_status_cache(&entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_key() {
        assert_eq!(sanitize_key("simple"), Some("simple".to_string()));
        assert_eq!(sanitize_key("with/slash"), Some("with_slash".to_string()));
        assert_eq!(sanitize_key("with spaces"), Some("with_spaces".to_string()));
        assert_eq!(sanitize_key(""), None);
        assert_eq!(sanitize_key("   "), None);
    }

    #[test]
    fn test_cache_dir() {
        let dir = cache_dir();
        assert!(dir.is_some());
        let path = dir.unwrap();
        assert!(path.ends_with("status-cache"));
    }
}
