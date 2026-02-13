//! Error types for SaveContext CLI.
//!
//! Provides structured error handling with:
//! - Machine-readable error codes (`ErrorCode`)
//! - Category-based exit codes (2=db, 3=not_found, 4=validation, etc.)
//! - Retryability flags for agent self-correction
//! - Context-aware recovery hints
//! - Structured JSON output for piped / non-TTY consumers

use std::path::PathBuf;
use thiserror::Error;

/// Result type alias for SaveContext operations.
pub type Result<T> = std::result::Result<T, Error>;

// ── Error Code ────────────────────────────────────────────────

/// Machine-readable error codes grouped by category.
///
/// Each code maps to a SCREAMING_SNAKE string and a category-based
/// exit code. Agents match on the string; shell scripts on the exit code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    // Database (exit 2)
    NotInitialized,
    AlreadyInitialized,
    DatabaseError,

    // Not Found (exit 3)
    SessionNotFound,
    IssueNotFound,
    CheckpointNotFound,
    ProjectNotFound,
    NoActiveSession,
    AmbiguousId,

    // Validation (exit 4)
    InvalidStatus,
    InvalidType,
    InvalidPriority,
    InvalidArgument,
    InvalidSessionStatus,
    RequiredField,

    // Dependency (exit 5)
    CycleDetected,
    HasDependents,

    // Sync (exit 6)
    SyncError,

    // Config (exit 7)
    ConfigError,

    // I/O (exit 8)
    IoError,
    JsonError,

    // Embedding (exit 9)
    EmbeddingError,

    // Internal (exit 1)
    InternalError,
}

impl ErrorCode {
    /// Machine-readable SCREAMING_SNAKE code string.
    #[must_use]
    pub const fn as_str(&self) -> &str {
        match self {
            Self::NotInitialized => "NOT_INITIALIZED",
            Self::AlreadyInitialized => "ALREADY_INITIALIZED",
            Self::DatabaseError => "DATABASE_ERROR",
            Self::SessionNotFound => "SESSION_NOT_FOUND",
            Self::IssueNotFound => "ISSUE_NOT_FOUND",
            Self::CheckpointNotFound => "CHECKPOINT_NOT_FOUND",
            Self::ProjectNotFound => "PROJECT_NOT_FOUND",
            Self::NoActiveSession => "NO_ACTIVE_SESSION",
            Self::AmbiguousId => "AMBIGUOUS_ID",
            Self::InvalidStatus => "INVALID_STATUS",
            Self::InvalidType => "INVALID_TYPE",
            Self::InvalidPriority => "INVALID_PRIORITY",
            Self::InvalidArgument => "INVALID_ARGUMENT",
            Self::InvalidSessionStatus => "INVALID_SESSION_STATUS",
            Self::RequiredField => "REQUIRED_FIELD",
            Self::CycleDetected => "CYCLE_DETECTED",
            Self::HasDependents => "HAS_DEPENDENTS",
            Self::SyncError => "SYNC_ERROR",
            Self::ConfigError => "CONFIG_ERROR",
            Self::IoError => "IO_ERROR",
            Self::JsonError => "JSON_ERROR",
            Self::EmbeddingError => "EMBEDDING_ERROR",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }

    /// Category-based exit code (1-9).
    #[must_use]
    pub const fn exit_code(&self) -> u8 {
        match self {
            Self::InternalError => 1,
            Self::NotInitialized | Self::AlreadyInitialized | Self::DatabaseError => 2,
            Self::SessionNotFound
            | Self::IssueNotFound
            | Self::CheckpointNotFound
            | Self::ProjectNotFound
            | Self::NoActiveSession
            | Self::AmbiguousId => 3,
            Self::InvalidStatus
            | Self::InvalidType
            | Self::InvalidPriority
            | Self::InvalidArgument
            | Self::InvalidSessionStatus
            | Self::RequiredField => 4,
            Self::CycleDetected | Self::HasDependents => 5,
            Self::SyncError => 6,
            Self::ConfigError => 7,
            Self::IoError | Self::JsonError => 8,
            Self::EmbeddingError => 9,
        }
    }

    /// Whether an agent should retry with corrected input.
    ///
    /// True for validation errors (wrong status, type, priority) and
    /// ambiguous IDs. False for not-found, I/O, or internal errors.
    #[must_use]
    pub const fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::InvalidStatus
                | Self::InvalidType
                | Self::InvalidPriority
                | Self::InvalidArgument
                | Self::InvalidSessionStatus
                | Self::RequiredField
                | Self::AmbiguousId
                | Self::DatabaseError
        )
    }
}

// ── Error Enum ────────────────────────────────────────────────

/// Errors that can occur in SaveContext CLI operations.
#[derive(Error, Debug)]
pub enum Error {
    #[error("Not initialized: run `sc init` first")]
    NotInitialized,

    #[error("Already initialized at {path}")]
    AlreadyInitialized { path: PathBuf },

    #[error("Session not found: {id}")]
    SessionNotFound { id: String },

    #[error("Session not found: {id} (did you mean: {}?)", similar.join(", "))]
    SessionNotFoundSimilar { id: String, similar: Vec<String> },

    #[error("No active session")]
    NoActiveSession,

    #[error("No active session (recent sessions available)")]
    NoActiveSessionWithRecent {
        /// (short_id, name, status) of recent resumable sessions.
        recent: Vec<(String, String, String)>,
    },

    #[error("Invalid session status: expected {expected}, got {actual}")]
    InvalidSessionStatus { expected: String, actual: String },

    #[error("Issue not found: {id}")]
    IssueNotFound { id: String },

    #[error("Issue not found: {id} (did you mean: {}?)", similar.join(", "))]
    IssueNotFoundSimilar { id: String, similar: Vec<String> },

    #[error("Checkpoint not found: {id}")]
    CheckpointNotFound { id: String },

    #[error("Checkpoint not found: {id} (did you mean: {}?)", similar.join(", "))]
    CheckpointNotFoundSimilar { id: String, similar: Vec<String> },

    #[error("Project not found: {id}")]
    ProjectNotFound { id: String },

    #[error("No project found for current directory: {cwd}")]
    NoProjectForDirectory {
        cwd: String,
        /// (path, name) of known projects for hint display.
        available: Vec<(String, String)>,
    },

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Invalid argument: {0}")]
    InvalidArgument(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Embedding error: {0}")]
    Embedding(String),

    #[error("{0}")]
    Other(String),
}

impl Error {
    /// Map this error to its structured `ErrorCode`.
    #[must_use]
    pub const fn error_code(&self) -> ErrorCode {
        match self {
            Self::NotInitialized => ErrorCode::NotInitialized,
            Self::AlreadyInitialized { .. } => ErrorCode::AlreadyInitialized,
            Self::Database(_) => ErrorCode::DatabaseError,
            Self::SessionNotFound { .. } | Self::SessionNotFoundSimilar { .. } => {
                ErrorCode::SessionNotFound
            }
            Self::IssueNotFound { .. } | Self::IssueNotFoundSimilar { .. } => {
                ErrorCode::IssueNotFound
            }
            Self::CheckpointNotFound { .. } | Self::CheckpointNotFoundSimilar { .. } => {
                ErrorCode::CheckpointNotFound
            }
            Self::ProjectNotFound { .. } | Self::NoProjectForDirectory { .. } => {
                ErrorCode::ProjectNotFound
            }
            Self::NoActiveSession | Self::NoActiveSessionWithRecent { .. } => {
                ErrorCode::NoActiveSession
            }
            Self::InvalidSessionStatus { .. } => ErrorCode::InvalidSessionStatus,
            Self::InvalidArgument(_) => ErrorCode::InvalidArgument,
            Self::Config(_) => ErrorCode::ConfigError,
            Self::Embedding(_) => ErrorCode::EmbeddingError,
            Self::Io(_) => ErrorCode::IoError,
            Self::Json(_) => ErrorCode::JsonError,
            Self::Other(_) => ErrorCode::InternalError,
        }
    }

    /// Category-based exit code, delegating to the `ErrorCode`.
    #[must_use]
    pub const fn exit_code(&self) -> u8 {
        self.error_code().exit_code()
    }

    /// Context-aware recovery hint for agents and humans.
    ///
    /// Returns `None` if no actionable suggestion exists.
    #[must_use]
    pub fn hint(&self) -> Option<String> {
        match self {
            Self::NotInitialized => Some("Run `sc init` to initialize the database".to_string()),

            Self::AlreadyInitialized { path } => Some(format!(
                "Database already exists at {}. Use `--force` to reinitialize.",
                path.display()
            )),

            Self::NoActiveSession => Some(
                "No session bound to this terminal.\n  \
                 Resume: sc session resume <session-id>\n  \
                 Start:  sc session start \"session name\""
                    .to_string(),
            ),

            Self::NoActiveSessionWithRecent { recent } => {
                let mut hint = String::from("Recent sessions you can resume:\n");
                for (id, name, status) in recent {
                    hint.push_str(&format!("    {id}  \"{name}\" ({status})\n"));
                }
                hint.push_str("  Resume: sc session resume <session-id>\n");
                hint.push_str("  Start:  sc session start \"session name\"");
                Some(hint)
            }

            Self::SessionNotFound { id } => Some(format!(
                "No session with ID '{id}'. Use `sc session list` to see available sessions."
            )),
            Self::SessionNotFoundSimilar { similar, .. } => {
                Some(format!("Did you mean: {}?", similar.join(", ")))
            }

            Self::IssueNotFound { id } => Some(format!(
                "No issue with ID '{id}'. Use `sc issue list` to see available issues."
            )),
            Self::IssueNotFoundSimilar { similar, .. } => {
                Some(format!("Did you mean: {}?", similar.join(", ")))
            }

            Self::CheckpointNotFound { id } => Some(format!(
                "No checkpoint with ID '{id}'. Use `sc checkpoint list` to see available checkpoints."
            )),
            Self::CheckpointNotFoundSimilar { similar, .. } => {
                Some(format!("Did you mean: {}?", similar.join(", ")))
            }

            Self::ProjectNotFound { id } => Some(format!(
                "No project with ID '{id}'. Use `sc project list` to see available projects."
            )),

            Self::NoProjectForDirectory { cwd, available } => {
                let mut hint = format!("No project registered for '{cwd}'.\n");
                if available.is_empty() {
                    hint.push_str("  No projects exist yet.\n");
                    hint.push_str(&format!("  Create one: sc project create {cwd}"));
                } else {
                    hint.push_str("  Known projects:\n");
                    for (path, name) in available.iter().take(5) {
                        hint.push_str(&format!("    {path}  \"{name}\"\n"));
                    }
                    if available.len() > 5 {
                        hint.push_str(&format!("    ... and {} more\n", available.len() - 5));
                    }
                    hint.push_str(&format!("  Create one: sc project create {cwd}"));
                }
                Some(hint)
            }

            Self::InvalidSessionStatus { expected, actual } => Some(format!(
                "Session is '{actual}' but needs to be '{expected}'. \
                 Use `sc session list` to check session states."
            )),

            Self::InvalidArgument(msg) => {
                // Check for validation-style messages and add synonym hints
                if msg.contains("status") {
                    Some(
                        "Valid statuses: backlog, open, in_progress, blocked, closed, deferred. \
                         Synonyms: done→closed, wip→in_progress, todo→open"
                            .to_string(),
                    )
                } else if msg.contains("type") {
                    Some(
                        "Valid types: task, bug, feature, epic, chore. \
                         Synonyms: story→feature, defect→bug, cleanup→chore"
                            .to_string(),
                    )
                } else if msg.contains("priority") {
                    Some(
                        "Valid priorities: 0-4, P0-P4, or names: critical, high, medium, low, backlog"
                            .to_string(),
                    )
                } else {
                    None
                }
            }

            Self::Database(_) | Self::Io(_) | Self::Json(_) | Self::Config(_)
            | Self::Embedding(_) | Self::Other(_) => None,
        }
    }

    /// Structured JSON representation for machine consumption.
    ///
    /// Includes error code, message, retryability, exit code, and
    /// optional recovery hint. Agents parse this instead of stderr text.
    #[must_use]
    pub fn to_structured_json(&self) -> serde_json::Value {
        let code = self.error_code();
        let mut obj = serde_json::json!({
            "error": {
                "code": code.as_str(),
                "message": self.to_string(),
                "retryable": code.is_retryable(),
                "exit_code": code.exit_code(),
            }
        });

        if let Some(hint) = self.hint() {
            obj["error"]["hint"] = serde_json::Value::String(hint);
        }

        obj
    }
}
