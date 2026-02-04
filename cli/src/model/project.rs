//! Project model for SaveContext.
//!
//! Projects represent distinct codebases/directories that can have their own
//! issue prefixes, plans, and memory.

use serde::{Deserialize, Serialize};

/// A project in SaveContext.
///
/// Projects provide:
/// - Issue ID prefixes (e.g., "SC" -> SC-1, SC-2)
/// - Plan tracking
/// - Project-level memory
/// - Session grouping
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// Unique identifier (UUID format)
    pub id: String,

    /// Absolute path to the project directory
    pub project_path: String,

    /// Display name for the project
    pub name: String,

    /// Optional description
    pub description: Option<String>,

    /// Prefix for issue short IDs (e.g., "SC" creates SC-1, SC-2)
    pub issue_prefix: Option<String>,

    /// Next issue number to assign
    #[serde(default = "default_one")]
    pub next_issue_number: i32,

    /// Prefix for plan short IDs
    pub plan_prefix: Option<String>,

    /// Next plan number to assign
    #[serde(default = "default_one")]
    pub next_plan_number: i32,

    /// Creation timestamp (Unix milliseconds)
    pub created_at: i64,

    /// Last update timestamp (Unix milliseconds)
    pub updated_at: i64,
}

fn default_one() -> i32 {
    1
}

impl Project {
    /// Create a new project with default values.
    pub fn new(project_path: String, name: String) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        let id = format!("proj_{}", &uuid::Uuid::new_v4().to_string()[..12]);

        // Generate default issue prefix from first 2-4 chars of name
        let issue_prefix = name
            .chars()
            .filter(|c| c.is_alphanumeric())
            .take(4)
            .collect::<String>()
            .to_uppercase();

        Self {
            id,
            project_path,
            name,
            description: None,
            issue_prefix: Some(issue_prefix),
            next_issue_number: 1,
            plan_prefix: None,
            next_plan_number: 1,
            created_at: now,
            updated_at: now,
        }
    }

    /// Generate the next issue short ID.
    pub fn next_issue_short_id(&self) -> String {
        let prefix = self.issue_prefix.as_deref().unwrap_or("SC");
        format!("{}-{}", prefix, self.next_issue_number)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_project() {
        let project = Project::new(
            "/home/user/myproject".to_string(),
            "My Project".to_string(),
        );

        assert!(project.id.starts_with("proj_"));
        assert_eq!(project.project_path, "/home/user/myproject");
        assert_eq!(project.name, "My Project");
        assert_eq!(project.issue_prefix, Some("MYPR".to_string()));
        assert_eq!(project.next_issue_number, 1);
    }

    #[test]
    fn test_next_issue_short_id() {
        let mut project = Project::new(
            "/test".to_string(),
            "Test".to_string(),
        );
        project.issue_prefix = Some("TEST".to_string());
        project.next_issue_number = 42;

        assert_eq!(project.next_issue_short_id(), "TEST-42");
    }
}
