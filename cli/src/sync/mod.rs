//! JSONL sync operations.
//!
//! This module provides git-friendly synchronization via JSONL files:
//!
//! - **Export**: Dirty records → JSONL files (incremental or full)
//! - **Import**: JSONL files → SQLite with merge strategies
//! - **Hashing**: SHA256 content hashing for change detection
//! - **Status**: View pending exports and file statistics
//!
//! # Architecture
//!
//! The sync system uses a dirty tracking pattern:
//! 1. SQLite triggers mark records as "dirty" on INSERT/UPDATE
//! 2. Export reads dirty records, writes to JSONL, clears dirty flags
//! 3. Import reads JSONL, applies merge strategy, upserts records
//!
//! # File Format
//!
//! Each JSONL file contains one record per line with a `type` tag:
//! ```json
//! {"type":"session","id":"sess_123","name":"My Session",...,"content_hash":"abc","exported_at":"2025-01-20T10:00:00Z"}
//! ```
//!
//! # Example
//!
//! ```ignore
//! use savecontext::sync::{Exporter, Importer, MergeStrategy, status};
//!
//! // Export dirty records
//! let mut exporter = Exporter::new(&mut storage, output_dir);
//! let stats = exporter.export(false)?;  // incremental
//!
//! // Import with conflict resolution
//! let mut importer = Importer::new(&mut storage, MergeStrategy::PreferNewer);
//! let stats = importer.import_all(&input_dir)?;
//!
//! // Check sync status
//! let status = status::get_sync_status(&storage, &export_dir)?;
//! ```

mod export;
mod file;
mod hash;
mod import;
mod status;
mod types;

// Re-export main types and functions
pub use export::{default_export_dir, project_export_dir, Exporter};
pub use file::{
    append_jsonl, atomic_write, count_lines, ensure_gitignore, file_size, gitignore_content,
    read_jsonl, write_jsonl,
};
pub use hash::{content_hash, has_changed};
pub use import::Importer;
pub use status::{get_sync_status, print_status};
pub use types::{
    CheckpointRecord, ContextItemRecord, DeletionRecord, EntityStats, EntityType, ExportFileInfo,
    ExportStats, ImportStats, IssueRecord, MemoryRecord, MergeStrategy, PlanRecord, SessionRecord,
    SyncError, SyncRecord, SyncResult, SyncStatus,
};
