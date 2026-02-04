//! Issue command implementations.

use crate::cli::{
    IssueCommands, IssueCreateArgs, IssueDepCommands, IssueLabelCommands, IssueListArgs,
    IssueUpdateArgs,
};
use crate::config::{current_project_path, default_actor, resolve_db_path};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::{Deserialize, Serialize};
use std::io::BufRead;
use std::path::PathBuf;

/// Input for batch issue creation (from JSON).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchInput {
    issues: Vec<BatchIssue>,
    #[serde(default)]
    dependencies: Option<Vec<BatchDependency>>,
    #[serde(default)]
    plan_id: Option<String>,
}

/// Single issue in batch input.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchIssue {
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    details: Option<String>,
    #[serde(default)]
    issue_type: Option<String>,
    #[serde(default)]
    priority: Option<i32>,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    plan_id: Option<String>,
    #[serde(default)]
    labels: Option<Vec<String>>,
}

/// Dependency definition in batch input.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchDependency {
    issue_index: usize,
    depends_on_index: usize,
    #[serde(default)]
    dependency_type: Option<String>,
}

/// Output for batch creation.
#[derive(Debug, Serialize)]
struct BatchOutput {
    issues: Vec<BatchIssueResult>,
    dependencies: Vec<BatchDepResult>,
}

/// Result for single issue in batch.
#[derive(Debug, Serialize)]
struct BatchIssueResult {
    id: String,
    short_id: Option<String>,
    title: String,
    index: usize,
}

/// Result for dependency in batch.
#[derive(Debug, Serialize)]
struct BatchDepResult {
    issue_id: String,
    depends_on_id: String,
    dependency_type: String,
}

/// Output for issue create.
#[derive(Serialize)]
struct IssueCreateOutput {
    id: String,
    short_id: Option<String>,
    title: String,
    status: String,
    priority: i32,
    issue_type: String,
}

/// Output for issue list.
#[derive(Serialize)]
struct IssueListOutput {
    issues: Vec<crate::storage::Issue>,
    count: usize,
}

/// Execute issue commands.
pub fn execute(
    command: &IssueCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    match command {
        IssueCommands::Create(args) => create(args, db_path, actor, json),
        IssueCommands::List(args) => list(args, db_path, json),
        IssueCommands::Show { id } => show(id, db_path, json),
        IssueCommands::Update(args) => update(args, db_path, actor, json),
        IssueCommands::Complete { ids } => complete(ids, db_path, actor, json),
        IssueCommands::Claim { ids } => claim(ids, db_path, actor, json),
        IssueCommands::Release { ids } => release(ids, db_path, actor, json),
        IssueCommands::Delete { ids } => delete(ids, db_path, actor, json),
        IssueCommands::Label { command } => label(command, db_path, actor, json),
        IssueCommands::Dep { command } => dep(command, db_path, actor, json),
        IssueCommands::Clone { id, title } => clone_issue(id, title.as_deref(), db_path, actor, json),
        IssueCommands::Duplicate { id, of } => duplicate(id, of, db_path, actor, json),
        IssueCommands::Ready { limit } => ready(*limit, db_path, json),
        IssueCommands::NextBlock { count } => next_block(*count, db_path, actor, json),
        IssueCommands::Batch { json_input } => batch(json_input, db_path, actor, json),
    }
}

fn create(
    args: &IssueCreateArgs,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    // Handle file-based bulk import
    if let Some(ref file_path) = args.file {
        return create_from_file(file_path, db_path, actor, json);
    }

    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let project_path = current_project_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| Error::Other("Could not determine project path".to_string()))?;

    // Normalize type via synonym lookup
    let issue_type = crate::validate::normalize_type(&args.issue_type)
        .map_err(|(val, suggestion)| {
            let msg = if let Some(s) = suggestion {
                format!("Invalid issue type '{val}'. Did you mean '{s}'?")
            } else {
                format!("Invalid issue type '{val}'. Valid: task, bug, feature, epic, chore")
            };
            Error::InvalidArgument(msg)
        })?;

    // Normalize priority via synonym lookup
    let priority = crate::validate::normalize_priority(&args.priority.to_string())
        .map_err(|(val, suggestion)| {
            let msg = suggestion.unwrap_or_else(|| format!("Invalid priority '{val}'"));
            Error::InvalidArgument(msg)
        })?;

    // Dry-run: preview without writing
    if crate::is_dry_run() {
        let labels_str = args.labels.as_ref().map(|l| l.join(",")).unwrap_or_default();
        if json {
            let output = serde_json::json!({
                "dry_run": true,
                "action": "create_issue",
                "title": args.title,
                "issue_type": issue_type,
                "priority": priority,
                "labels": labels_str,
            });
            println!("{output}");
        } else {
            println!("Would create issue: {} [{}, priority={}]", args.title, issue_type, priority);
            if !labels_str.is_empty() {
                println!("  Labels: {labels_str}");
            }
        }
        return Ok(());
    }

    let mut storage = SqliteStorage::open(&db_path)?;

    // Generate IDs
    let id = format!("issue_{}", &uuid::Uuid::new_v4().to_string()[..12]);
    let short_id = generate_short_id();

    storage.create_issue(
        &id,
        Some(&short_id),
        &project_path,
        &args.title,
        args.description.as_deref(),
        args.details.as_deref(),
        Some(&issue_type),
        Some(priority),
        args.plan_id.as_deref(),
        &actor,
    )?;

    // Set parent via parent-child dependency if provided
    if let Some(ref parent) = args.parent {
        storage.add_issue_dependency(&id, parent, "parent-child", &actor)?;
    }

    // Add labels if provided (already Vec from clap value_delimiter)
    if let Some(ref labels) = args.labels {
        if !labels.is_empty() {
            storage.add_issue_labels(&id, labels, &actor)?;
        }
    }

    if crate::is_silent() {
        println!("{short_id}");
        return Ok(());
    }

    if json {
        let output = IssueCreateOutput {
            id,
            short_id: Some(short_id),
            title: args.title.clone(),
            status: "open".to_string(),
            priority,
            issue_type: issue_type.clone(),
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Created issue: {} [{}]", args.title, short_id);
        println!("  Type: {issue_type}");
        println!("  Priority: {priority}");
    }

    Ok(())
}

/// Create issues from a JSONL file (one JSON object per line).
fn create_from_file(
    file_path: &PathBuf,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let file = std::fs::File::open(file_path)
        .map_err(|e| Error::Other(format!("Could not open file {}: {e}", file_path.display())))?;

    let reader = std::io::BufReader::new(file);
    let mut issues: Vec<BatchIssue> = Vec::new();

    for (line_num, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| Error::Other(format!("Read error at line {}: {e}", line_num + 1)))?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue; // Skip blank lines and comments
        }
        let issue: BatchIssue = serde_json::from_str(trimmed)
            .map_err(|e| Error::Other(format!("Invalid JSON at line {}: {e}", line_num + 1)))?;
        issues.push(issue);
    }

    if issues.is_empty() {
        return Err(Error::Other("No issues found in file".to_string()));
    }

    // Dry-run: just preview
    if crate::is_dry_run() {
        if json {
            let output = serde_json::json!({
                "dry_run": true,
                "action": "create_issues_from_file",
                "file": file_path.display().to_string(),
                "count": issues.len(),
            });
            println!("{output}");
        } else {
            println!("Would create {} issues from {}:", issues.len(), file_path.display());
            for issue in &issues {
                println!("  - {} [{}]", issue.title, issue.issue_type.as_deref().unwrap_or("task"));
            }
        }
        return Ok(());
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let project_path = current_project_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| Error::Other("Could not determine project path".to_string()))?;

    let mut results: Vec<BatchIssueResult> = Vec::with_capacity(issues.len());

    for (index, issue) in issues.iter().enumerate() {
        let id = format!("issue_{}", &uuid::Uuid::new_v4().to_string()[..12]);
        let short_id = generate_short_id();

        storage.create_issue(
            &id,
            Some(&short_id),
            &project_path,
            &issue.title,
            issue.description.as_deref(),
            issue.details.as_deref(),
            issue.issue_type.as_deref(),
            issue.priority,
            issue.plan_id.as_deref(),
            &actor,
        )?;

        if let Some(ref labels) = issue.labels {
            if !labels.is_empty() {
                storage.add_issue_labels(&id, labels, &actor)?;
            }
        }

        results.push(BatchIssueResult {
            id,
            short_id: Some(short_id),
            title: issue.title.clone(),
            index,
        });
    }

    if crate::is_silent() {
        for r in &results {
            println!("{}", r.short_id.as_deref().unwrap_or(&r.id));
        }
        return Ok(());
    }

    if json {
        let output = serde_json::json!({
            "issues": results,
            "count": results.len(),
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Created {} issues from {}:", results.len(), file_path.display());
        for r in &results {
            let sid = r.short_id.as_deref().unwrap_or(&r.id[..8]);
            println!("  [{}] {}", sid, r.title);
        }
    }

    Ok(())
}

fn list(args: &IssueListArgs, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;

    // Handle single issue lookup by ID
    if let Some(ref id) = args.id {
        let project_path = current_project_path().map(|p| p.to_string_lossy().to_string());
        let issue = storage
            .get_issue(id, project_path.as_deref())?
            .ok_or_else(|| {
                let all_ids = storage.get_all_issue_short_ids().unwrap_or_default();
                let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
                if similar.is_empty() {
                    Error::IssueNotFound { id: id.to_string() }
                } else {
                    Error::IssueNotFoundSimilar {
                        id: id.to_string(),
                        similar,
                    }
                }
            })?;
        if json {
            let output = IssueListOutput {
                count: 1,
                issues: vec![issue],
            };
            println!("{}", serde_json::to_string(&output)?);
        } else {
            print_issue_list(&[issue]);
        }
        return Ok(());
    }

    // Determine project filter
    let project_path = if args.all_projects {
        None
    } else {
        Some(
            current_project_path()
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| Error::Other("Could not determine project path".to_string()))?,
        )
    };

    // Normalize status filter via synonym lookup (e.g., "done" → "closed")
    let normalized_status = if args.status == "all" {
        "all".to_string()
    } else {
        crate::validate::normalize_status(&args.status).unwrap_or_else(|_| args.status.clone())
    };
    let status = Some(normalized_status.as_str());

    // Get base results from storage (fetch extra for post-filtering)
    #[allow(clippy::cast_possible_truncation)]
    let fetch_limit = (args.limit * 10).min(1000) as u32;

    let issues = if let Some(ref path) = project_path {
        storage.list_issues(path, status, args.issue_type.as_deref(), Some(fetch_limit))?
    } else {
        // For all_projects, we need to query without project filter
        // Storage doesn't support this directly, so we need a workaround
        // For now, get from storage with a higher limit
        storage.list_all_issues(status, args.issue_type.as_deref(), Some(fetch_limit))?
    };

    // Apply post-filters
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Pre-fetch child IDs if filtering by parent
    let child_ids = if let Some(ref parent) = args.parent {
        Some(storage.get_child_issue_ids(parent)?)
    } else {
        None
    };

    let issues: Vec<_> = issues
        .into_iter()
        // Filter by search
        .filter(|i| {
            if let Some(ref search) = args.search {
                let s = search.to_lowercase();
                i.title.to_lowercase().contains(&s)
                    || i.description
                        .as_ref()
                        .map(|d| d.to_lowercase().contains(&s))
                        .unwrap_or(false)
            } else {
                true
            }
        })
        // Filter by exact priority
        .filter(|i| args.priority.map_or(true, |p| i.priority == p))
        // Filter by priority range
        .filter(|i| args.priority_min.map_or(true, |p| i.priority >= p))
        .filter(|i| args.priority_max.map_or(true, |p| i.priority <= p))
        // Filter by parent
        .filter(|i| {
            if let Some(ref child_set) = child_ids {
                // Only include issues that are children of the specified parent
                child_set.contains(&i.id)
            } else {
                true
            }
        })
        // Filter by plan
        .filter(|i| {
            if let Some(ref plan) = args.plan {
                i.plan_id.as_ref().map_or(false, |p| p == plan)
            } else {
                true
            }
        })
        // Filter by assignee
        .filter(|i| {
            if let Some(ref assignee) = args.assignee {
                i.assigned_to_agent
                    .as_ref()
                    .map_or(false, |a| a == assignee)
            } else {
                true
            }
        })
        // Filter by created time
        .filter(|i| {
            if let Some(days) = args.created_days {
                let cutoff = now - (days * 24 * 60 * 60);
                i.created_at >= cutoff
            } else {
                true
            }
        })
        .filter(|i| {
            if let Some(hours) = args.created_hours {
                let cutoff = now - (hours * 60 * 60);
                i.created_at >= cutoff
            } else {
                true
            }
        })
        // Filter by updated time
        .filter(|i| {
            if let Some(days) = args.updated_days {
                let cutoff = now - (days * 24 * 60 * 60);
                i.updated_at >= cutoff
            } else {
                true
            }
        })
        .filter(|i| {
            if let Some(hours) = args.updated_hours {
                let cutoff = now - (hours * 60 * 60);
                i.updated_at >= cutoff
            } else {
                true
            }
        })
        .collect();

    // Apply label filtering
    let issues: Vec<_> = if args.labels.is_some() || args.labels_any.is_some() {
        issues
            .into_iter()
            .filter(|i| {
                let issue_labels = storage.get_issue_labels(&i.id).unwrap_or_default();

                // Check --labels (all must match)
                let all_match = args.labels.as_ref().map_or(true, |required| {
                    required.iter().all(|l| issue_labels.contains(l))
                });

                // Check --labels-any (any must match)
                let any_match = args.labels_any.as_ref().map_or(true, |required| {
                    required.iter().any(|l| issue_labels.contains(l))
                });

                all_match && any_match
            })
            .collect()
    } else {
        issues
    };

    // Apply has_deps/no_deps filtering
    let issues: Vec<_> = if args.has_deps || args.no_deps {
        issues
            .into_iter()
            .filter(|i| {
                let has_dependencies = storage.issue_has_dependencies(&i.id).unwrap_or(false);
                if args.has_deps {
                    has_dependencies
                } else {
                    !has_dependencies
                }
            })
            .collect()
    } else {
        issues
    };

    // Apply has_subtasks/no_subtasks filtering
    let issues: Vec<_> = if args.has_subtasks || args.no_subtasks {
        issues
            .into_iter()
            .filter(|i| {
                let has_subtasks = storage.issue_has_subtasks(&i.id).unwrap_or(false);
                if args.has_subtasks {
                    has_subtasks
                } else {
                    !has_subtasks
                }
            })
            .collect()
    } else {
        issues
    };

    // Apply sorting
    let mut issues = issues;
    match args.sort.as_str() {
        "priority" => issues.sort_by(|a, b| {
            if args.order == "asc" {
                a.priority.cmp(&b.priority)
            } else {
                b.priority.cmp(&a.priority)
            }
        }),
        "updatedAt" => issues.sort_by(|a, b| {
            if args.order == "asc" {
                a.updated_at.cmp(&b.updated_at)
            } else {
                b.updated_at.cmp(&a.updated_at)
            }
        }),
        _ => {
            // Default: createdAt
            issues.sort_by(|a, b| {
                if args.order == "asc" {
                    a.created_at.cmp(&b.created_at)
                } else {
                    b.created_at.cmp(&a.created_at)
                }
            });
        }
    }

    // Apply limit
    issues.truncate(args.limit);

    if crate::is_csv() {
        println!("id,title,status,priority,type,assigned_to");
        for issue in &issues {
            let short_id = issue.short_id.as_deref().unwrap_or(&issue.id[..8]);
            let title = crate::csv_escape(&issue.title);
            let assignee = issue.assigned_to_agent.as_deref().unwrap_or("");
            println!("{},{},{},{},{},{}", short_id, title, issue.status, issue.priority, issue.issue_type, assignee);
        }
    } else if json {
        let output = IssueListOutput {
            count: issues.len(),
            issues,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if issues.is_empty() {
        println!("No issues found.");
    } else {
        print_issue_list(&issues);
    }

    Ok(())
}

/// Print formatted issue list to stdout.
fn print_issue_list(issues: &[crate::storage::Issue]) {
    println!("Issues ({} found):", issues.len());
    println!();
    for issue in issues {
        let status_icon = match issue.status.as_str() {
            "open" => "○",
            "in_progress" => "●",
            "blocked" => "⊘",
            "closed" => "✓",
            "deferred" => "◌",
            _ => "?",
        };
        let priority_str = match issue.priority {
            4 => "!!",
            3 => "! ",
            2 => "  ",
            1 => "- ",
            0 => "--",
            _ => "  ",
        };
        let short_id = issue.short_id.as_deref().unwrap_or(&issue.id[..8]);
        println!(
            "{} [{}] {} {} ({})",
            status_icon, short_id, priority_str, issue.title, issue.issue_type
        );
        if let Some(ref desc) = issue.description {
            let truncated = if desc.len() > 60 {
                format!("{}...", &desc[..60])
            } else {
                desc.clone()
            };
            println!("        {truncated}");
        }
    }
}

fn show(id: &str, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;
    let project_path = current_project_path().map(|p| p.to_string_lossy().to_string());

    let issue = storage
        .get_issue(id, project_path.as_deref())?
        .ok_or_else(|| {
            let all_ids = storage.get_all_issue_short_ids().unwrap_or_default();
            let similar = crate::validate::find_similar_ids(id, &all_ids, 3);
            if similar.is_empty() {
                Error::IssueNotFound { id: id.to_string() }
            } else {
                Error::IssueNotFoundSimilar {
                    id: id.to_string(),
                    similar,
                }
            }
        })?;

    if json {
        println!("{}", serde_json::to_string(&issue)?);
    } else {
        let short_id = issue.short_id.as_deref().unwrap_or(&issue.id[..8]);
        println!("[{}] {}", short_id, issue.title);
        println!();
        println!("Status:   {}", issue.status);
        println!("Type:     {}", issue.issue_type);
        println!("Priority: {}", issue.priority);
        if let Some(ref desc) = issue.description {
            println!();
            println!("Description:");
            println!("{desc}");
        }
        if let Some(ref details) = issue.details {
            println!();
            println!("Details:");
            println!("{details}");
        }
        if let Some(ref agent) = issue.assigned_to_agent {
            println!();
            println!("Assigned to: {agent}");
        }
    }

    Ok(())
}

fn update(
    args: &IssueUpdateArgs,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    if crate::is_dry_run() {
        if json {
            let output = serde_json::json!({
                "dry_run": true,
                "action": "update_issue",
                "id": args.id,
            });
            println!("{output}");
        } else {
            println!("Would update issue: {}", args.id);
        }
        return Ok(());
    }

    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    // Normalize type if provided
    let normalized_type = args.issue_type.as_ref().map(|t| {
        crate::validate::normalize_type(t).unwrap_or_else(|_| t.clone())
    });

    // Normalize priority if provided
    let normalized_priority = args.priority.map(|p| {
        crate::validate::normalize_priority(&p.to_string()).unwrap_or(p)
    });

    // Check if any non-status fields are being updated
    let has_field_updates = args.title.is_some()
        || args.description.is_some()
        || args.details.is_some()
        || normalized_priority.is_some()
        || normalized_type.is_some()
        || args.plan.is_some()
        || args.parent.is_some();

    // Update fields if any are provided
    if has_field_updates {
        storage.update_issue(
            &args.id,
            args.title.as_deref(),
            args.description.as_deref(),
            args.details.as_deref(),
            normalized_priority,
            normalized_type.as_deref(),
            args.plan.as_deref(),
            args.parent.as_deref(),
            &actor,
        )?;
    }

    // Normalize and update status if provided
    if let Some(ref status) = args.status {
        let normalized = crate::validate::normalize_status(status)
            .unwrap_or_else(|_| status.clone());
        storage.update_issue_status(&args.id, &normalized, &actor)?;
    }

    if json {
        let output = serde_json::json!({
            "id": args.id,
            "updated": true
        });
        println!("{output}");
    } else {
        println!("Updated issue: {}", args.id);
    }

    Ok(())
}

fn complete(ids: &[String], db_path: Option<&PathBuf>, actor: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    if crate::is_dry_run() {
        for id in ids {
            println!("Would complete issue: {id}");
        }
        return Ok(());
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    let mut results = Vec::new();
    for id in ids {
        storage.update_issue_status(id, "closed", &actor)?;
        results.push(id.as_str());
    }

    if crate::is_silent() {
        for id in &results {
            println!("{id}");
        }
    } else if json {
        let output = serde_json::json!({
            "ids": results,
            "status": "closed",
            "count": results.len()
        });
        println!("{output}");
    } else {
        for id in &results {
            println!("Completed issue: {id}");
        }
    }

    Ok(())
}

fn claim(ids: &[String], db_path: Option<&PathBuf>, actor: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    if crate::is_dry_run() {
        for id in ids {
            println!("Would claim issue: {id}");
        }
        return Ok(());
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    let mut results = Vec::new();
    for id in ids {
        storage.claim_issue(id, &actor)?;
        results.push(id.as_str());
    }

    if crate::is_silent() {
        for id in &results {
            println!("{id}");
        }
    } else if json {
        let output = serde_json::json!({
            "ids": results,
            "status": "in_progress",
            "assigned_to": actor,
            "count": results.len()
        });
        println!("{output}");
    } else {
        for id in &results {
            println!("Claimed issue: {id}");
        }
    }

    Ok(())
}

fn release(ids: &[String], db_path: Option<&PathBuf>, actor: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    if crate::is_dry_run() {
        for id in ids {
            println!("Would release issue: {id}");
        }
        return Ok(());
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    let mut results = Vec::new();
    for id in ids {
        storage.release_issue(id, &actor)?;
        results.push(id.as_str());
    }

    if crate::is_silent() {
        for id in &results {
            println!("{id}");
        }
    } else if json {
        let output = serde_json::json!({
            "ids": results,
            "status": "open",
            "count": results.len()
        });
        println!("{output}");
    } else {
        for id in &results {
            println!("Released issue: {id}");
        }
    }

    Ok(())
}

fn delete(ids: &[String], db_path: Option<&PathBuf>, actor: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    if crate::is_dry_run() {
        for id in ids {
            println!("Would delete issue: {id}");
        }
        return Ok(());
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    let mut results = Vec::new();
    for id in ids {
        storage.delete_issue(id, &actor)?;
        results.push(id.as_str());
    }

    if crate::is_silent() {
        for id in &results {
            println!("{id}");
        }
    } else if json {
        let output = serde_json::json!({
            "ids": results,
            "deleted": true,
            "count": results.len()
        });
        println!("{output}");
    } else {
        for id in &results {
            println!("Deleted issue: {id}");
        }
    }

    Ok(())
}

/// Generate a short ID (4 hex chars).
fn generate_short_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{:04x}", (now & 0xFFFF) as u16)
}

fn label(
    command: &IssueLabelCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    match command {
        IssueLabelCommands::Add { id, labels } => {
            storage.add_issue_labels(id, labels, &actor)?;

            if json {
                let output = serde_json::json!({
                    "id": id,
                    "action": "add",
                    "labels": labels
                });
                println!("{output}");
            } else {
                println!("Added labels to {}: {}", id, labels.join(", "));
            }
        }
        IssueLabelCommands::Remove { id, labels } => {
            storage.remove_issue_labels(id, labels, &actor)?;

            if json {
                let output = serde_json::json!({
                    "id": id,
                    "action": "remove",
                    "labels": labels
                });
                println!("{output}");
            } else {
                println!("Removed labels from {}: {}", id, labels.join(", "));
            }
        }
    }

    Ok(())
}

fn dep(
    command: &IssueDepCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    match command {
        IssueDepCommands::Add { id, depends_on, dep_type } => {
            storage.add_issue_dependency(id, depends_on, dep_type, &actor)?;

            if json {
                let output = serde_json::json!({
                    "issue_id": id,
                    "depends_on_id": depends_on,
                    "dependency_type": dep_type
                });
                println!("{output}");
            } else {
                println!("Added dependency: {} depends on {} ({})", id, depends_on, dep_type);
            }
        }
        IssueDepCommands::Remove { id, depends_on } => {
            storage.remove_issue_dependency(id, depends_on, &actor)?;

            if json {
                let output = serde_json::json!({
                    "issue_id": id,
                    "depends_on_id": depends_on,
                    "removed": true
                });
                println!("{output}");
            } else {
                println!("Removed dependency: {} no longer depends on {}", id, depends_on);
            }
        }
    }

    Ok(())
}

fn clone_issue(
    id: &str,
    new_title: Option<&str>,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    let cloned = storage.clone_issue(id, new_title, &actor)?;

    if json {
        println!("{}", serde_json::to_string(&cloned)?);
    } else {
        let short_id = cloned.short_id.as_deref().unwrap_or(&cloned.id[..8]);
        println!("Cloned issue {} to: {} [{}]", id, cloned.title, short_id);
    }

    Ok(())
}

fn duplicate(
    id: &str,
    duplicate_of: &str,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);

    storage.mark_issue_duplicate(id, duplicate_of, &actor)?;

    if json {
        let output = serde_json::json!({
            "id": id,
            "duplicate_of": duplicate_of,
            "status": "closed"
        });
        println!("{output}");
    } else {
        println!("Marked {} as duplicate of {} (closed)", id, duplicate_of);
    }

    Ok(())
}

fn ready(limit: usize, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;
    let project_path = current_project_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| Error::Other("Could not determine project path".to_string()))?;

    #[allow(clippy::cast_possible_truncation)]
    let issues = storage.get_ready_issues(&project_path, limit as u32)?;

    if json {
        let output = IssueListOutput {
            count: issues.len(),
            issues,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if issues.is_empty() {
        println!("No issues ready to work on.");
    } else {
        println!("Ready issues ({} found):", issues.len());
        println!();
        for issue in &issues {
            let priority_str = match issue.priority {
                4 => "!!",
                3 => "! ",
                2 => "  ",
                1 => "- ",
                0 => "--",
                _ => "  ",
            };
            let short_id = issue.short_id.as_deref().unwrap_or(&issue.id[..8]);
            println!(
                "○ [{}] {} {} ({})",
                short_id, priority_str, issue.title, issue.issue_type
            );
        }
    }

    Ok(())
}

fn next_block(
    count: usize,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let project_path = current_project_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| Error::Other("Could not determine project path".to_string()))?;

    #[allow(clippy::cast_possible_truncation)]
    let issues = storage.get_next_issue_block(&project_path, count as u32, &actor)?;

    if json {
        let output = IssueListOutput {
            count: issues.len(),
            issues,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if issues.is_empty() {
        println!("No issues available to claim.");
    } else {
        println!("Claimed {} issues:", issues.len());
        println!();
        for issue in &issues {
            let priority_str = match issue.priority {
                4 => "!!",
                3 => "! ",
                2 => "  ",
                1 => "- ",
                0 => "--",
                _ => "  ",
            };
            let short_id = issue.short_id.as_deref().unwrap_or(&issue.id[..8]);
            println!(
                "● [{}] {} {} ({})",
                short_id, priority_str, issue.title, issue.issue_type
            );
        }
    }

    Ok(())
}

/// Create multiple issues at once with dependencies.
fn batch(
    json_input: &str,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let project_path = current_project_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| Error::Other("Could not determine project path".to_string()))?;

    // Parse the JSON input
    let input: BatchInput = serde_json::from_str(json_input)
        .map_err(|e| Error::Other(format!("Invalid JSON input: {e}")))?;

    // Track created issue IDs by index for resolving $N references
    let mut created_ids: Vec<String> = Vec::with_capacity(input.issues.len());
    let mut results: Vec<BatchIssueResult> = Vec::with_capacity(input.issues.len());

    // Create issues in order
    for (index, issue) in input.issues.iter().enumerate() {
        let id = format!("issue_{}", &uuid::Uuid::new_v4().to_string()[..12]);
        let short_id = generate_short_id();

        // Resolve parent_id: if it starts with "$", look up created ID by index
        let resolved_parent_id = issue.parent_id.as_ref().and_then(|pid| {
            if let Some(idx_str) = pid.strip_prefix('$') {
                if let Ok(idx) = idx_str.parse::<usize>() {
                    created_ids.get(idx).cloned()
                } else {
                    Some(pid.clone())
                }
            } else {
                Some(pid.clone())
            }
        });

        // Use issue-level plan_id, or fall back to batch-level plan_id
        let plan_id = issue.plan_id.as_ref().or(input.plan_id.as_ref());

        storage.create_issue(
            &id,
            Some(&short_id),
            &project_path,
            &issue.title,
            issue.description.as_deref(),
            issue.details.as_deref(),
            issue.issue_type.as_deref(),
            issue.priority,
            plan_id.map(String::as_str),
            &actor,
        )?;

        // Set parent via parent-child dependency if resolved
        if let Some(ref parent) = resolved_parent_id {
            storage.add_issue_dependency(&id, parent, "parent-child", &actor)?;
        }

        // Add labels if provided
        if let Some(ref labels) = issue.labels {
            if !labels.is_empty() {
                storage.add_issue_labels(&id, labels, &actor)?;
            }
        }

        created_ids.push(id.clone());
        results.push(BatchIssueResult {
            id,
            short_id: Some(short_id),
            title: issue.title.clone(),
            index,
        });
    }

    // Create dependencies
    let mut dep_results: Vec<BatchDepResult> = Vec::new();
    if let Some(deps) = input.dependencies {
        for dep in deps {
            if dep.issue_index >= created_ids.len() || dep.depends_on_index >= created_ids.len() {
                return Err(Error::Other(format!(
                    "Dependency index out of range: {} -> {}",
                    dep.issue_index, dep.depends_on_index
                )));
            }

            let issue_id = &created_ids[dep.issue_index];
            let depends_on_id = &created_ids[dep.depends_on_index];
            let dep_type = dep.dependency_type.as_deref().unwrap_or("blocks");

            storage.add_issue_dependency(issue_id, depends_on_id, dep_type, &actor)?;

            dep_results.push(BatchDepResult {
                issue_id: issue_id.clone(),
                depends_on_id: depends_on_id.clone(),
                dependency_type: dep_type.to_string(),
            });
        }
    }

    let output = BatchOutput {
        issues: results,
        dependencies: dep_results,
    };

    if json {
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Created {} issues:", output.issues.len());
        for result in &output.issues {
            let short_id = result.short_id.as_deref().unwrap_or(&result.id[..8]);
            println!("  [{}] {}", short_id, result.title);
        }
        if !output.dependencies.is_empty() {
            println!("\nCreated {} dependencies:", output.dependencies.len());
            for dep in &output.dependencies {
                println!("  {} -> {} ({})", dep.issue_id, dep.depends_on_id, dep.dependency_type);
            }
        }
    }

    Ok(())
}
