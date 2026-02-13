//! Project management commands.
//!
//! Commands for managing SaveContext projects:
//! - `sc project create <path>` - Create a new project
//! - `sc project list` - List all projects
//! - `sc project show <id>` - Show project details
//! - `sc project update <id>` - Update project settings
//! - `sc project delete <id>` - Delete a project

use crate::cli::{ProjectCommands, ProjectCreateArgs, ProjectUpdateArgs};
use crate::config::{current_project_path, default_actor, resolve_db_path};
use crate::error::{Error, Result};
use crate::model::Project;
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
struct ProjectOutput {
    id: String,
    project_path: String,
    name: String,
    description: Option<String>,
    issue_prefix: Option<String>,
    next_issue_number: i32,
    created_at: String,
    updated_at: String,
}

impl From<Project> for ProjectOutput {
    fn from(p: Project) -> Self {
        Self {
            id: p.id,
            project_path: p.project_path,
            name: p.name,
            description: p.description,
            issue_prefix: p.issue_prefix,
            next_issue_number: p.next_issue_number,
            created_at: format_timestamp(p.created_at),
            updated_at: format_timestamp(p.updated_at),
        }
    }
}

#[derive(Serialize)]
struct ProjectListOutput {
    projects: Vec<ProjectOutput>,
    count: usize,
}

#[derive(Serialize)]
struct ProjectWithCounts {
    #[serde(flatten)]
    project: ProjectOutput,
    session_count: usize,
    issue_count: usize,
    memory_count: usize,
}

fn format_timestamp(ts: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ts)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| ts.to_string())
}

/// Execute a project command.
pub fn execute(
    command: &ProjectCommands,
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
        ProjectCommands::Create(args) => execute_create(&mut storage, args, json_output, &actor),
        ProjectCommands::List { limit, session_count } => execute_list(&storage, *limit, *session_count, json_output),
        ProjectCommands::Show { id } => execute_show(&storage, id, json_output),
        ProjectCommands::Update(args) => execute_update(&mut storage, args, json_output, &actor),
        ProjectCommands::Delete { id, force } => execute_delete(&mut storage, id, *force, json_output, &actor),
    }
}

fn execute_create(
    storage: &mut SqliteStorage,
    args: &ProjectCreateArgs,
    json_output: bool,
    actor: &str,
) -> Result<()> {
    // Use provided path or canonicalized CWD
    let project_path = args.path.clone().unwrap_or_else(|| {
        std::env::current_dir()
            .ok()
            .and_then(|p| p.canonicalize().ok())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                current_project_path()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| ".".to_string())
            })
    });

    // Canonicalize the path
    let project_path = std::fs::canonicalize(&project_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(project_path);

    // Check if project already exists
    if let Some(existing) = storage.get_project_by_path(&project_path)? {
        if json_output {
            let output = ProjectOutput::from(existing);
            println!("{}", serde_json::to_string_pretty(&output)?);
        } else {
            println!("Project already exists at this path");
            println!("  ID: {}", existing.id);
            println!("  Name: {}", existing.name);
        }
        return Ok(());
    }

    // Derive name from path if not provided
    let name = args.name.clone().unwrap_or_else(|| {
        std::path::Path::new(&project_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown Project")
            .to_string()
    });

    // Create project
    let mut project = Project::new(project_path, name);

    if let Some(ref desc) = args.description {
        project.description = Some(desc.clone());
    }

    if let Some(ref prefix) = args.issue_prefix {
        project.issue_prefix = Some(prefix.to_uppercase());
    }

    storage.create_project(&project, actor)?;

    if json_output {
        let output = ProjectOutput::from(project);
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Created project: {}", project.name);
        println!("  ID: {}", project.id);
        println!("  Path: {}", project.project_path);
        println!("  Issue prefix: {}", project.issue_prefix.unwrap_or_default());
    }

    Ok(())
}

fn execute_list(
    storage: &SqliteStorage,
    limit: usize,
    include_session_count: bool,
    json_output: bool,
) -> Result<()> {
    let projects = storage.list_projects(limit)?;

    if json_output {
        if include_session_count {
            // Include session counts for each project
            let projects_with_counts: Vec<serde_json::Value> = projects
                .iter()
                .map(|p| {
                    let counts = storage.get_project_counts(&p.project_path).ok();
                    let mut obj = serde_json::to_value(ProjectOutput::from(p.clone())).unwrap();
                    if let (Some(counts), Some(obj_map)) = (counts, obj.as_object_mut()) {
                        obj_map.insert("session_count".to_string(), serde_json::json!(counts.sessions));
                    }
                    obj
                })
                .collect();
            let output = serde_json::json!({
                "count": projects_with_counts.len(),
                "projects": projects_with_counts
            });
            println!("{}", serde_json::to_string_pretty(&output)?);
        } else {
            let output = ProjectListOutput {
                count: projects.len(),
                projects: projects.into_iter().map(ProjectOutput::from).collect(),
            };
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
    } else if projects.is_empty() {
        println!("No projects found.");
        println!("\nCreate one with: sc project create [--name <name>]");
    } else {
        println!("Projects ({}):\n", projects.len());
        for project in &projects {
            let prefix = project.issue_prefix.as_deref().unwrap_or("-");
            if include_session_count {
                let session_count = storage
                    .get_project_counts(&project.project_path)
                    .map(|c| c.sessions)
                    .unwrap_or(0);
                println!("  {} [{}] ({} sessions)", project.name, prefix, session_count);
            } else {
                println!("  {} [{}]", project.name, prefix);
            }
            println!("    ID:   {}", project.id);
            println!("    Path: {}", project.project_path);
            if let Some(desc) = &project.description {
                println!("    Desc: {}", desc);
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
    // Try to find by ID first, then by path
    let project = storage.get_project(id)?
        .or_else(|| storage.get_project_by_path(id).ok().flatten());

    let project = project.ok_or_else(|| {
        Error::ProjectNotFound { id: id.to_string() }
    })?;

    // Get counts
    let counts = storage.get_project_counts(&project.project_path)?;

    if json_output {
        let output = ProjectWithCounts {
            project: ProjectOutput::from(project),
            session_count: counts.sessions,
            issue_count: counts.issues,
            memory_count: counts.memories,
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Project: {}", project.name);
        println!("  ID:           {}", project.id);
        println!("  Path:         {}", project.project_path);
        println!("  Issue prefix: {}", project.issue_prefix.as_deref().unwrap_or("-"));
        println!("  Description:  {}", project.description.as_deref().unwrap_or("-"));
        println!();
        println!("Statistics:");
        println!("  Sessions:     {}", counts.sessions);
        println!("  Issues:       {}", counts.issues);
        println!("  Memory items: {}", counts.memories);
        println!("  Checkpoints:  {}", counts.checkpoints);
        println!();
        println!("Created: {}", format_timestamp(project.created_at));
        println!("Updated: {}", format_timestamp(project.updated_at));
    }

    Ok(())
}

fn execute_update(
    storage: &mut SqliteStorage,
    args: &ProjectUpdateArgs,
    json_output: bool,
    actor: &str,
) -> Result<()> {
    // Find the project
    let project = storage.get_project(&args.id)?
        .or_else(|| storage.get_project_by_path(&args.id).ok().flatten())
        .ok_or_else(|| {
            Error::ProjectNotFound { id: args.id.clone() }
        })?;

    // Update
    storage.update_project(
        &project.id,
        args.name.as_deref(),
        args.description.as_deref(),
        args.issue_prefix.as_deref(),
        actor,
    )?;

    // Fetch updated project
    let updated = storage.get_project(&project.id)?.unwrap();

    if json_output {
        let output = ProjectOutput::from(updated);
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Updated project: {}", updated.name);
        if args.name.is_some() {
            println!("  Name: {}", updated.name);
        }
        if args.description.is_some() {
            println!("  Description: {}", updated.description.as_deref().unwrap_or("-"));
        }
        if args.issue_prefix.is_some() {
            println!("  Issue prefix: {}", updated.issue_prefix.as_deref().unwrap_or("-"));
        }
    }

    Ok(())
}

fn execute_delete(
    storage: &mut SqliteStorage,
    id: &str,
    force: bool,
    json_output: bool,
    actor: &str,
) -> Result<()> {
    // Find the project
    let project = storage.get_project(id)?
        .or_else(|| storage.get_project_by_path(id).ok().flatten())
        .ok_or_else(|| {
            Error::ProjectNotFound { id: id.to_string() }
        })?;

    // Get counts for warning
    let counts = storage.get_project_counts(&project.project_path)?;
    let total_items = counts.sessions + counts.issues + counts.memories + counts.checkpoints;

    if !force && total_items > 0 && !json_output {
        println!("Warning: This will delete:");
        println!("  {} sessions", counts.sessions);
        println!("  {} issues", counts.issues);
        println!("  {} memory items", counts.memories);
        println!("  {} checkpoints", counts.checkpoints);
        println!();
        println!("Use --force to confirm deletion.");
        return Ok(());
    }

    // Delete
    storage.delete_project(&project.id, actor)?;

    if json_output {
        let output = serde_json::json!({
            "deleted": true,
            "id": project.id,
            "name": project.name,
            "items_deleted": total_items
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Deleted project: {} ({})", project.name, project.id);
        if total_items > 0 {
            println!("  Deleted {} associated items", total_items);
        }
    }

    Ok(())
}
