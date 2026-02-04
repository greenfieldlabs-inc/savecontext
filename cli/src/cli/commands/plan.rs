//! Plan management commands.
//!
//! Commands for managing SaveContext plans (PRDs, specs, feature docs):
//! - `sc plan create <title>` - Create a new plan
//! - `sc plan list` - List plans
//! - `sc plan show <id>` - Show plan details
//! - `sc plan update <id>` - Update plan settings

use crate::cli::{PlanCommands, PlanCreateArgs, PlanUpdateArgs};
use crate::config::{current_project_path, default_actor, resolve_db_path};
use crate::error::{Error, Result};
use crate::model::{Plan, PlanStatus};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
struct PlanOutput {
    id: String,
    short_id: Option<String>,
    project_path: String,
    title: String,
    status: String,
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
    content: Option<String>,
    success_criteria: Option<String>,
    created_in_session: Option<String>,
    completed_in_session: Option<String>,
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
            content: p.content,
            success_criteria: p.success_criteria,
            created_in_session: p.created_in_session,
            completed_in_session: p.completed_in_session,
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
        PlanCommands::List { status, limit } => execute_list(&storage, status, *limit, json_output),
        PlanCommands::Show { id } => execute_show(&storage, id, json_output),
        PlanCommands::Update(args) => execute_update(&mut storage, args, json_output, &actor),
    }
}

fn execute_create(
    storage: &mut SqliteStorage,
    args: &PlanCreateArgs,
    json_output: bool,
    actor: &str,
) -> Result<()> {
    // Get current project
    let project_path = current_project_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| Error::Other("Could not determine project path".to_string()))?;

    // Canonicalize the path
    let project_path = std::fs::canonicalize(&project_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(project_path);

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
    json_output: bool,
) -> Result<()> {
    // Get current project
    let project_path = current_project_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| Error::Other("Could not determine project path".to_string()))?;

    // Canonicalize the path
    let project_path = std::fs::canonicalize(&project_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(project_path);

    let status_filter = if status == "all" { Some("all") } else { Some(status) };
    let plans = storage.list_plans(&project_path, status_filter, limit)?;

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
