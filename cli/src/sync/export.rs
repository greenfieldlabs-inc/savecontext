//! JSONL export functionality.
//!
//! This module handles exporting records to JSONL files for git-based sync.
//!
//! # Snapshot Mode
//!
//! Exports use **snapshot mode**: the JSONL file represents the current state
//! of all records, not a log of changes. Git tracks the history.
//!
//! # Project Scoping
//!
//! Exports are scoped to a specific project path. The JSONL files are written
//! to `<project>/.savecontext/` so they can be committed to git alongside the
//! project code.
//!
//! # Safety Checks
//!
//! Before overwriting, the exporter checks for records that would be "lost"
//! (exist in JSONL but not in database). Use `--force` to override.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use crate::storage::sqlite::SqliteStorage;
use crate::sync::file::{ensure_gitignore, read_jsonl, write_jsonl};
use crate::sync::hash::content_hash;
use crate::sync::types::{
    CheckpointRecord, ContextItemRecord, DeletionRecord, EntityType, ExportStats, IssueRecord,
    MemoryRecord, PlanRecord, SessionRecord, SyncError, SyncRecord, SyncResult,
};

/// Exporter for JSONL sync files.
///
/// The exporter reads all records from the database for a specific project
/// and writes them to JSONL files in the project's `.savecontext/` directory.
/// Uses snapshot mode: files are overwritten with current state (git tracks history).
pub struct Exporter<'a> {
    storage: &'a mut SqliteStorage,
    project_path: String,
    output_dir: PathBuf,
}

impl<'a> Exporter<'a> {
    /// Create a new exporter for a specific project.
    ///
    /// # Arguments
    ///
    /// * `storage` - Database storage to read from
    /// * `project_path` - Path to the project (used to filter records)
    ///
    /// # Notes
    ///
    /// The output directory is automatically set to `<project>/.savecontext/`.
    #[must_use]
    pub fn new(storage: &'a mut SqliteStorage, project_path: String) -> Self {
        let output_dir = project_export_dir(&project_path);
        Self {
            storage,
            project_path,
            output_dir,
        }
    }

    /// Create a new exporter with a custom output directory.
    ///
    /// This is primarily for testing purposes.
    #[must_use]
    pub fn with_output_dir(
        storage: &'a mut SqliteStorage,
        project_path: String,
        output_dir: PathBuf,
    ) -> Self {
        Self {
            storage,
            project_path,
            output_dir,
        }
    }

    /// Get the output directory.
    #[must_use]
    pub fn output_dir(&self) -> &Path {
        &self.output_dir
    }

    /// Export all records to JSONL files (snapshot mode).
    ///
    /// This exports all records for the project, overwriting existing files.
    /// Safety checks prevent accidental data loss unless `force` is true.
    ///
    /// # Arguments
    ///
    /// * `force` - If true, skip safety checks and overwrite regardless
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Database queries fail
    /// - File writes fail
    /// - Safety check fails (records would be lost) and force=false
    pub fn export(&mut self, force: bool) -> SyncResult<ExportStats> {
        // Ensure output directory exists
        fs::create_dir_all(&self.output_dir)?;

        // Create .gitignore if it doesn't exist
        ensure_gitignore(&self.output_dir)?;

        let mut stats = ExportStats::default();
        let now = Utc::now().to_rfc3339();

        // Export each entity type as a snapshot
        self.export_sessions_snapshot(&mut stats, &now, force)?;
        self.export_issues_snapshot(&mut stats, &now, force)?;
        self.export_context_items_snapshot(&mut stats, &now, force)?;
        self.export_memory_snapshot(&mut stats, &now, force)?;
        self.export_checkpoints_snapshot(&mut stats, &now, force)?;
        self.export_plans_snapshot(&mut stats, &now, force)?;

        // Export pending deletions (separate file)
        self.export_deletions(&mut stats)?;

        // Clear dirty flags after successful export
        self.clear_all_dirty_flags()?;

        if stats.is_empty() {
            return Err(SyncError::NothingToExport);
        }

        Ok(stats)
    }

    /// Export sessions as a snapshot.
    fn export_sessions_snapshot(
        &self,
        stats: &mut ExportStats,
        now: &str,
        force: bool,
    ) -> SyncResult<()> {
        let sessions = self
            .storage
            .get_sessions_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        if sessions.is_empty() {
            return Ok(());
        }

        let path = self.output_dir.join("sessions.jsonl");

        // Safety check: ensure we won't lose records
        if !force {
            self.check_for_lost_records(&path, &sessions.iter().map(|s| s.id.clone()).collect())?;
        }

        // Build records
        let records: Vec<SyncRecord> = sessions
            .into_iter()
            .map(|session| {
                let hash = content_hash(&session);
                SyncRecord::Session(SessionRecord {
                    data: session,
                    content_hash: hash,
                    exported_at: now.to_string(),
                })
            })
            .collect();

        stats.sessions = records.len();
        write_jsonl(&path, &records)?;

        Ok(())
    }

    /// Export issues as a snapshot.
    fn export_issues_snapshot(
        &self,
        stats: &mut ExportStats,
        now: &str,
        force: bool,
    ) -> SyncResult<()> {
        let issues = self
            .storage
            .get_issues_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        if issues.is_empty() {
            return Ok(());
        }

        let path = self.output_dir.join("issues.jsonl");

        // Safety check
        if !force {
            self.check_for_lost_records(&path, &issues.iter().map(|i| i.id.clone()).collect())?;
        }

        let records: Vec<SyncRecord> = issues
            .into_iter()
            .map(|issue| {
                let hash = content_hash(&issue);
                SyncRecord::Issue(IssueRecord {
                    data: issue,
                    content_hash: hash,
                    exported_at: now.to_string(),
                })
            })
            .collect();

        stats.issues = records.len();
        write_jsonl(&path, &records)?;

        Ok(())
    }

    /// Export context items as a snapshot.
    fn export_context_items_snapshot(
        &self,
        stats: &mut ExportStats,
        now: &str,
        force: bool,
    ) -> SyncResult<()> {
        let items = self
            .storage
            .get_context_items_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        if items.is_empty() {
            return Ok(());
        }

        let path = self.output_dir.join("context_items.jsonl");

        // Safety check
        if !force {
            self.check_for_lost_records(&path, &items.iter().map(|i| i.id.clone()).collect())?;
        }

        let records: Vec<SyncRecord> = items
            .into_iter()
            .map(|item| {
                let hash = content_hash(&item);
                SyncRecord::ContextItem(ContextItemRecord {
                    data: item,
                    content_hash: hash,
                    exported_at: now.to_string(),
                })
            })
            .collect();

        stats.context_items = records.len();
        write_jsonl(&path, &records)?;

        Ok(())
    }

    /// Export memory items as a snapshot.
    fn export_memory_snapshot(
        &self,
        stats: &mut ExportStats,
        now: &str,
        force: bool,
    ) -> SyncResult<()> {
        let memories = self
            .storage
            .get_memory_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        if memories.is_empty() {
            return Ok(());
        }

        let path = self.output_dir.join("memories.jsonl");

        // Safety check
        if !force {
            self.check_for_lost_records(&path, &memories.iter().map(|m| m.id.clone()).collect())?;
        }

        let records: Vec<SyncRecord> = memories
            .into_iter()
            .map(|memory| {
                let hash = content_hash(&memory);
                SyncRecord::Memory(MemoryRecord {
                    data: memory,
                    content_hash: hash,
                    exported_at: now.to_string(),
                })
            })
            .collect();

        stats.memories = records.len();
        write_jsonl(&path, &records)?;

        Ok(())
    }

    /// Export checkpoints as a snapshot.
    fn export_checkpoints_snapshot(
        &self,
        stats: &mut ExportStats,
        now: &str,
        force: bool,
    ) -> SyncResult<()> {
        let checkpoints = self
            .storage
            .get_checkpoints_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        if checkpoints.is_empty() {
            return Ok(());
        }

        let path = self.output_dir.join("checkpoints.jsonl");

        // Safety check
        if !force {
            self.check_for_lost_records(
                &path,
                &checkpoints.iter().map(|c| c.id.clone()).collect(),
            )?;
        }

        let records: Vec<SyncRecord> = checkpoints
            .into_iter()
            .map(|checkpoint| {
                let hash = content_hash(&checkpoint);
                SyncRecord::Checkpoint(CheckpointRecord {
                    data: checkpoint,
                    content_hash: hash,
                    exported_at: now.to_string(),
                })
            })
            .collect();

        stats.checkpoints = records.len();
        write_jsonl(&path, &records)?;

        Ok(())
    }

    /// Export plans as a snapshot.
    fn export_plans_snapshot(
        &self,
        stats: &mut ExportStats,
        now: &str,
        force: bool,
    ) -> SyncResult<()> {
        let plans = self
            .storage
            .get_plans_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        if plans.is_empty() {
            return Ok(());
        }

        let path = self.output_dir.join("plans.jsonl");

        // Safety check
        if !force {
            self.check_for_lost_records(&path, &plans.iter().map(|p| p.id.clone()).collect())?;
        }

        let records: Vec<SyncRecord> = plans
            .into_iter()
            .map(|plan| {
                let hash = content_hash(&plan);
                SyncRecord::Plan(PlanRecord {
                    data: plan,
                    content_hash: hash,
                    exported_at: now.to_string(),
                })
            })
            .collect();

        stats.plans = records.len();
        write_jsonl(&path, &records)?;

        Ok(())
    }

    /// Export deletions to a separate JSONL file.
    ///
    /// Unlike entity exports which use snapshot mode, deletions are **cumulative**:
    /// the file contains all deletions for the project, not just since last export.
    /// This ensures any importing machine can apply all deletions regardless of
    /// when it last synced.
    ///
    /// Deletions track an `exported` flag so `sync status` can show pending counts.
    fn export_deletions(&mut self, stats: &mut ExportStats) -> SyncResult<()> {
        // Get all deletions for this project (not just pending)
        let deletions = self
            .storage
            .get_all_deletions(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        if deletions.is_empty() {
            return Ok(());
        }

        let path = self.output_dir.join("deletions.jsonl");

        // Convert to DeletionRecord format
        let records: Vec<DeletionRecord> = deletions
            .iter()
            .map(|del| DeletionRecord {
                entity_type: del.entity_type.parse::<EntityType>().unwrap_or(EntityType::Session),
                entity_id: del.entity_id.clone(),
                project_path: del.project_path.clone(),
                // Convert milliseconds to seconds for chrono
                deleted_at: chrono::DateTime::from_timestamp(del.deleted_at / 1000, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| del.deleted_at.to_string()),
                deleted_by: del.deleted_by.clone(),
            })
            .collect();

        // Write as JSONL (one deletion per line)
        let content: String = records
            .iter()
            .map(|r| serde_json::to_string(r).unwrap())
            .collect::<Vec<_>>()
            .join("\n");

        crate::sync::file::atomic_write(&path, &format!("{content}\n"))?;

        // Count pending deletions (those not yet exported)
        let pending_ids: Vec<i64> = self
            .storage
            .get_pending_deletions(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?
            .iter()
            .map(|d| d.id)
            .collect();

        stats.deletions = pending_ids.len();

        // Mark pending deletions as exported
        if !pending_ids.is_empty() {
            self.storage
                .mark_deletions_exported(&pending_ids)
                .map_err(|e| SyncError::Database(e.to_string()))?;
        }

        Ok(())
    }

    /// Check if export would lose records that exist in JSONL but not in database.
    fn check_for_lost_records(&self, path: &Path, db_ids: &HashSet<String>) -> SyncResult<()> {
        if !path.exists() {
            return Ok(());
        }

        let existing_records = read_jsonl(path)?;
        let jsonl_ids: HashSet<String> = existing_records
            .iter()
            .map(|r| match r {
                SyncRecord::Session(rec) => rec.data.id.clone(),
                SyncRecord::Issue(rec) => rec.data.id.clone(),
                SyncRecord::ContextItem(rec) => rec.data.id.clone(),
                SyncRecord::Memory(rec) => rec.data.id.clone(),
                SyncRecord::Checkpoint(rec) => rec.data.id.clone(),
                SyncRecord::Plan(rec) => rec.data.id.clone(),
            })
            .collect();

        let missing: Vec<_> = jsonl_ids.difference(db_ids).collect();

        if !missing.is_empty() {
            let preview: Vec<_> = missing.iter().take(5).map(|s| s.as_str()).collect();
            let more = if missing.len() > 5 {
                format!(" ... and {} more", missing.len() - 5)
            } else {
                String::new()
            };

            return Err(SyncError::Database(format!(
                "Export would lose {} record(s) that exist in JSONL but not in database: {}{}\n\
                 Hint: Run 'sc sync import' first, or use --force to override.",
                missing.len(),
                preview.join(", "),
                more
            )));
        }

        Ok(())
    }

    /// Clear all dirty flags after successful export.
    fn clear_all_dirty_flags(&mut self) -> SyncResult<()> {
        let dirty_sessions = self
            .storage
            .get_dirty_sessions_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;
        let dirty_issues = self
            .storage
            .get_dirty_issues_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;
        let dirty_items = self
            .storage
            .get_dirty_context_items_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;
        let dirty_plans = self
            .storage
            .get_dirty_plans_by_project(&self.project_path)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        if !dirty_sessions.is_empty() {
            self.storage
                .clear_dirty_sessions(&dirty_sessions)
                .map_err(|e| SyncError::Database(e.to_string()))?;
        }
        if !dirty_issues.is_empty() {
            self.storage
                .clear_dirty_issues(&dirty_issues)
                .map_err(|e| SyncError::Database(e.to_string()))?;
        }
        if !dirty_items.is_empty() {
            self.storage
                .clear_dirty_context_items(&dirty_items)
                .map_err(|e| SyncError::Database(e.to_string()))?;
        }
        if !dirty_plans.is_empty() {
            self.storage
                .clear_dirty_plans(&dirty_plans)
                .map_err(|e| SyncError::Database(e.to_string()))?;
        }

        Ok(())
    }
}

/// Get the export directory for a project.
///
/// Returns `<project_path>/.savecontext/` which is the standard location
/// for sync files that can be committed to git.
#[must_use]
pub fn project_export_dir(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(".savecontext")
}

/// Get the default export directory for a database.
///
/// **Deprecated**: Use `project_export_dir` instead for project-scoped exports.
///
/// Returns the parent directory of the database file, which is typically
/// `~/.savecontext/data/` for the global database.
#[must_use]
pub fn default_export_dir(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_export_empty_database() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();
        let project_path = temp_dir.path().to_string_lossy().to_string();

        let mut exporter = Exporter::with_output_dir(
            &mut storage,
            project_path,
            temp_dir.path().to_path_buf(),
        );
        let result = exporter.export(false);

        // Should error because nothing to export
        assert!(matches!(result, Err(SyncError::NothingToExport)));
    }

    #[test]
    fn test_export_with_session() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();
        let project_path = "/test/project".to_string();

        // Create a session for this project
        storage
            .create_session("sess_1", "Test Session", None, Some(&project_path), None, "test")
            .unwrap();

        let mut exporter = Exporter::with_output_dir(
            &mut storage,
            project_path,
            temp_dir.path().to_path_buf(),
        );
        let stats = exporter.export(false).unwrap();

        assert_eq!(stats.sessions, 1);
        assert!(temp_dir.path().join("sessions.jsonl").exists());
    }

    #[test]
    fn test_export_overwrites_not_appends() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();
        let project_path = "/test/project".to_string();

        // Create a session
        storage
            .create_session("sess_1", "Test Session", None, Some(&project_path), None, "test")
            .unwrap();

        // First export
        let mut exporter = Exporter::with_output_dir(
            &mut storage,
            project_path.clone(),
            temp_dir.path().to_path_buf(),
        );
        exporter.export(false).unwrap();

        // Count lines
        let content = fs::read_to_string(temp_dir.path().join("sessions.jsonl")).unwrap();
        let line_count_1 = content.lines().filter(|l| !l.is_empty()).count();
        assert_eq!(line_count_1, 1);

        // Second export (should overwrite, not append)
        let mut exporter = Exporter::with_output_dir(
            &mut storage,
            project_path,
            temp_dir.path().to_path_buf(),
        );
        exporter.export(true).unwrap(); // force to bypass dirty check

        // Should still be 1 line, not 2
        let content = fs::read_to_string(temp_dir.path().join("sessions.jsonl")).unwrap();
        let line_count_2 = content.lines().filter(|l| !l.is_empty()).count();
        assert_eq!(line_count_2, 1, "Export should overwrite, not append");
    }

    #[test]
    fn test_project_export_dir() {
        assert_eq!(
            project_export_dir("/home/user/myproject"),
            PathBuf::from("/home/user/myproject/.savecontext")
        );
        assert_eq!(
            project_export_dir("/Users/shane/code/app"),
            PathBuf::from("/Users/shane/code/app/.savecontext")
        );
    }

    #[test]
    fn test_safety_check_prevents_data_loss() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();
        let project_path = "/test/project".to_string();

        // Create session and export
        storage
            .create_session("sess_1", "Test Session", None, Some(&project_path), None, "test")
            .unwrap();

        let mut exporter = Exporter::with_output_dir(
            &mut storage,
            project_path.clone(),
            temp_dir.path().to_path_buf(),
        );
        exporter.export(false).unwrap();

        // Now manually add a record to JSONL that doesn't exist in DB
        let jsonl_path = temp_dir.path().join("sessions.jsonl");
        let mut content = fs::read_to_string(&jsonl_path).unwrap();
        content.push_str(r#"{"type":"session","id":"sess_orphan","name":"Orphan","description":null,"branch":null,"channel":null,"project_path":"/test/project","status":"active","ended_at":null,"created_at":1000,"updated_at":1000,"content_hash":"abc","exported_at":"2025-01-01T00:00:00Z"}"#);
        content.push('\n');
        fs::write(&jsonl_path, content).unwrap();

        // Export without force should fail
        let mut exporter = Exporter::with_output_dir(
            &mut storage,
            project_path.clone(),
            temp_dir.path().to_path_buf(),
        );
        let result = exporter.export(false);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("would lose"));

        // Export with force should succeed
        let mut exporter = Exporter::with_output_dir(
            &mut storage,
            project_path,
            temp_dir.path().to_path_buf(),
        );
        let result = exporter.export(true);
        assert!(result.is_ok());
    }
}
