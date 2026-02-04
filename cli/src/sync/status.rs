//! Sync status display.
//!
//! This module provides functions to check the current sync state,
//! including pending exports and existing export files.
//!
//! Status is project-scoped, showing only data for the specified project.

use std::path::Path;

use colored::Colorize;

use crate::storage::sqlite::SqliteStorage;
use crate::sync::file::{count_lines, file_size};
use crate::sync::types::{ExportFileInfo, SyncError, SyncResult, SyncStatus};

/// Known export file names.
const EXPORT_FILES: [&str; 6] = [
    "sessions.jsonl",
    "issues.jsonl",
    "context_items.jsonl",
    "memories.jsonl",
    "checkpoints.jsonl",
    "deletions.jsonl",
];

/// Get the current sync status for a project.
///
/// This queries the database for dirty record counts (filtered by project)
/// and checks the export directory for existing JSONL files.
///
/// # Arguments
///
/// * `storage` - Database storage
/// * `export_dir` - Directory where export files are stored
/// * `project_path` - Project path to filter records by
///
/// # Errors
///
/// Returns an error if database queries fail.
pub fn get_sync_status(
    storage: &SqliteStorage,
    export_dir: &Path,
    project_path: &str,
) -> SyncResult<SyncStatus> {
    // Get dirty counts for this project
    let dirty_sessions = storage
        .get_dirty_sessions_by_project(project_path)
        .map_err(|e| SyncError::Database(e.to_string()))?
        .len();
    let dirty_issues = storage
        .get_dirty_issues_by_project(project_path)
        .map_err(|e| SyncError::Database(e.to_string()))?
        .len();
    let dirty_context_items = storage
        .get_dirty_context_items_by_project(project_path)
        .map_err(|e| SyncError::Database(e.to_string()))?
        .len();
    let pending_deletions = storage
        .count_pending_deletions(project_path)
        .map_err(|e| SyncError::Database(e.to_string()))?;

    // Get total counts for this project (for backfill detection)
    let counts = storage
        .get_project_counts(project_path)
        .map_err(|e| SyncError::Database(e.to_string()))?;

    // Check export files
    let mut export_files = Vec::new();
    for filename in EXPORT_FILES {
        let path = export_dir.join(filename);
        if path.exists() {
            let size = file_size(&path);
            let line_count = count_lines(&path).unwrap_or(0);
            export_files.push(ExportFileInfo {
                name: filename.to_string(),
                size,
                line_count,
            });
        }
    }

    let has_export_files = !export_files.is_empty();

    // Detect if backfill would happen (data exists but nothing dirty)
    let total_dirty = dirty_sessions + dirty_issues + dirty_context_items;
    let needs_backfill = total_dirty == 0 && counts.total() > 0 && !has_export_files;

    Ok(SyncStatus {
        dirty_sessions,
        dirty_issues,
        dirty_context_items,
        pending_deletions,
        total_sessions: counts.sessions,
        total_issues: counts.issues,
        total_context_items: counts.context_items,
        needs_backfill,
        has_export_files,
        export_files,
    })
}

/// Print sync status to stdout in a human-readable format.
pub fn print_status(status: &SyncStatus) {
    println!("{}", "Sync Status".bold().underline());
    println!();

    // Project data section
    let total_data =
        status.total_sessions + status.total_issues + status.total_context_items;
    if total_data > 0 {
        println!("{}", "Project Data:".blue().bold());
        if status.total_sessions > 0 {
            println!("  Sessions:      {}", status.total_sessions);
        }
        if status.total_issues > 0 {
            println!("  Issues:        {}", status.total_issues);
        }
        if status.total_context_items > 0 {
            println!("  Context Items: {}", status.total_context_items);
        }
        println!();
    }

    // Dirty records section
    let total_dirty =
        status.dirty_sessions + status.dirty_issues + status.dirty_context_items + status.pending_deletions;
    if total_dirty > 0 {
        println!("{}", "Pending Export:".yellow().bold());
        if status.dirty_sessions > 0 {
            println!("  Sessions:      {}", status.dirty_sessions);
        }
        if status.dirty_issues > 0 {
            println!("  Issues:        {}", status.dirty_issues);
        }
        if status.dirty_context_items > 0 {
            println!("  Context Items: {}", status.dirty_context_items);
        }
        if status.pending_deletions > 0 {
            println!("  Deletions:     {}", status.pending_deletions);
        }
        println!("  {}: {}", "Total".bold(), total_dirty);
        println!();
        println!(
            "{}",
            "Run 'sc sync export' to export pending changes.".dimmed()
        );
    } else if status.needs_backfill {
        println!(
            "{}",
            "First Export Required:".yellow().bold()
        );
        println!(
            "  {} records exist but haven't been exported yet.",
            total_data
        );
        println!();
        println!(
            "{}",
            "Run 'sc sync export' to perform initial export (backfill will run automatically).".dimmed()
        );
    } else if total_data == 0 {
        println!("{}", "No data for this project.".dimmed());
    } else {
        println!("{}", "No pending changes to export.".green());
    }

    println!();

    // Export files section
    if status.has_export_files {
        println!("{}", "Export Files:".blue().bold());
        for file in &status.export_files {
            let size_str = format_size(file.size);
            println!(
                "  {} ({}, {} records)",
                file.name, size_str, file.line_count
            );
        }
    } else {
        println!("{}", "No export files found.".dimmed());
        if total_data > 0 {
            println!(
                "{}",
                "Run 'sc sync export' to create initial export.".dimmed()
            );
        }
    }
}

/// Format a byte size as a human-readable string.
fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;

    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_format_size() {
        assert_eq!(format_size(0), "0 B");
        assert_eq!(format_size(512), "512 B");
        assert_eq!(format_size(1024), "1.0 KB");
        assert_eq!(format_size(1536), "1.5 KB");
        assert_eq!(format_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_size(1024 * 1024 + 512 * 1024), "1.5 MB");
    }

    #[test]
    fn test_get_sync_status_empty() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let storage = SqliteStorage::open(&db_path).unwrap();
        let project_path = "/test/project";

        let status = get_sync_status(&storage, temp_dir.path(), project_path).unwrap();

        assert_eq!(status.dirty_sessions, 0);
        assert_eq!(status.dirty_issues, 0);
        assert_eq!(status.dirty_context_items, 0);
        assert_eq!(status.pending_deletions, 0);
        assert_eq!(status.total_sessions, 0);
        assert!(!status.has_export_files);
        assert!(status.export_files.is_empty());
        assert!(!status.needs_backfill);
    }

    #[test]
    fn test_get_sync_status_with_dirty_records() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();
        let project_path = "/test/project";

        // Create a session for this project (triggers dirty tracking)
        storage
            .create_session("sess_1", "Test Session", None, Some(project_path), None, "test")
            .unwrap();

        let status = get_sync_status(&storage, temp_dir.path(), project_path).unwrap();

        assert_eq!(status.dirty_sessions, 1);
        assert_eq!(status.total_sessions, 1);
        assert_eq!(status.dirty_issues, 0);
        assert!(!status.needs_backfill);
    }

    #[test]
    fn test_get_sync_status_with_export_files() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let storage = SqliteStorage::open(&db_path).unwrap();
        let project_path = "/test/project";

        // Create a mock export file
        let sessions_path = temp_dir.path().join("sessions.jsonl");
        std::fs::write(&sessions_path, "{\"type\":\"session\"}\n{\"type\":\"session\"}\n").unwrap();

        let status = get_sync_status(&storage, temp_dir.path(), project_path).unwrap();

        assert!(status.has_export_files);
        assert_eq!(status.export_files.len(), 1);
        assert_eq!(status.export_files[0].name, "sessions.jsonl");
        assert_eq!(status.export_files[0].line_count, 2);
    }

    #[test]
    fn test_needs_backfill_detection() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();
        let project_path = "/test/project";

        // Create a session
        storage
            .create_session("sess_1", "Test Session", None, Some(project_path), None, "test")
            .unwrap();

        // Clear dirty flags (simulating old data without dirty tracking)
        storage.clear_dirty_sessions(&["sess_1".to_string()]).unwrap();

        let status = get_sync_status(&storage, temp_dir.path(), project_path).unwrap();

        // Data exists but no dirty records and no export files -> needs backfill
        assert_eq!(status.total_sessions, 1);
        assert_eq!(status.dirty_sessions, 0);
        assert!(status.needs_backfill);
    }
}
