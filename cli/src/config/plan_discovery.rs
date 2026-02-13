//! Multi-agent plan file discovery.
//!
//! Discovers plan files written by AI coding agents:
//! - Claude Code: `~/.claude/plans/*.md`
//! - Gemini CLI: `~/.gemini/tmp/<sha256(project)>/plans/*.md`
//! - OpenCode: `<project>/.opencode/plans/*.md`
//! - Cursor: `<project>/.cursor/plans/*.md`
//!
//! Used by `sc plan capture` to import plans into SaveContext.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// A plan file discovered from an AI coding agent.
#[derive(Debug, Clone)]
pub struct DiscoveredPlan {
    /// Path to the plan file.
    pub path: PathBuf,
    /// Which agent created this plan.
    pub agent: AgentKind,
    /// Extracted title (from first heading or filename).
    pub title: String,
    /// Full markdown content.
    pub content: String,
    /// Last modification time.
    pub modified_at: SystemTime,
}

/// Supported AI coding agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    ClaudeCode,
    GeminiCli,
    OpenCode,
    Cursor,
}

impl AgentKind {
    /// Parse from CLI argument string.
    pub fn from_arg(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "claude" | "claude-code" => Some(Self::ClaudeCode),
            "gemini" | "gemini-cli" => Some(Self::GeminiCli),
            "opencode" | "open-code" => Some(Self::OpenCode),
            "cursor" => Some(Self::Cursor),
            _ => None,
        }
    }

    /// Display name for the agent.
    pub const fn display_name(&self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::GeminiCli => "Gemini CLI",
            Self::OpenCode => "OpenCode",
            Self::Cursor => "Cursor",
        }
    }
}

/// Discover plan files from all supported agents.
///
/// Returns plans sorted by modification time (most recent first),
/// filtered to those modified within `max_age` duration.
pub fn discover_plans(
    project_path: &Path,
    agent_filter: Option<AgentKind>,
    max_age: Duration,
) -> Vec<DiscoveredPlan> {
    let cutoff = SystemTime::now()
        .checked_sub(max_age)
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let agents: Vec<AgentKind> = match agent_filter {
        Some(agent) => vec![agent],
        None => vec![
            AgentKind::ClaudeCode,
            AgentKind::GeminiCli,
            AgentKind::OpenCode,
            AgentKind::Cursor,
        ],
    };

    let mut plans: Vec<DiscoveredPlan> = Vec::new();

    for agent in agents {
        let dirs = plan_directories(agent, project_path);
        for dir in dirs {
            if dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.extension().map_or(false, |e| e == "md") {
                            if let Some(plan) = read_plan_file(&path, agent, cutoff) {
                                plans.push(plan);
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by modification time, most recent first
    plans.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    plans
}

/// Get the plan directories for a specific agent.
fn plan_directories(agent: AgentKind, project_path: &Path) -> Vec<PathBuf> {
    match agent {
        AgentKind::ClaudeCode => {
            // Check settings.json for custom plansDirectory
            let home = directories::BaseDirs::new()
                .map(|b| b.home_dir().to_path_buf());

            if let Some(home) = home {
                let custom_dir = claude_plans_directory(&home);
                if let Some(dir) = custom_dir {
                    return vec![dir];
                }
                vec![home.join(".claude").join("plans")]
            } else {
                vec![]
            }
        }
        AgentKind::GeminiCli => {
            // ~/.gemini/tmp/<sha256(project_path)>/plans/
            let gemini_home = std::env::var("GEMINI_CLI_HOME")
                .map(PathBuf::from)
                .ok()
                .or_else(|| {
                    directories::BaseDirs::new()
                        .map(|b| b.home_dir().join(".gemini"))
                });

            if let Some(gemini_home) = gemini_home {
                // Compute SHA-256 of canonicalized project path
                let canonical = std::fs::canonicalize(project_path)
                    .unwrap_or_else(|_| project_path.to_path_buf());
                let path_str = canonical.to_string_lossy();
                let mut hasher = Sha256::new();
                hasher.update(path_str.as_bytes());
                let hash = format!("{:x}", hasher.finalize());

                vec![gemini_home.join("tmp").join(hash).join("plans")]
            } else {
                vec![]
            }
        }
        AgentKind::OpenCode => {
            vec![project_path.join(".opencode").join("plans")]
        }
        AgentKind::Cursor => {
            vec![project_path.join(".cursor").join("plans")]
        }
    }
}

/// Try to read a custom plansDirectory from Claude Code settings.
fn claude_plans_directory(home: &Path) -> Option<PathBuf> {
    let settings_path = home.join(".claude").join("settings.json");
    if !settings_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&settings_path).ok()?;
    let settings: serde_json::Value = serde_json::from_str(&content).ok()?;
    let plans_dir = settings.get("plansDirectory")?.as_str()?;

    let path = PathBuf::from(plans_dir);
    if path.is_absolute() {
        Some(path)
    } else {
        Some(home.join(".claude").join(path))
    }
}

/// Read and validate a plan file.
fn read_plan_file(
    path: &Path,
    agent: AgentKind,
    cutoff: SystemTime,
) -> Option<DiscoveredPlan> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;

    // Skip files older than cutoff
    if modified < cutoff {
        return None;
    }

    let content = std::fs::read_to_string(path).ok()?;
    if content.trim().is_empty() {
        return None;
    }

    let filename = path.file_stem()?.to_string_lossy().to_string();
    let title = extract_title(&content, &filename);

    Some(DiscoveredPlan {
        path: path.to_path_buf(),
        agent,
        title,
        content,
        modified_at: modified,
    })
}

/// Extract a title from plan content.
///
/// Tries the first markdown heading, falls back to humanized filename.
pub fn extract_title(content: &str, filename: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") {
            return trimmed[2..].trim().to_string();
        }
    }

    // Fallback: humanize filename (hyphens/underscores → spaces, title case first word)
    filename.replace('-', " ").replace('_', " ")
}

/// Compute SHA-256 hash of file content (for deduplication).
pub fn compute_content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_title_from_heading() {
        assert_eq!(
            extract_title("# My Plan\n\nSome content", "fallback"),
            "My Plan"
        );
    }

    #[test]
    fn test_extract_title_fallback() {
        assert_eq!(
            extract_title("No heading here\nJust text", "my-plan-name"),
            "my plan name"
        );
    }

    #[test]
    fn test_agent_kind_from_arg() {
        assert_eq!(AgentKind::from_arg("claude"), Some(AgentKind::ClaudeCode));
        assert_eq!(AgentKind::from_arg("gemini"), Some(AgentKind::GeminiCli));
        assert_eq!(AgentKind::from_arg("opencode"), Some(AgentKind::OpenCode));
        assert_eq!(AgentKind::from_arg("cursor"), Some(AgentKind::Cursor));
        assert_eq!(AgentKind::from_arg("unknown"), None);
    }

    #[test]
    fn test_compute_content_hash() {
        let hash = compute_content_hash("test content");
        assert_eq!(hash.len(), 64); // SHA-256 hex
    }
}
