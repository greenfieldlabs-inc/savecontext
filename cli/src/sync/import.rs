//! JSONL import functionality.
//!
//! This module handles importing records from JSONL files with merge support.
//! It uses content hashing and timestamps to resolve conflicts between
//! local and external records.

use std::path::Path;

use std::fs::File;
use std::io::{BufRead, BufReader};

use crate::storage::sqlite::SqliteStorage;
use crate::sync::file::read_jsonl;
use crate::sync::hash::content_hash;
use crate::sync::types::{
    CheckpointRecord, ContextItemRecord, DeletionRecord, EntityStats, ImportStats, IssueRecord,
    MemoryRecord, MergeStrategy, PlanRecord, SessionRecord, SyncError, SyncRecord, SyncResult,
};

/// Importer for JSONL sync files.
///
/// The importer reads records from JSONL files and merges them into the
/// local database using the specified merge strategy.
pub struct Importer<'a> {
    storage: &'a mut SqliteStorage,
    strategy: MergeStrategy,
}

impl<'a> Importer<'a> {
    /// Create a new importer with the specified merge strategy.
    #[must_use]
    pub fn new(storage: &'a mut SqliteStorage, strategy: MergeStrategy) -> Self {
        Self { storage, strategy }
    }

    /// Import records from a JSONL file.
    ///
    /// Each line in the file is parsed and merged into the local database.
    /// The merge strategy determines how conflicts are resolved.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be read or records are invalid.
    pub fn import(&mut self, path: &Path) -> SyncResult<ImportStats> {
        let records = read_jsonl(path)?;
        let mut stats = ImportStats::default();

        for record in records {
            match record {
                SyncRecord::Session(rec) => self.import_session(rec, &mut stats.sessions)?,
                SyncRecord::Issue(rec) => self.import_issue(rec, &mut stats.issues)?,
                SyncRecord::ContextItem(rec) => {
                    self.import_context_item(rec, &mut stats.context_items)?;
                }
                SyncRecord::Memory(rec) => self.import_memory(rec, &mut stats.memories)?,
                SyncRecord::Checkpoint(rec) => {
                    self.import_checkpoint(rec, &mut stats.checkpoints)?;
                }
                SyncRecord::Plan(rec) => {
                    self.import_plan(rec, &mut stats.plans)?;
                }
            }
        }

        Ok(stats)
    }

    /// Import all JSONL files from a directory.
    ///
    /// Imports files in order: sessions, issues, context_items, memories, checkpoints.
    /// Then applies deletions last (to handle records that were created then deleted).
    /// Files that don't exist are skipped.
    ///
    /// # Errors
    ///
    /// Returns an error if any file cannot be read.
    pub fn import_all(&mut self, dir: &Path) -> SyncResult<ImportStats> {
        let mut total_stats = ImportStats::default();

        // Import data records in dependency order
        let files = [
            ("sessions.jsonl", "sessions"),
            ("issues.jsonl", "issues"),
            ("context_items.jsonl", "context_items"),
            ("memories.jsonl", "memories"),
            ("checkpoints.jsonl", "checkpoints"),
            ("plans.jsonl", "plans"),
        ];

        for (filename, _entity) in files {
            let path = dir.join(filename);
            if path.exists() {
                let stats = self.import(&path)?;
                merge_stats(&mut total_stats, &stats);
            }
        }

        // Apply deletions last (after importing any records that might be deleted)
        let deletions_path = dir.join("deletions.jsonl");
        if deletions_path.exists() {
            self.import_deletions(&deletions_path)?;
        }

        Ok(total_stats)
    }

    /// Import deletions from a JSONL file.
    ///
    /// Deletions are applied to the local database by removing the specified entities.
    /// This ensures that records deleted on one machine are deleted on all machines.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be read or deletions cannot be applied.
    pub fn import_deletions(&mut self, path: &Path) -> SyncResult<usize> {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let mut deleted_count = 0;

        for (line_num, line) in reader.lines().enumerate() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }

            let deletion: DeletionRecord = serde_json::from_str(&line).map_err(|e| {
                SyncError::InvalidRecord {
                    line: line_num + 1,
                    message: e.to_string(),
                }
            })?;

            // Apply the deletion
            let entity_type = deletion.entity_type.to_string();
            let was_deleted = self
                .storage
                .apply_deletion(&entity_type, &deletion.entity_id)
                .map_err(|e| SyncError::Database(e.to_string()))?;

            if was_deleted {
                deleted_count += 1;
            }
        }

        Ok(deleted_count)
    }

    /// Import a session record with merge.
    fn import_session(&mut self, rec: SessionRecord, stats: &mut EntityStats) -> SyncResult<()> {
        let existing = self
            .storage
            .get_session(&rec.data.id)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        match existing {
            Some(local) => {
                // Compare content hashes
                let local_hash = content_hash(&local);
                if local_hash == rec.content_hash {
                    // No change
                    stats.skipped += 1;
                    return Ok(());
                }

                // Apply merge strategy
                match self.strategy {
                    MergeStrategy::PreferNewer => {
                        if rec.data.updated_at > local.updated_at {
                            self.storage
                                .upsert_session(&rec.data)
                                .map_err(|e| SyncError::Database(e.to_string()))?;
                            stats.updated += 1;
                        } else {
                            stats.skipped += 1;
                        }
                    }
                    MergeStrategy::PreferLocal => {
                        stats.skipped += 1;
                    }
                    MergeStrategy::PreferExternal => {
                        self.storage
                            .upsert_session(&rec.data)
                            .map_err(|e| SyncError::Database(e.to_string()))?;
                        stats.updated += 1;
                    }
                }
            }
            None => {
                // New record
                self.storage
                    .upsert_session(&rec.data)
                    .map_err(|e| SyncError::Database(e.to_string()))?;
                stats.created += 1;
            }
        }

        Ok(())
    }

    /// Import an issue record with merge.
    fn import_issue(&mut self, rec: IssueRecord, stats: &mut EntityStats) -> SyncResult<()> {
        let existing = self
            .storage
            .get_issue(&rec.data.id, None)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        match existing {
            Some(local) => {
                let local_hash = content_hash(&local);
                if local_hash == rec.content_hash {
                    stats.skipped += 1;
                    return Ok(());
                }

                match self.strategy {
                    MergeStrategy::PreferNewer => {
                        if rec.data.updated_at > local.updated_at {
                            self.storage
                                .upsert_issue(&rec.data)
                                .map_err(|e| SyncError::Database(e.to_string()))?;
                            stats.updated += 1;
                        } else {
                            stats.skipped += 1;
                        }
                    }
                    MergeStrategy::PreferLocal => {
                        stats.skipped += 1;
                    }
                    MergeStrategy::PreferExternal => {
                        self.storage
                            .upsert_issue(&rec.data)
                            .map_err(|e| SyncError::Database(e.to_string()))?;
                        stats.updated += 1;
                    }
                }
            }
            None => {
                self.storage
                    .upsert_issue(&rec.data)
                    .map_err(|e| SyncError::Database(e.to_string()))?;
                stats.created += 1;
            }
        }

        Ok(())
    }

    /// Import a context item record with merge.
    fn import_context_item(
        &mut self,
        rec: ContextItemRecord,
        stats: &mut EntityStats,
    ) -> SyncResult<()> {
        let existing = self
            .storage
            .get_context_item(&rec.data.id)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        match existing {
            Some(local) => {
                let local_hash = content_hash(&local);
                if local_hash == rec.content_hash {
                    stats.skipped += 1;
                    return Ok(());
                }

                match self.strategy {
                    MergeStrategy::PreferNewer => {
                        if rec.data.updated_at > local.updated_at {
                            self.storage
                                .upsert_context_item(&rec.data)
                                .map_err(|e| SyncError::Database(e.to_string()))?;
                            stats.updated += 1;
                        } else {
                            stats.skipped += 1;
                        }
                    }
                    MergeStrategy::PreferLocal => {
                        stats.skipped += 1;
                    }
                    MergeStrategy::PreferExternal => {
                        self.storage
                            .upsert_context_item(&rec.data)
                            .map_err(|e| SyncError::Database(e.to_string()))?;
                        stats.updated += 1;
                    }
                }
            }
            None => {
                self.storage
                    .upsert_context_item(&rec.data)
                    .map_err(|e| SyncError::Database(e.to_string()))?;
                stats.created += 1;
            }
        }

        Ok(())
    }

    /// Import a memory record with merge.
    fn import_memory(&mut self, rec: MemoryRecord, stats: &mut EntityStats) -> SyncResult<()> {
        // Memory items don't have a get_by_id, so we always upsert
        // The ON CONFLICT handles deduplication by (project_path, key)
        self.storage
            .upsert_memory(&rec.data)
            .map_err(|e| SyncError::Database(e.to_string()))?;
        stats.created += 1;
        Ok(())
    }

    /// Import a checkpoint record with merge.
    fn import_checkpoint(
        &mut self,
        rec: CheckpointRecord,
        stats: &mut EntityStats,
    ) -> SyncResult<()> {
        let existing = self
            .storage
            .get_checkpoint(&rec.data.id)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        match existing {
            Some(local) => {
                let local_hash = content_hash(&local);
                if local_hash == rec.content_hash {
                    stats.skipped += 1;
                    return Ok(());
                }

                // Checkpoints are immutable in nature, but we allow updates
                match self.strategy {
                    MergeStrategy::PreferNewer | MergeStrategy::PreferExternal => {
                        self.storage
                            .upsert_checkpoint(&rec.data)
                            .map_err(|e| SyncError::Database(e.to_string()))?;
                        stats.updated += 1;
                    }
                    MergeStrategy::PreferLocal => {
                        stats.skipped += 1;
                    }
                }
            }
            None => {
                self.storage
                    .upsert_checkpoint(&rec.data)
                    .map_err(|e| SyncError::Database(e.to_string()))?;
                stats.created += 1;
            }
        }

        Ok(())
    }

    /// Import a plan record with merge.
    fn import_plan(&mut self, rec: PlanRecord, stats: &mut EntityStats) -> SyncResult<()> {
        let existing = self
            .storage
            .get_plan(&rec.data.id)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        match existing {
            Some(local) => {
                let local_hash = content_hash(&local);
                if local_hash == rec.content_hash {
                    stats.skipped += 1;
                    return Ok(());
                }

                match self.strategy {
                    MergeStrategy::PreferNewer => {
                        if rec.data.updated_at > local.updated_at {
                            self.storage
                                .upsert_plan(&rec.data)
                                .map_err(|e| SyncError::Database(e.to_string()))?;
                            stats.updated += 1;
                        } else {
                            stats.skipped += 1;
                        }
                    }
                    MergeStrategy::PreferLocal => {
                        stats.skipped += 1;
                    }
                    MergeStrategy::PreferExternal => {
                        self.storage
                            .upsert_plan(&rec.data)
                            .map_err(|e| SyncError::Database(e.to_string()))?;
                        stats.updated += 1;
                    }
                }
            }
            None => {
                self.storage
                    .upsert_plan(&rec.data)
                    .map_err(|e| SyncError::Database(e.to_string()))?;
                stats.created += 1;
            }
        }

        Ok(())
    }
}

/// Merge import stats from one operation into accumulated stats.
fn merge_stats(total: &mut ImportStats, add: &ImportStats) {
    total.sessions.created += add.sessions.created;
    total.sessions.updated += add.sessions.updated;
    total.sessions.skipped += add.sessions.skipped;
    total.sessions.conflicts += add.sessions.conflicts;

    total.issues.created += add.issues.created;
    total.issues.updated += add.issues.updated;
    total.issues.skipped += add.issues.skipped;
    total.issues.conflicts += add.issues.conflicts;

    total.context_items.created += add.context_items.created;
    total.context_items.updated += add.context_items.updated;
    total.context_items.skipped += add.context_items.skipped;
    total.context_items.conflicts += add.context_items.conflicts;

    total.memories.created += add.memories.created;
    total.memories.updated += add.memories.updated;
    total.memories.skipped += add.memories.skipped;
    total.memories.conflicts += add.memories.conflicts;

    total.checkpoints.created += add.checkpoints.created;
    total.checkpoints.updated += add.checkpoints.updated;
    total.checkpoints.skipped += add.checkpoints.skipped;
    total.checkpoints.conflicts += add.checkpoints.conflicts;

    total.plans.created += add.plans.created;
    total.plans.updated += add.plans.updated;
    total.plans.skipped += add.plans.skipped;
    total.plans.conflicts += add.plans.conflicts;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sqlite::Session;
    use crate::sync::file::write_jsonl;
    use tempfile::TempDir;

    fn make_session(id: &str, updated_at: i64) -> Session {
        Session {
            id: id.to_string(),
            name: "Test".to_string(),
            description: None,
            branch: None,
            channel: None,
            project_path: Some("/test".to_string()),
            status: "active".to_string(),
            ended_at: None,
            created_at: 1000,
            updated_at,
        }
    }

    #[test]
    fn test_import_new_session() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();

        // Create JSONL file with session
        let session = make_session("sess_1", 1000);
        let record = SyncRecord::Session(SessionRecord {
            data: session.clone(),
            content_hash: content_hash(&session),
            exported_at: "2025-01-20T00:00:00Z".to_string(),
        });
        let jsonl_path = temp_dir.path().join("sessions.jsonl");
        write_jsonl(&jsonl_path, &[record]).unwrap();

        // Import
        let mut importer = Importer::new(&mut storage, MergeStrategy::PreferNewer);
        let stats = importer.import(&jsonl_path).unwrap();

        assert_eq!(stats.sessions.created, 1);
        assert_eq!(stats.sessions.updated, 0);

        // Verify session exists
        let imported = storage.get_session("sess_1").unwrap();
        assert!(imported.is_some());
    }

    #[test]
    fn test_import_prefer_newer() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();

        // Create local session with older timestamp
        storage
            .create_session("sess_1", "Local", None, Some("/test"), None, "test")
            .unwrap();

        // Create JSONL with newer session
        let newer_session = Session {
            id: "sess_1".to_string(),
            name: "External".to_string(),
            description: None,
            branch: None,
            channel: None,
            project_path: Some("/test".to_string()),
            status: "active".to_string(),
            ended_at: None,
            created_at: 1000,
            updated_at: chrono::Utc::now().timestamp_millis() + 10000, // Future timestamp
        };
        let record = SyncRecord::Session(SessionRecord {
            data: newer_session.clone(),
            content_hash: content_hash(&newer_session),
            exported_at: "2025-01-20T00:00:00Z".to_string(),
        });
        let jsonl_path = temp_dir.path().join("sessions.jsonl");
        write_jsonl(&jsonl_path, &[record]).unwrap();

        // Import with PreferNewer
        let mut importer = Importer::new(&mut storage, MergeStrategy::PreferNewer);
        let stats = importer.import(&jsonl_path).unwrap();

        assert_eq!(stats.sessions.updated, 1);

        // Verify name was updated
        let imported = storage.get_session("sess_1").unwrap().unwrap();
        assert_eq!(imported.name, "External");
    }

    #[test]
    fn test_import_prefer_local() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let mut storage = SqliteStorage::open(&db_path).unwrap();

        // Create local session
        storage
            .create_session("sess_1", "Local", None, Some("/test"), None, "test")
            .unwrap();

        // Create JSONL with different session
        let external_session = Session {
            id: "sess_1".to_string(),
            name: "External".to_string(),
            description: None,
            branch: None,
            channel: None,
            project_path: Some("/test".to_string()),
            status: "active".to_string(),
            ended_at: None,
            created_at: 1000,
            updated_at: chrono::Utc::now().timestamp_millis() + 10000,
        };
        let record = SyncRecord::Session(SessionRecord {
            data: external_session.clone(),
            content_hash: content_hash(&external_session),
            exported_at: "2025-01-20T00:00:00Z".to_string(),
        });
        let jsonl_path = temp_dir.path().join("sessions.jsonl");
        write_jsonl(&jsonl_path, &[record]).unwrap();

        // Import with PreferLocal
        let mut importer = Importer::new(&mut storage, MergeStrategy::PreferLocal);
        let stats = importer.import(&jsonl_path).unwrap();

        assert_eq!(stats.sessions.skipped, 1);

        // Verify name was NOT updated
        let imported = storage.get_session("sess_1").unwrap().unwrap();
        assert_eq!(imported.name, "Local");
    }
}
