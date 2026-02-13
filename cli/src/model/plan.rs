//! Plan model for SaveContext.
//!
//! Plans represent PRDs, specs, or feature documentation that can be linked
//! to epics and issues for tracking implementation.

use serde::{Deserialize, Serialize};

/// Plan status values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanStatus {
    Draft,
    Active,
    Completed,
}

impl PlanStatus {
    /// Get the string representation for storage.
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Active => "active",
            Self::Completed => "completed",
        }
    }

    /// Parse from string.
    #[must_use]
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "active" => Self::Active,
            "completed" => Self::Completed,
            _ => Self::Draft,
        }
    }
}

impl Default for PlanStatus {
    fn default() -> Self {
        Self::Draft
    }
}

/// A plan in SaveContext.
///
/// Plans provide:
/// - PRD/specification storage
/// - Linkage to epics and issues
/// - Success criteria tracking
/// - Status progression (draft -> active -> completed)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    /// Unique identifier (UUID format)
    pub id: String,

    /// Short ID for easy reference (e.g., "PLAN-1")
    pub short_id: Option<String>,

    /// Project ID this plan belongs to
    pub project_id: String,

    /// Project path for queries
    pub project_path: String,

    /// Plan title
    pub title: String,

    /// Plan content (markdown PRD/spec)
    pub content: Option<String>,

    /// Current status
    pub status: PlanStatus,

    /// Success criteria for completion
    pub success_criteria: Option<String>,

    /// Session this plan is bound to (TTY-resolved)
    pub session_id: Option<String>,

    /// Session where this plan was created (legacy metadata)
    pub created_in_session: Option<String>,

    /// Session where this plan was completed
    pub completed_in_session: Option<String>,

    /// Source file path (for multi-agent capture dedup)
    pub source_path: Option<String>,

    /// SHA-256 hash of source file content (for dedup)
    pub source_hash: Option<String>,

    /// Creation timestamp (Unix milliseconds)
    pub created_at: i64,

    /// Last update timestamp (Unix milliseconds)
    pub updated_at: i64,

    /// Completion timestamp (Unix milliseconds)
    pub completed_at: Option<i64>,
}

impl Plan {
    /// Create a new plan with default values.
    pub fn new(project_id: String, project_path: String, title: String) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        let id = format!("plan_{}", &uuid::Uuid::new_v4().to_string()[..12]);

        Self {
            id,
            short_id: None,
            project_id,
            project_path,
            title,
            content: None,
            status: PlanStatus::Draft,
            success_criteria: None,
            session_id: None,
            created_in_session: None,
            completed_in_session: None,
            source_path: None,
            source_hash: None,
            created_at: now,
            updated_at: now,
            completed_at: None,
        }
    }

    /// Set the plan content.
    #[must_use]
    pub fn with_content(mut self, content: &str) -> Self {
        self.content = Some(content.to_string());
        self
    }

    /// Set the plan status.
    #[must_use]
    pub fn with_status(mut self, status: PlanStatus) -> Self {
        self.status = status;
        self
    }

    /// Set the success criteria.
    #[must_use]
    pub fn with_success_criteria(mut self, criteria: &str) -> Self {
        self.success_criteria = Some(criteria.to_string());
        self
    }

    /// Bind to a session.
    #[must_use]
    pub fn with_session(mut self, session_id: &str) -> Self {
        self.session_id = Some(session_id.to_string());
        self
    }

    /// Set the source file path and content hash (for capture dedup).
    #[must_use]
    pub fn with_source(mut self, path: &str, hash: &str) -> Self {
        self.source_path = Some(path.to_string());
        self.source_hash = Some(hash.to_string());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_plan() {
        let plan = Plan::new(
            "proj_123".to_string(),
            "/home/user/myproject".to_string(),
            "Authentication System".to_string(),
        );

        assert!(plan.id.starts_with("plan_"));
        assert_eq!(plan.project_id, "proj_123");
        assert_eq!(plan.title, "Authentication System");
        assert_eq!(plan.status, PlanStatus::Draft);
    }

    #[test]
    fn test_plan_status_parsing() {
        assert_eq!(PlanStatus::from_str("draft"), PlanStatus::Draft);
        assert_eq!(PlanStatus::from_str("active"), PlanStatus::Active);
        assert_eq!(PlanStatus::from_str("completed"), PlanStatus::Completed);
        assert_eq!(PlanStatus::from_str("unknown"), PlanStatus::Draft);
    }
}
