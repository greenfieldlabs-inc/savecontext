//! SQLite storage layer for SaveContext.
//!
//! This module provides the persistence layer using SQLite with:
//! - WAL mode for concurrent reads
//! - Transaction discipline for atomic writes
//! - Dirty tracking for JSONL export
//! - Audit events for history
//!
//! # Submodules
//!
//! - [`events`] - Audit event storage
//! - [`schema`] - Database schema definitions
//! - [`sqlite`] - Main SQLite storage implementation

pub mod events;
pub mod migrations;
pub mod schema;
pub mod sqlite;

pub use sqlite::{
    BackfillStats, Checkpoint, ContextItem, Issue, Memory, MutationContext, ProjectCounts,
    SemanticSearchResult, Session, SqliteStorage,
};
