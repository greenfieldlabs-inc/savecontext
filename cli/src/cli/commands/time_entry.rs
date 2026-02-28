//! Time entry command implementations.

use crate::cli::{TimeCommands, TimeListArgs, TimeLogArgs, TimeUpdateArgs};
use crate::config::{default_actor, resolve_db_path, resolve_project_path};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Output for time entry create.
#[derive(Serialize)]
struct TimeLogOutput {
    id: String,
    short_id: Option<String>,
    hours: f64,
    description: String,
    work_date: String,
    period: Option<String>,
    issue_id: Option<String>,
    status: String,
}

/// Output for time entry list.
#[derive(Serialize)]
struct TimeListOutput {
    entries: Vec<crate::storage::TimeEntry>,
    count: usize,
    total_hours: f64,
}

/// Output for time total.
#[derive(Serialize)]
struct TimeTotalOutput {
    total_hours: f64,
    period: Option<String>,
    status: Option<String>,
}

/// Output for invoice operation.
#[derive(Serialize)]
struct TimeInvoiceOutput {
    period: String,
    count: usize,
    total_hours: f64,
    from_status: String,
    to_status: String,
}

/// Execute time commands.
pub fn execute(
    command: &TimeCommands,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    match command {
        TimeCommands::Log(args) => log(args, db_path, actor, json),
        TimeCommands::List(args) => list(args, db_path, json),
        TimeCommands::Summary { period, group_by, status } => {
            summary(period.as_deref(), group_by, status.as_deref(), db_path, json)
        }
        TimeCommands::Total { period, status } => {
            total(period.as_deref(), status.as_deref(), db_path, json)
        }
        TimeCommands::Update(args) => update(args, db_path, actor, json),
        TimeCommands::Delete { id } => delete(id, db_path, actor, json),
        TimeCommands::Invoice { period, from } => invoice(period, from, db_path, actor, json),
    }
}

fn log(
    args: &TimeLogArgs,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    if args.hours <= 0.0 {
        return Err(Error::InvalidArgument(
            "Hours must be greater than 0".to_string(),
        ));
    }

    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let mut storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    // Validate and default date
    let work_date = match &args.date {
        Some(d) => {
            validate_date(d)?;
            d.clone()
        }
        None => chrono::Local::now().format("%Y-%m-%d").to_string(),
    };

    // Resolve issue short ID to full ID if provided
    let issue_id = if let Some(ref issue_ref) = args.issue {
        let issue = storage
            .get_issue(issue_ref, Some(&project_path))?
            .ok_or_else(|| Error::IssueNotFound {
                id: issue_ref.clone(),
            })?;
        Some(issue.id)
    } else {
        None
    };

    // Generate IDs
    let id = format!("time_{}", uuid::Uuid::new_v4());
    let short_id = format!("TE-{}", generate_short_id());

    storage.create_time_entry(
        &id,
        Some(&short_id),
        &project_path,
        args.hours,
        &args.description,
        &work_date,
        issue_id.as_deref(),
        args.period.as_deref(),
        &actor,
    )?;

    if crate::is_silent() {
        println!("{short_id}");
        return Ok(());
    }

    if json {
        let output = TimeLogOutput {
            id,
            short_id: Some(short_id),
            hours: args.hours,
            description: args.description.clone(),
            work_date,
            period: args.period.clone(),
            issue_id,
            status: "logged".to_string(),
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        let period_str = args
            .period
            .as_deref()
            .map(|p| format!(" [{p}]"))
            .unwrap_or_default();
        let issue_str = issue_id
            .as_deref()
            .map(|_| {
                args.issue
                    .as_deref()
                    .map(|i| format!(" (issue: {i})"))
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        println!(
            "Logged [{short_id}] {:.1}hrs  {}  {work_date}{period_str}{issue_str}",
            args.hours, args.description
        );
    }

    Ok(())
}

fn list(args: &TimeListArgs, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    let entries = storage.list_time_entries(
        &project_path,
        args.period.as_deref(),
        args.status.as_deref(),
        args.issue.as_deref(),
        args.from.as_deref(),
        args.to.as_deref(),
        Some(args.limit),
    )?;

    let total_hours: f64 = entries.iter().map(|e| e.hours).sum();
    let count = entries.len();

    if json {
        let output = TimeListOutput {
            entries,
            count,
            total_hours,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if crate::is_csv() {
        println!("id,hours,description,work_date,period,status,issue_id");
        for e in &entries {
            println!(
                "{},{},{},{},{},{},{}",
                e.short_id.as_deref().unwrap_or(&e.id),
                e.hours,
                csv_escape(&e.description),
                e.work_date,
                e.period.as_deref().unwrap_or(""),
                e.status,
                e.issue_id.as_deref().unwrap_or(""),
            );
        }
    } else {
        if entries.is_empty() {
            println!("No time entries found.");
            return Ok(());
        }

        println!("Time entries ({count} found):");
        println!();
        for e in &entries {
            let short = e.short_id.as_deref().unwrap_or(&e.id[..8]);
            let status_char = match e.status.as_str() {
                "reviewed" => '*',
                "invoiced" => '$',
                _ => ' ',
            };
            let period_str = e
                .period
                .as_deref()
                .map(|p| format!(" [{p}]"))
                .unwrap_or_default();
            println!(
                "{status_char} [{short}] {:.1}hrs  {}  {}{period_str}",
                e.hours, e.description, e.work_date
            );
        }
        println!();
        println!("Total: {total_hours:.1}hrs");
    }

    Ok(())
}

fn summary(
    period: Option<&str>,
    group_by: &str,
    status: Option<&str>,
    db_path: Option<&PathBuf>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    let entries = storage.list_time_entries(
        &project_path,
        period,
        status,
        None,
        None,
        None,
        None,
    )?;

    if entries.is_empty() {
        if json {
            println!("{{\"groups\":[],\"running_total\":0}}");
        } else {
            println!("No time entries found.");
        }
        return Ok(());
    }

    // Group entries
    let mut groups: BTreeMap<String, Vec<&crate::storage::TimeEntry>> = BTreeMap::new();
    for e in &entries {
        let key = match group_by {
            "date" => e.work_date.clone(),
            "issue" => e.issue_id.clone().unwrap_or_else(|| "(no issue)".to_string()),
            "status" => e.status.clone(),
            _ => e.period.clone().unwrap_or_else(|| "(no period)".to_string()),
        };
        groups.entry(key).or_default().push(e);
    }

    let running_total: f64 = entries.iter().map(|e| e.hours).sum();

    if json {
        let mut json_groups = Vec::new();
        for (key, items) in &groups {
            let subtotal: f64 = items.iter().map(|e| e.hours).sum();
            let entries_json: Vec<serde_json::Value> = items
                .iter()
                .map(|e| {
                    serde_json::json!({
                        "id": e.short_id.as_deref().unwrap_or(&e.id),
                        "hours": e.hours,
                        "description": e.description,
                        "work_date": e.work_date,
                        "status": e.status,
                    })
                })
                .collect();
            json_groups.push(serde_json::json!({
                "key": key,
                "entries": entries_json,
                "subtotal": subtotal,
            }));
        }
        let output = serde_json::json!({
            "groups": json_groups,
            "running_total": running_total,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        for (key, items) in &groups {
            println!("{key}:");
            for e in items {
                let status_suffix = match e.status.as_str() {
                    "invoiced" => ", INVOICED",
                    "reviewed" => ", REVIEWED",
                    _ => "",
                };
                println!(
                    "  - {}: {:.1}hrs{}",
                    e.description, e.hours, status_suffix
                );
            }
            let subtotal: f64 = items.iter().map(|e| e.hours).sum();
            println!("  Subtotal: {subtotal:.1}hrs");
            println!();
        }
        println!("Running total: {running_total:.1}hrs");
    }

    Ok(())
}

fn total(
    period: Option<&str>,
    status: Option<&str>,
    db_path: Option<&PathBuf>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    let total_hours = storage.get_time_total(&project_path, period, status)?;

    if json {
        let output = TimeTotalOutput {
            total_hours,
            period: period.map(ToString::to_string),
            status: status.map(ToString::to_string),
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        let qualifier = match (period, status) {
            (Some(p), Some(s)) => format!(" ({s}, {p})"),
            (Some(p), None) => format!(" ({p})"),
            (None, Some(s)) => format!(" ({s})"),
            (None, None) => String::new(),
        };
        println!("Total{qualifier}: {total_hours:.1}hrs");
    }

    Ok(())
}

fn update(
    args: &TimeUpdateArgs,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    if args.hours.is_none()
        && args.description.is_none()
        && args.period.is_none()
        && args.issue.is_none()
        && args.date.is_none()
        && args.status.is_none()
    {
        return Err(Error::InvalidArgument(
            "No fields to update. Use --hours, --description, --period, --issue, --date, or --status".to_string(),
        ));
    }

    if let Some(h) = args.hours {
        if h <= 0.0 {
            return Err(Error::InvalidArgument(
                "Hours must be greater than 0".to_string(),
            ));
        }
    }

    if let Some(ref d) = args.date {
        validate_date(d)?;
    }

    if let Some(ref s) = args.status {
        validate_status(s)?;
    }

    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let mut storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    // Handle status update separately
    if let Some(ref status) = args.status {
        storage.update_time_entry_status(&args.id, &project_path, status, &actor)?;
    }

    // Handle field updates
    if args.hours.is_some()
        || args.description.is_some()
        || args.period.is_some()
        || args.issue.is_some()
        || args.date.is_some()
    {
        // Resolve issue short ID if provided
        let issue_id = if let Some(ref issue_ref) = args.issue {
            let issue = storage
                .get_issue(issue_ref, Some(&project_path))?
                .ok_or_else(|| Error::IssueNotFound {
                    id: issue_ref.clone(),
                })?;
            Some(issue.id)
        } else {
            None
        };

        storage.update_time_entry(
            &args.id,
            &project_path,
            args.hours,
            args.description.as_deref(),
            args.period.as_deref(),
            issue_id.as_deref(),
            args.date.as_deref(),
            &actor,
        )?;
    }

    if json {
        let output = serde_json::json!({
            "id": args.id,
            "updated": true,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Updated time entry: {}", args.id);
    }

    Ok(())
}

fn delete(id: &str, db_path: Option<&PathBuf>, actor: Option<&str>, json: bool) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let mut storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    storage.delete_time_entry(id, &project_path, &actor)?;

    if json {
        let output = serde_json::json!({
            "id": id,
            "deleted": true,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Deleted time entry: {id}");
    }

    Ok(())
}

fn invoice(
    period: &str,
    from: &str,
    db_path: Option<&PathBuf>,
    actor: Option<&str>,
    json: bool,
) -> Result<()> {
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let actor = actor.map(ToString::to_string).unwrap_or_else(default_actor);
    let mut storage = SqliteStorage::open(&db_path)?;
    let project_path = resolve_project_path(&storage, None)?;

    let (count, total_hours) =
        storage.invoice_time_entries(&project_path, period, from, "invoiced", &actor)?;

    if json {
        let output = TimeInvoiceOutput {
            period: period.to_string(),
            count,
            total_hours,
            from_status: from.to_string(),
            to_status: "invoiced".to_string(),
        };
        println!("{}", serde_json::to_string(&output)?);
    } else if count == 0 {
        println!("No {from} entries found for period: {period}");
    } else {
        println!(
            "Invoiced {count} entries ({total_hours:.1}hrs) for period: {period}"
        );
    }

    Ok(())
}

// ==================
// Helpers
// ==================

fn validate_date(date: &str) -> Result<()> {
    if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
        return Err(Error::InvalidArgument(format!(
            "Invalid date format: '{date}'. Expected YYYY-MM-DD"
        )));
    }
    Ok(())
}

fn validate_status(status: &str) -> Result<()> {
    match status {
        "logged" | "reviewed" | "invoiced" => Ok(()),
        _ => Err(Error::InvalidArgument(format!(
            "Invalid status: '{status}'. Expected: logged, reviewed, invoiced"
        ))),
    }
}

fn generate_short_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{:04x}", (now & 0xFFFF) as u16)
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
