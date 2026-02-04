//! SaveContext CLI - The OS for AI coding agents
//!
//! This crate provides the core functionality for the `sc` CLI tool.
//!
//! # Architecture
//!
//! - [`cli`] - Command-line interface using clap
//! - [`model`] - Data types (Session, Issue, ContextItem, Checkpoint, Plan)
//! - [`storage`] - SQLite database layer
//! - [`sync`] - JSONL import/export operations
//! - [`config`] - Configuration management
//! - [`embeddings`] - Embedding providers (Ollama, HuggingFace)
//! - [`error`] - Error types and handling

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod cli;
pub mod config;
pub mod embeddings;
pub mod error;
pub mod model;
pub mod storage;
pub mod sync;
pub mod validate;

pub use error::{Error, Result};

/// Global silent mode flag for `--silent` output.
///
/// When set, create/mutate commands print only the ID or key
/// instead of full output. Avoids threading a `silent` bool
/// through every handler signature.
pub static SILENT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Global dry-run flag for `--dry-run`.
///
/// When set, mutate commands preview what would happen without writing.
pub static DRY_RUN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Global CSV output flag (set when `--format csv`).
pub static CSV_OUTPUT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Check if silent mode is active.
#[inline]
pub fn is_silent() -> bool {
    SILENT.load(std::sync::atomic::Ordering::Relaxed)
}

/// Check if dry-run mode is active.
#[inline]
pub fn is_dry_run() -> bool {
    DRY_RUN.load(std::sync::atomic::Ordering::Relaxed)
}

/// Check if CSV output is requested.
#[inline]
pub fn is_csv() -> bool {
    CSV_OUTPUT.load(std::sync::atomic::Ordering::Relaxed)
}

/// Escape a value for CSV output (wrap in quotes if it contains commas, quotes, or newlines).
pub fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
