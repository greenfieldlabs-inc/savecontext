//! Plan management commands.
//!
//! Commands for managing SaveContext plans (PRDs, specs, feature docs):
//! - `sc plan create <title>` - Create a new plan
//! - `sc plan list` - List plans
//! - `sc plan show <id>` - Show plan details
//! - `sc plan update <id>` - Update plan settings

use crate::cli::{PlanCommands, PlanCreateArgs, PlanUpdateArgs};
use crate::config::plan_discovery::{self, AgentKind};
use crate::config::{default_actor, resolve_db_path, resolve_project_path, resolve_session_id};
use crate::error::{Error, Result};
use crate::model::{Plan, PlanStatus};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Serialize)]
struct PlanOutput {
    id: String,
    short_id: Option<String>,
    project_path: String,
    title: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    content_preview: Option<String>,
    success_criteria: Option<String>,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
}

impl From<Plan> for PlanOutput {
    fn from(p: Plan) -> Self {
        // Create a content preview (first 200 chars)
        let content_preview = p.content.as_ref().map(|c| {
            if c.len() > 200 {
                format!("{}...", &c[..200])
            } else {
                c.clone()
            }
        });

        Self {
            id: p.id,
            short_id: p.short_id,
            project_path: p.project_path,
            title: p.title,
            status: p.status.as_str().to_string(),
            session_id: p.session_id,
            content_preview,
            success_criteria: p.success_criteria,
            created_at: format_timestamp(p.created_at),
            updated_at: format_timestamp(p.updated_at),
            completed_at: p.completed_at.map(format_timestamp),
        }
    }
}

#[derive(Serialize)]
struct PlanDetailOutput {
    id: String,
    short_id: Option<String>,
    project_path: String,
    title: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    content: Option<String>,
    success_criteria: Option<String>,
    created_in_session: Option<String>,
    completed_in_session: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_path: Option<String>,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
}

impl From<Plan> for PlanDetailOutput {
    fn from(p: Plan) -> Self {
        Self {
            id: p.id,
            short_id: p.short_id,
            project_path: p.project_path,
            title: p.title,
            status: p.status.as_str().to_string(),
            session_id: p.session_id,
            content: p.content,
            success_criteria: p.success_criteria,
            created_in_session: p.created_in_session,
            completed_in_session: p.completed_in_session,
            source_path: p.source_path,
            created_at: format_timestamp(p.created_at),
            updated_at: format_timestamp(p.updated_at),
            completed_at: p.completed_at.map(format_timestamp),
        }
    }
}

#[derive(Serialize)]
struct PlanListOutput {
    plans: Vec<PlanOutput>,
    count: usize,
}

fn format_timestamp(ts: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ts)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| ts.to_string())
}

/// Execute a plan command.
pub fn execute(
    command: &PlanCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json_output: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path()))
        .ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let mut storage = SqliteStorage::open(&db_path)?;
    let actor = actor.map(String::from).unwrap_or_else(default_actor);

    match command {
        PlanCommands::Create(args) => execute_create(&mut storage, args, json_output, &actor),
        PlanCommands::List { status, limit, session } => execute_list(&storage, status, *limit, session.as_deref(), json_output),
        PlanCommands::Show { id } => execute_show(&storage, id, json_output),
        PlanCommands::Update(args) => execute_update(&mut storage, args, json_output, &actor),
        PlanCommands::Capture { agent, max_age, file } => {
            execute_capture(&mut storage, agent.as_deref(), *max_age, file.as_deref(), json_output, &actor)
        }
    }
}

fn execute_create(
    storage: &mut SqliteStorage,
    args: &PlanCreateArgs,
    json_output: bool,
    actor: &str,
) -> Result<()> {
    // Resolve project from DB (matches CWD against registered projects)
    let project_path = resolve_project_path(storage, None)?;

    // Get or create project
    let project = storage.get_or_create_project(&project_path, actor)?;

    // Create plan
    let status = PlanStatus::from_str(&args.status);
    let mut plan = Plan::new(project.id.clone(), project_path, args.title.clone())
        .with_status(status);

    if let Some(ref content) = args.content {
        plan = plan.with_content(content);
    }

    if let Some(ref criteria) = args.success_criteria {
        plan = plan.with_success_criteria(criteria);
    }

    // Auto-resolve session: explicit flag > TTY cache > no binding
    if let Ok(session_id) = resolve_session_id(args.session.as_deref()) {
        plan = plan.with_session(&session_id);
    }

    storage.create_plan(&plan, actor)?;

    if crate::is_silent() {
        println!("{}", plan.id);
        return Ok(());
    }

    if json_output {
        let output = PlanOutput::from(plan);
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Created plan: {}", plan.title);
        println!("  ID:     {}", plan.id);
        println!("  Status: {}", plan.status.as_str());
    }

    Ok(())
}

fn execute_list(
    storage: &SqliteStorage,
    status: &str,
    limit: usize,
    session: Option<&str>,
    json_output: bool,
) -> Result<()> {
    // Resolve project from DB (matches CWD against registered projects)
    let project_path = resolve_project_path(storage, None)?;

    // Resolve session filter: "current" means active TTY session
    let session_id = session.and_then(|s| {
        if s == "current" {
            resolve_session_id(None).ok()
        } else {
            Some(s.to_string())
        }
    });

    let status_filter = if status == "all" { Some("all") } else { Some(status) };
    let mut plans = storage.list_plans(&project_path, status_filter, limit)?;

    // Filter by session if specified
    if let Some(ref sid) = session_id {
        plans.retain(|p| p.session_id.as_deref() == Some(sid.as_str()));
    }

    if crate::is_csv() {
        println!("id,title,status");
        for plan in &plans {
            println!("{},{},{}", plan.id, crate::csv_escape(&plan.title), plan.status.as_str());
        }
    } else if json_output {
        let output = PlanListOutput {
            count: plans.len(),
            plans: plans.into_iter().map(PlanOutput::from).collect(),
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else if plans.is_empty() {
        println!("No plans found.");
        println!("\nCreate one with: sc plan create \"Plan Title\"");
    } else {
        println!("Plans ({}):\n", plans.len());
        for plan in plans {
            let status_icon = match plan.status {
                PlanStatus::Draft => "📝",
                PlanStatus::Active => "🔵",
                PlanStatus::Completed => "✓",
            };
            println!("  {} {} [{}]", status_icon, plan.title, plan.status.as_str());
            println!("    ID: {}", plan.id);
            if let Some(criteria) = &plan.success_criteria {
                let preview = if criteria.len() > 60 {
                    format!("{}...", &criteria[..60])
                } else {
                    criteria.clone()
                };
                println!("    Success: {preview}");
            }
            println!();
        }
    }

    Ok(())
}

fn execute_show(
    storage: &SqliteStorage,
    id: &str,
    json_output: bool,
) -> Result<()> {
    let plan = storage.get_plan(id)?
        .ok_or_else(|| Error::Other(format!("Plan not found: {id}")))?;

    if json_output {
        let output = PlanDetailOutput::from(plan);
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        let status_icon = match plan.status {
            PlanStatus::Draft => "📝",
            PlanStatus::Active => "🔵",
            PlanStatus::Completed => "✓",
        };

        println!("Plan: {} {}", status_icon, plan.title);
        println!("  ID:     {}", plan.id);
        println!("  Status: {}", plan.status.as_str());
        println!("  Path:   {}", plan.project_path);

        if let Some(criteria) = &plan.success_criteria {
            println!();
            println!("Success Criteria:");
            println!("  {criteria}");
        }

        if let Some(content) = &plan.content {
            println!();
            println!("Content:");
            println!("─────────────────────────────────────");
            for line in content.lines() {
                println!("  {line}");
            }
            println!("─────────────────────────────────────");
        }

        println!();
        println!("Created: {}", format_timestamp(plan.created_at));
        println!("Updated: {}", format_timestamp(plan.updated_at));
        if let Some(completed_at) = plan.completed_at {
            println!("Completed: {}", format_timestamp(completed_at));
        }
    }

    Ok(())
}

fn execute_update(
    storage: &mut SqliteStorage,
    args: &PlanUpdateArgs,
    json_output: bool,
    actor: &str,
) -> Result<()> {
    // Verify plan exists
    let plan = storage.get_plan(&args.id)?
        .ok_or_else(|| Error::Other(format!("Plan not found: {}", args.id)))?;

    // Update
    storage.update_plan(
        &plan.id,
        args.title.as_deref(),
        args.content.as_deref(),
        args.status.as_deref(),
        args.success_criteria.as_deref(),
        actor,
    )?;

    // Fetch updated plan
    let updated = storage.get_plan(&plan.id)?.unwrap();

    if json_output {
        let output = PlanOutput::from(updated);
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Updated plan: {}", updated.title);
        if args.title.is_some() {
            println!("  Title: {}", updated.title);
        }
        if args.status.is_some() {
            println!("  Status: {}", updated.status.as_str());
        }
        if args.success_criteria.is_some() {
            println!("  Success criteria updated");
        }
        if args.content.is_some() {
            println!("  Content updated");
        }
    }

    Ok(())
}

fn execute_capture(
    storage: &mut SqliteStorage,
    agent: Option<&str>,
    max_age_minutes: u64,
    file: Option<&Path>,
    json_output: bool,
    actor: &str,
) -> Result<()> {
    // Resolve project from DB (matches CWD against registered projects)
    let project_path = resolve_project_path(storage, None)?;

    // Get or create project
    let project = storage.get_or_create_project(&project_path, actor)?;

    // Discover or read the plan
    let discovered = if let Some(file_path) = file {
        // Explicit file: read directly
        let content = std::fs::read_to_string(file_path)
            .map_err(|e| Error::Other(format!("Failed to read plan file: {e}")))?;
        let filename = file_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "unnamed".to_string());
        let title = plan_discovery::extract_title(&content, &filename);
        let modified = std::fs::metadata(file_path)
            .and_then(|m| m.modified())
            .unwrap_or_else(|_| std::time::SystemTime::now());

        vec![plan_discovery::DiscoveredPlan {
            path: file_path.to_path_buf(),
            agent: AgentKind::ClaudeCode, // Default for explicit files
            title,
            content,
            modified_at: modified,
        }]
    } else {
        // Auto-discover from agent directories
        let agent_filter = agent
            .map(|a| AgentKind::from_arg(a)
                .ok_or_else(|| Error::Other(format!(
                    "Unknown agent: {a}. Use: claude, gemini, opencode, cursor"
                ))))
            .transpose()?;

        let max_age = Duration::from_secs(max_age_minutes * 60);
        plan_discovery::discover_plans(Path::new(&project_path), agent_filter, max_age)
    };

    if discovered.is_empty() {
        if !crate::is_silent() {
            if json_output {
                println!(r#"{{"captured":false,"reason":"no_plans_found"}}"#);
            } else {
                println!("No recent plan files found.");
                if let Some(agent_name) = agent {
                    println!("  Searched agent: {agent_name}");
                } else {
                    println!("  Searched: Claude Code, Gemini CLI, OpenCode, Cursor");
                }
                println!("  Max age: {max_age_minutes} minutes");
            }
        }
        return Ok(());
    }

    // Take the most recent plan
    let plan_file = &discovered[0];
    let source_hash = plan_discovery::compute_content_hash(&plan_file.content);
    let source_path = plan_file.path.to_string_lossy().to_string();

    // Check for existing plan with same content hash (dedup)
    if let Some(existing) = storage.find_plan_by_source_hash(&source_hash)? {
        // Content hasn't changed - update title and content
        storage.update_plan(
            &existing.id,
            Some(&plan_file.title),
            Some(&plan_file.content),
            None, // keep status
            None, // keep criteria
            actor,
        )?;

        if crate::is_silent() {
            println!("{}", existing.id);
        } else if json_output {
            let updated = storage.get_plan(&existing.id)?.unwrap();
            let output = PlanOutput::from(updated);
            println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                "captured": true,
                "action": "updated",
                "agent": plan_file.agent.display_name(),
                "plan": output,
            }))?);
        } else {
            println!("Updated existing plan: {}", existing.title);
            println!("  ID:     {}", existing.id);
            println!("  Agent:  {}", plan_file.agent.display_name());
            println!("  Source: {source_path}");
        }

        return Ok(());
    }

    // Create new plan
    let mut plan = Plan::new(project.id.clone(), project_path, plan_file.title.clone())
        .with_content(&plan_file.content)
        .with_status(PlanStatus::Active)
        .with_source(&source_path, &source_hash);

    // Auto-resolve session
    if let Ok(session_id) = resolve_session_id(None) {
        plan = plan.with_session(&session_id);
    }

    storage.create_plan(&plan, actor)?;

    if crate::is_silent() {
        println!("{}", plan.id);
    } else if json_output {
        let output = PlanOutput::from(plan.clone());
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "captured": true,
            "action": "created",
            "agent": plan_file.agent.display_name(),
            "plan": output,
        }))?);
    } else {
        println!("Captured plan: {}", plan.title);
        println!("  ID:     {}", plan.id);
        println!("  Agent:  {}", plan_file.agent.display_name());
        println!("  Source: {source_path}");
        if let Some(ref sid) = plan.session_id {
            println!("  Session: {sid}");
        }
    }

    Ok(())
}
