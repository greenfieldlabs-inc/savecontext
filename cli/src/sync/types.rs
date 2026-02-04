//! Sync types for JSONL export/import.
//!
//! This module defines the record types used in JSONL files for synchronization.
//! Each record type wraps the underlying data model with sync metadata.

use serde::{Deserialize, Serialize};

use crate::storage::sqlite::{Checkpoint, ContextItem, Issue, Memory, Session};

/// Tagged union for JSONL records.
///
/// Each line in a JSONL file is one of these record types, discriminated by the `type` field.
/// The serde tag attribute ensures the JSON looks like:
/// `{"type":"session","id":"sess_123",...}`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncRecord {
    /// A session record with sync metadata.
    Session(SessionRecord),
    /// An issue record with sync metadata.
    Issue(IssueRecord),
    /// A context item record with sync metadata.
    ContextItem(ContextItemRecord),
    /// A memory record with sync metadata.
    Memory(MemoryRecord),
    /// A checkpoint record with sync metadata.
    Checkpoint(CheckpointRecord),
}

/// Session with sync metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    /// The session data.
    #[serde(flatten)]
    pub data: Session,
    /// SHA256 hash of the serialized data (for change detection).
    pub content_hash: String,
    /// ISO8601 timestamp when this record was exported.
    pub exported_at: String,
}

/// Issue with sync metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueRecord {
    /// The issue data.
    #[serde(flatten)]
    pub data: Issue,
    /// SHA256 hash of the serialized data.
    pub content_hash: String,
    /// ISO8601 timestamp when this record was exported.
    pub exported_at: String,
}

/// Context item with sync metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextItemRecord {
    /// The context item data.
    #[serde(flatten)]
    pub data: ContextItem,
    /// SHA256 hash of the serialized data.
    pub content_hash: String,
    /// ISO8601 timestamp when this record was exported.
    pub exported_at: String,
}

/// Memory with sync metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecord {
    /// The memory data.
    #[serde(flatten)]
    pub data: Memory,
    /// SHA256 hash of the serialized data.
    pub content_hash: String,
    /// ISO8601 timestamp when this record was exported.
    pub exported_at: String,
}

/// Checkpoint with sync metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointRecord {
    /// The checkpoint data.
    #[serde(flatten)]
    pub data: Checkpoint,
    /// SHA256 hash of the serialized data.
    pub content_hash: String,
    /// ISO8601 timestamp when this record was exported.
    pub exported_at: String,
}

/// A deletion record for sync.
///
/// When a record is deleted locally, a deletion record is created so that
/// imports on other machines can apply the deletion. Unlike data records,
/// deletions are stored in a separate `deletions.jsonl` file.
///
/// # Git-Friendly Design
///
/// Deletions accumulate in the JSONL file, providing a history of what was deleted.
/// Git tracks when deletions were added, allowing teams to see what changed.
/// Periodically, old deletions can be compacted (removed) once all machines have synced.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletionRecord {
    /// The type of entity that was deleted.
    pub entity_type: EntityType,
    /// The ID of the deleted entity.
    pub entity_id: String,
    /// The project path this deletion belongs to.
    pub project_path: String,
    /// ISO8601 timestamp when the deletion occurred.
    pub deleted_at: String,
    /// Actor who performed the deletion.
    pub deleted_by: String,
}

/// Entity types for deletion tracking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    /// A session.
    Session,
    /// An issue.
    Issue,
    /// A context item.
    ContextItem,
    /// A memory item.
    Memory,
    /// A checkpoint.
    Checkpoint,
}

impl std::fmt::Display for EntityType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Session => write!(f, "session"),
            Self::Issue => write!(f, "issue"),
            Self::ContextItem => write!(f, "context_item"),
            Self::Memory => write!(f, "memory"),
            Self::Checkpoint => write!(f, "checkpoint"),
        }
    }
}

impl std::str::FromStr for EntityType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "session" => Ok(Self::Session),
            "issue" => Ok(Self::Issue),
            "context_item" => Ok(Self::ContextItem),
            "memory" => Ok(Self::Memory),
            "checkpoint" => Ok(Self::Checkpoint),
            _ => Err(format!("Unknown entity type: {s}")),
        }
    }
}

/// Conflict resolution strategy for imports.
///
/// When importing a record that already exists locally, this determines
/// which version wins.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MergeStrategy {
    /// Use the record with the newer `updated_at` timestamp.
    #[default]
    PreferNewer,
    /// Always keep the local version.
    PreferLocal,
    /// Always take the external (imported) version.
    PreferExternal,
}

/// Statistics for an export operation.
#[derive(Debug, Default, Clone, Serialize)]
pub struct ExportStats {
    /// Number of sessions exported.
    pub sessions: usize,
    /// Number of issues exported.
    pub issues: usize,
    /// Number of context items exported.
    pub context_items: usize,
    /// Number of memories exported.
    pub memories: usize,
    /// Number of checkpoints exported.
    pub checkpoints: usize,
    /// Number of deletions exported.
    pub deletions: usize,
}

impl ExportStats {
    /// Total number of data records exported (excludes deletions).
    #[must_use]
    pub fn total(&self) -> usize {
        self.sessions + self.issues + self.context_items + self.memories + self.checkpoints
    }

    /// Total including deletions.
    #[must_use]
    pub fn total_with_deletions(&self) -> usize {
        self.total() + self.deletions
    }

    /// Returns true if nothing was exported.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.total_with_deletions() == 0
    }
}

/// Statistics for an import operation.
#[derive(Debug, Default, Clone, Serialize)]
pub struct ImportStats {
    /// Statistics for sessions.
    pub sessions: EntityStats,
    /// Statistics for issues.
    pub issues: EntityStats,
    /// Statistics for context items.
    pub context_items: EntityStats,
    /// Statistics for memories.
    pub memories: EntityStats,
    /// Statistics for checkpoints.
    pub checkpoints: EntityStats,
}

impl ImportStats {
    /// Total number of records processed.
    #[must_use]
    pub fn total_processed(&self) -> usize {
        self.sessions.total()
            + self.issues.total()
            + self.context_items.total()
            + self.memories.total()
            + self.checkpoints.total()
    }

    /// Total number of records created.
    #[must_use]
    pub fn total_created(&self) -> usize {
        self.sessions.created
            + self.issues.created
            + self.context_items.created
            + self.memories.created
            + self.checkpoints.created
    }

    /// Total number of records updated.
    #[must_use]
    pub fn total_updated(&self) -> usize {
        self.sessions.updated
            + self.issues.updated
            + self.context_items.updated
            + self.memories.updated
            + self.checkpoints.updated
    }
}

/// Per-entity statistics for import operations.
#[derive(Debug, Default, Clone, Serialize)]
pub struct EntityStats {
    /// Number of new records created.
    pub created: usize,
    /// Number of existing records updated.
    pub updated: usize,
    /// Number of records skipped (no change or merge strategy chose local).
    pub skipped: usize,
    /// Number of conflicts encountered.
    pub conflicts: usize,
}

impl EntityStats {
    /// Total records processed.
    #[must_use]
    pub fn total(&self) -> usize {
        self.created + self.updated + self.skipped + self.conflicts
    }
}

/// Sync status information.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    /// Number of dirty sessions pending export.
    pub dirty_sessions: usize,
    /// Number of dirty issues pending export.
    pub dirty_issues: usize,
    /// Number of dirty context items pending export.
    pub dirty_context_items: usize,
    /// Number of pending deletions to export.
    pub pending_deletions: usize,
    /// Total sessions for this project.
    pub total_sessions: usize,
    /// Total issues for this project.
    pub total_issues: usize,
    /// Total context items for this project.
    pub total_context_items: usize,
    /// Whether a backfill is needed (data exists but no dirty records).
    pub needs_backfill: bool,
    /// Whether any export files exist.
    pub has_export_files: bool,
    /// List of export files with their sizes.
    pub export_files: Vec<ExportFileInfo>,
}

/// Information about an export file.
#[derive(Debug, Clone, Serialize)]
pub struct ExportFileInfo {
    /// File name (e.g., "sessions.jsonl").
    pub name: String,
    /// File size in bytes.
    pub size: u64,
    /// Number of lines (records) in the file.
    pub line_count: usize,
}

/// Sync-specific errors.
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// IO error during file operations.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialization/deserialization error.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Database error.
    #[error("Database error: {0}")]
    Database(String),

    /// No dirty records to export.
    #[error("No dirty records to export (use --force to export all)")]
    NothingToExport,

    /// JSONL file not found.
    #[error("JSONL file not found: {0}")]
    FileNotFound(String),

    /// Invalid record format.
    #[error("Invalid record at line {line}: {message}")]
    InvalidRecord {
        /// Line number (1-indexed).
        line: usize,
        /// Error message.
        message: String,
    },
}

impl From<rusqlite::Error> for SyncError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Database(err.to_string())
    }
}

/// Result type for sync operations.
pub type SyncResult<T> = std::result::Result<T, SyncError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_export_stats() {
        let mut stats = ExportStats::default();
        assert!(stats.is_empty());

        stats.sessions = 5;
        stats.issues = 3;
        assert_eq!(stats.total(), 8);
        assert!(!stats.is_empty());
    }

    #[test]
    fn test_entity_stats() {
        let stats = EntityStats {
            created: 10,
            updated: 5,
            skipped: 2,
            conflicts: 1,
        };
        assert_eq!(stats.total(), 18);
    }

    #[test]
    fn test_merge_strategy_default() {
        let strategy = MergeStrategy::default();
        assert_eq!(strategy, MergeStrategy::PreferNewer);
    }
}
