//! Prime command implementation.
//!
//! Generates a context primer for AI coding agents by aggregating
//! session state, issues, memory, and optionally Claude Code transcripts
//! into a single injectable context block.
//!
//! This is a **read-only** command — it never mutates the database.

use crate::config::{current_git_branch, current_project_path, resolve_db_path, resolve_session_or_suggest};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

/// Limits for prime context items
const HIGH_PRIORITY_LIMIT: u32 = 10;
const DECISION_LIMIT: u32 = 10;
const REMINDER_LIMIT: u32 = 10;
const PROGRESS_LIMIT: u32 = 5;
const READY_ISSUES_LIMIT: u32 = 10;
const MEMORY_DISPLAY_LIMIT: usize = 20;

// ============================================================================
// JSON Output Structures
// ============================================================================

#[derive(Serialize)]
struct PrimeOutput {
    session: SessionInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    git: Option<GitInfo>,
    context: ContextBlock,
    issues: IssueBlock,
    memory: Vec<MemoryEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transcript: Option<TranscriptBlock>,
    command_reference: Vec<CmdRef>,
}

#[derive(Serialize)]
struct SessionInfo {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
}

#[derive(Serialize)]
struct GitInfo {
    branch: String,
    changed_files: Vec<String>,
}

#[derive(Serialize)]
struct ContextBlock {
    high_priority: Vec<ContextEntry>,
    decisions: Vec<ContextEntry>,
    reminders: Vec<ContextEntry>,
    recent_progress: Vec<ContextEntry>,
    total_items: usize,
}

#[derive(Serialize)]
struct ContextEntry {
    key: String,
    value: String,
    category: String,
    priority: String,
}

#[derive(Serialize)]
struct IssueBlock {
    active: Vec<IssueSummary>,
    ready: Vec<IssueSummary>,
    total_open: usize,
}

#[derive(Serialize)]
struct IssueSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    short_id: Option<String>,
    title: String,
    status: String,
    priority: i32,
    issue_type: String,
}

#[derive(Serialize)]
struct MemoryEntry {
    key: String,
    value: String,
    category: String,
}

#[derive(Serialize)]
struct TranscriptBlock {
    source: String,
    entries: Vec<TranscriptEntry>,
}

#[derive(Serialize)]
struct TranscriptEntry {
    summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<String>,
}

#[derive(Serialize)]
struct CmdRef {
    cmd: String,
    desc: String,
}

// ============================================================================
// Execute
// ============================================================================

/// Execute the prime command.
pub fn execute(
    db_path: Option<&PathBuf>,
    session_id: Option<&str>,
    json: bool,
    include_transcript: bool,
    transcript_limit: usize,
    compact: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;

    // Resolve session via TTY-keyed status cache
    let sid = resolve_session_or_suggest(session_id, &storage)?;
    let session = storage
        .get_session(&sid)?
        .ok_or_else(|| Error::SessionNotFound { id: sid })?;

    let project_path = session
        .project_path
        .clone()
        .or_else(|| current_project_path().map(|p| p.to_string_lossy().to_string()))
        .unwrap_or_else(|| ".".to_string());

    // Git info
    let git_branch = current_git_branch();
    let git_status = get_git_status();

    // Context items (read-only queries)
    let all_items = storage.get_context_items(&session.id, None, None, Some(1000))?;
    let high_priority =
        storage.get_context_items(&session.id, None, Some("high"), Some(HIGH_PRIORITY_LIMIT))?;
    let decisions =
        storage.get_context_items(&session.id, Some("decision"), None, Some(DECISION_LIMIT))?;
    let reminders =
        storage.get_context_items(&session.id, Some("reminder"), None, Some(REMINDER_LIMIT))?;
    let progress =
        storage.get_context_items(&session.id, Some("progress"), None, Some(PROGRESS_LIMIT))?;

    // Issues
    let active_issues =
        storage.list_issues(&project_path, Some("in_progress"), None, Some(READY_ISSUES_LIMIT))?;
    let ready_issues = storage.get_ready_issues(&project_path, READY_ISSUES_LIMIT)?;
    let all_open_issues = storage.list_issues(&project_path, None, None, Some(1000))?;

    // Memory
    let memory_items = storage.list_memory(&project_path, None)?;

    // Transcript (optional, never fails the command)
    let transcript = if include_transcript {
        parse_claude_transcripts(&project_path, transcript_limit)
    } else {
        None
    };

    let cmd_ref = build_command_reference();

    if json {
        let output = PrimeOutput {
            session: SessionInfo {
                id: session.id.clone(),
                name: session.name.clone(),
                description: session.description.clone(),
                status: session.status.clone(),
                branch: session.branch.clone(),
                project_path: session.project_path.clone(),
            },
            git: git_branch.as_ref().map(|branch| {
                let files: Vec<String> = git_status
                    .as_ref()
                    .map(|s| {
                        s.lines()
                            .take(20)
                            .map(|l| l.trim().to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                GitInfo {
                    branch: branch.clone(),
                    changed_files: files,
                }
            }),
            context: ContextBlock {
                high_priority: high_priority.iter().map(to_context_entry).collect(),
                decisions: decisions.iter().map(to_context_entry).collect(),
                reminders: reminders.iter().map(to_context_entry).collect(),
                recent_progress: progress.iter().map(to_context_entry).collect(),
                total_items: all_items.len(),
            },
            issues: IssueBlock {
                active: active_issues.iter().map(to_issue_summary).collect(),
                ready: ready_issues.iter().map(to_issue_summary).collect(),
                total_open: all_open_issues.len(),
            },
            memory: memory_items
                .iter()
                .take(MEMORY_DISPLAY_LIMIT)
                .map(|m| MemoryEntry {
                    key: m.key.clone(),
                    value: m.value.clone(),
                    category: m.category.clone(),
                })
                .collect(),
            transcript,
            command_reference: cmd_ref,
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else if compact {
        print_compact(
            &session,
            &git_branch,
            &git_status,
            &high_priority,
            &decisions,
            &reminders,
            &progress,
            &active_issues,
            &ready_issues,
            &all_open_issues,
            &memory_items,
            &transcript,
            all_items.len(),
            &cmd_ref,
        );
    } else {
        print_full(
            &session,
            &git_branch,
            &git_status,
            &high_priority,
            &decisions,
            &reminders,
            &progress,
            &active_issues,
            &ready_issues,
            &all_open_issues,
            &memory_items,
            &transcript,
            all_items.len(),
            &cmd_ref,
        );
    }

    Ok(())
}

// ============================================================================
// Transcript Parsing
// ============================================================================

/// Parse Claude Code transcript files for conversation summaries.
///
/// Claude Code stores session transcripts at:
///   `~/.claude/projects/<encoded-path>/<uuid>.jsonl`
///
/// Where `<encoded-path>` replaces `/` with `-` in the project path.
/// Each line is a JSON object; lines with `"type": "summary"` contain
/// conversation summaries from previous sessions.
fn parse_claude_transcripts(project_path: &str, limit: usize) -> Option<TranscriptBlock> {
    let home = directories::BaseDirs::new()?.home_dir().to_path_buf();
    let encoded_path = encode_project_path(project_path);
    let transcript_dir = home.join(".claude").join("projects").join(&encoded_path);

    if !transcript_dir.exists() {
        return None;
    }

    // Find .jsonl files, sorted by modification time (most recent first)
    let mut jsonl_files: Vec<_> = fs::read_dir(&transcript_dir)
        .ok()?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                let modified = entry.metadata().ok()?.modified().ok()?;
                Some((path, modified))
            } else {
                None
            }
        })
        .collect();

    jsonl_files.sort_by(|a, b| b.1.cmp(&a.1));

    let mut entries = Vec::new();

    // Scan files from most recent, collecting summary entries
    for (path, _) in &jsonl_files {
        if entries.len() >= limit {
            break;
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for line in content.lines().rev() {
            if entries.len() >= limit {
                break;
            }

            let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };

            // Look for summary entries
            if val.get("type").and_then(|t| t.as_str()) == Some("summary") {
                if let Some(summary) = val.get("summary").and_then(|s| s.as_str()) {
                    let timestamp = val
                        .get("timestamp")
                        .and_then(|t| t.as_str())
                        .map(ToString::to_string);
                    entries.push(TranscriptEntry {
                        summary: truncate(summary, 500),
                        timestamp,
                    });
                }
            }
        }
    }

    if entries.is_empty() {
        return None;
    }

    Some(TranscriptBlock {
        source: transcript_dir.to_string_lossy().to_string(),
        entries,
    })
}

/// Encode a project path for Claude Code's directory naming.
///
/// Replaces `/` with `-` to match Claude Code's convention:
///   `/Users/shane/code/project` → `-Users-shane-code-project`
fn encode_project_path(path: &str) -> String {
    path.replace('/', "-")
}

// ============================================================================
// Command Reference
// ============================================================================

fn build_command_reference() -> Vec<CmdRef> {
    vec![
        CmdRef {
            cmd: "sc save <key> <value> -c <cat> -p <pri>".into(),
            desc: "Save context item".into(),
        },
        CmdRef {
            cmd: "sc get -s <query>".into(),
            desc: "Search context items".into(),
        },
        CmdRef {
            cmd: "sc issue create <title> -t <type> -p <pri>".into(),
            desc: "Create issue".into(),
        },
        CmdRef {
            cmd: "sc issue list -s <status>".into(),
            desc: "List issues".into(),
        },
        CmdRef {
            cmd: "sc issue complete <id>".into(),
            desc: "Complete issue".into(),
        },
        CmdRef {
            cmd: "sc issue claim <id>".into(),
            desc: "Claim issue".into(),
        },
        CmdRef {
            cmd: "sc status".into(),
            desc: "Show session status".into(),
        },
        CmdRef {
            cmd: "sc checkpoint create <name>".into(),
            desc: "Create checkpoint".into(),
        },
        CmdRef {
            cmd: "sc memory save <key> <value>".into(),
            desc: "Save project memory".into(),
        },
        CmdRef {
            cmd: "sc compaction".into(),
            desc: "Prepare for context compaction".into(),
        },
    ]
}

// ============================================================================
// Converters
// ============================================================================

fn to_context_entry(item: &crate::storage::ContextItem) -> ContextEntry {
    ContextEntry {
        key: item.key.clone(),
        value: item.value.clone(),
        category: item.category.clone(),
        priority: item.priority.clone(),
    }
}

fn to_issue_summary(issue: &crate::storage::Issue) -> IssueSummary {
    IssueSummary {
        short_id: issue.short_id.clone(),
        title: issue.title.clone(),
        status: issue.status.clone(),
        priority: issue.priority,
        issue_type: issue.issue_type.clone(),
    }
}

// ============================================================================
// Human-Readable Output (Full)
// ============================================================================

#[allow(clippy::too_many_arguments)]
fn print_full(
    session: &crate::storage::Session,
    git_branch: &Option<String>,
    git_status: &Option<String>,
    high_priority: &[crate::storage::ContextItem],
    decisions: &[crate::storage::ContextItem],
    reminders: &[crate::storage::ContextItem],
    progress: &[crate::storage::ContextItem],
    active_issues: &[crate::storage::Issue],
    ready_issues: &[crate::storage::Issue],
    all_open: &[crate::storage::Issue],
    memory: &[crate::storage::Memory],
    transcript: &Option<TranscriptBlock>,
    total_items: usize,
    cmd_ref: &[CmdRef],
) {
    use colored::Colorize;

    println!();
    println!(
        "{}",
        "━━━ SaveContext Prime ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".magenta().bold()
    );
    println!();

    // Session
    println!("{}", "Session".cyan().bold());
    println!("  Name:    {}", session.name);
    if let Some(desc) = &session.description {
        println!("  Desc:    {}", desc);
    }
    println!("  Status:  {}", session.status);
    if let Some(branch) = git_branch {
        println!("  Branch:  {}", branch);
    }
    println!("  Items:   {total_items}");
    println!();

    // Git
    if let Some(status) = git_status {
        let lines: Vec<&str> = status.lines().take(10).collect();
        if !lines.is_empty() {
            println!("{}", "Git Changes".cyan().bold());
            for line in &lines {
                println!("  {line}");
            }
            println!();
        }
    }

    // High priority
    if !high_priority.is_empty() {
        println!("{}", "High Priority".red().bold());
        for item in high_priority.iter().take(5) {
            println!(
                "  {} {} {}",
                "•".red(),
                item.key,
                format!("[{}]", item.category).dimmed()
            );
            println!("    {}", truncate(&item.value, 80));
        }
        println!();
    }

    // Decisions
    if !decisions.is_empty() {
        println!("{}", "Key Decisions".yellow().bold());
        for item in decisions.iter().take(5) {
            println!("  {} {}", "•".yellow(), item.key);
            println!("    {}", truncate(&item.value, 80));
        }
        println!();
    }

    // Reminders
    if !reminders.is_empty() {
        println!("{}", "Reminders".blue().bold());
        for item in reminders.iter().take(5) {
            println!("  {} {}", "•".blue(), item.key);
            println!("    {}", truncate(&item.value, 80));
        }
        println!();
    }

    // Progress
    if !progress.is_empty() {
        println!("{}", "Recent Progress".green().bold());
        for item in progress {
            println!("  {} {}", "✓".green(), item.key);
            println!("    {}", truncate(&item.value, 80));
        }
        println!();
    }

    // Issues
    if !active_issues.is_empty() || !ready_issues.is_empty() {
        println!(
            "{} ({} open)",
            "Issues".cyan().bold(),
            all_open.len()
        );

        if !active_issues.is_empty() {
            println!("  {}", "In Progress:".bold());
            for issue in active_issues {
                let id = issue.short_id.as_deref().unwrap_or("??");
                println!(
                    "    {} {} {} {}",
                    id.cyan(),
                    issue.title,
                    format!("[{}]", issue.issue_type).dimmed(),
                    format!("P{}", issue.priority).dimmed()
                );
            }
        }

        if !ready_issues.is_empty() {
            println!("  {}", "Ready:".bold());
            for issue in ready_issues.iter().take(5) {
                let id = issue.short_id.as_deref().unwrap_or("??");
                println!(
                    "    {} {} {} {}",
                    id.dimmed(),
                    issue.title,
                    format!("[{}]", issue.issue_type).dimmed(),
                    format!("P{}", issue.priority).dimmed()
                );
            }
        }
        println!();
    }

    // Memory
    if !memory.is_empty() {
        println!("{}", "Project Memory".cyan().bold());
        for item in memory.iter().take(10) {
            println!(
                "  {} {} {}",
                item.key.bold(),
                format!("[{}]", item.category).dimmed(),
                truncate(&item.value, 60)
            );
        }
        println!();
    }

    // Transcript
    if let Some(t) = transcript {
        println!("{}", "Recent Transcripts".magenta().bold());
        for entry in &t.entries {
            if let Some(ts) = &entry.timestamp {
                println!("  {} {}", ts.dimmed(), truncate(&entry.summary, 100));
            } else {
                println!("  {}", truncate(&entry.summary, 100));
            }
        }
        println!();
    }

    // Command reference
    println!("{}", "Quick Reference".dimmed().bold());
    for c in cmd_ref {
        println!("  {} {}", c.cmd.cyan(), format!("# {}", c.desc).dimmed());
    }
    println!();
    println!(
        "{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".magenta()
    );
    println!();
}

// ============================================================================
// Human-Readable Output (Compact — for agent injection)
// ============================================================================

#[allow(clippy::too_many_arguments)]
fn print_compact(
    session: &crate::storage::Session,
    git_branch: &Option<String>,
    _git_status: &Option<String>,
    high_priority: &[crate::storage::ContextItem],
    decisions: &[crate::storage::ContextItem],
    reminders: &[crate::storage::ContextItem],
    _progress: &[crate::storage::ContextItem],
    active_issues: &[crate::storage::Issue],
    ready_issues: &[crate::storage::Issue],
    all_open: &[crate::storage::Issue],
    memory: &[crate::storage::Memory],
    transcript: &Option<TranscriptBlock>,
    total_items: usize,
    cmd_ref: &[CmdRef],
) {
    // Compact markdown format for direct agent injection
    println!("# SaveContext Prime");
    print!("Session: \"{}\" ({})", session.name, session.status);
    if let Some(branch) = git_branch {
        print!(" | Branch: {branch}");
    }
    println!(" | {total_items} context items");
    println!();

    if !high_priority.is_empty() {
        println!("## High Priority");
        for item in high_priority.iter().take(5) {
            println!(
                "- {}: {} [{}]",
                item.key,
                truncate(&item.value, 100),
                item.category
            );
        }
        println!();
    }

    if !decisions.is_empty() {
        println!("## Decisions");
        for item in decisions.iter().take(5) {
            println!("- {}: {}", item.key, truncate(&item.value, 100));
        }
        println!();
    }

    if !reminders.is_empty() {
        println!("## Reminders");
        for item in reminders.iter().take(5) {
            println!("- {}: {}", item.key, truncate(&item.value, 100));
        }
        println!();
    }

    if !active_issues.is_empty() || !ready_issues.is_empty() {
        println!("## Issues ({} open)", all_open.len());
        for issue in active_issues {
            let id = issue.short_id.as_deref().unwrap_or("??");
            println!(
                "- [{}] {} ({}/P{})",
                id, issue.title, issue.status, issue.priority
            );
        }
        for issue in ready_issues.iter().take(5) {
            let id = issue.short_id.as_deref().unwrap_or("??");
            println!("- [{}] {} (ready/P{})", id, issue.title, issue.priority);
        }
        println!();
    }

    if !memory.is_empty() {
        println!("## Memory");
        for item in memory.iter().take(10) {
            println!("- {} [{}]: {}", item.key, item.category, truncate(&item.value, 80));
        }
        println!();
    }

    if let Some(t) = transcript {
        println!("## Recent Transcripts");
        for entry in &t.entries {
            println!("- {}", truncate(&entry.summary, 120));
        }
        println!();
    }

    println!("## Quick Reference");
    for c in cmd_ref {
        println!("- `{}` — {}", c.cmd, c.desc);
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Get current git status output.
fn get_git_status() -> Option<String> {
    std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
}

/// Truncate a string to max length with ellipsis.
fn truncate(s: &str, max_len: usize) -> String {
    // Work on first line only to avoid multi-line blowup
    let first_line = s.lines().next().unwrap_or(s);
    if first_line.len() <= max_len {
        first_line.to_string()
    } else {
        format!("{}...", &first_line[..max_len.saturating_sub(3)])
    }
}
