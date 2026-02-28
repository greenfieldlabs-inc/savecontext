//! Sync command implementations (JSONL export/import).
//!
//! Sync operations are project-scoped, using the current working directory
//! as the project path. JSONL files are written to `<project>/.savecontext/`
//! so they can be committed to git alongside the project code.

use crate::cli::SyncCommands;
use crate::cli::commands::config::{
    build_scp_base_args, build_ssh_base_args, load_remote_config, shell_quote, RemoteConfig,
};
use crate::config::resolve_db_path;
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use crate::sync::{project_export_dir, Exporter, Importer, MergeStrategy};
use std::env;
use std::path::PathBuf;
use std::process::Command;
use tracing::debug;

/// Execute sync commands.
pub fn execute(command: &SyncCommands, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    match command {
        SyncCommands::Export { force } => export(*force, db_path, json),
        SyncCommands::Import { force } => import(*force, db_path, json),
        SyncCommands::Status => status(db_path, json),
        SyncCommands::Push {
            force,
            remote_path,
            full,
        } => {
            if *full {
                push_full(db_path, json)
            } else {
                push(*force, remote_path.as_deref(), db_path, json)
            }
        }
        SyncCommands::Pull {
            force,
            remote_path,
            full,
        } => {
            if *full {
                pull_full(db_path, json)
            } else {
                pull(*force, remote_path.as_deref(), db_path, json)
            }
        }
        SyncCommands::Backup { output } => backup(output.as_deref(), db_path, json),
    }
}

/// Get the current project path from the working directory.
fn get_project_path() -> Result<String> {
    env::current_dir()
        .map_err(|e| Error::Other(format!("Failed to get current directory: {e}")))?
        .to_str()
        .map(String::from)
        .ok_or_else(|| Error::Other("Current directory path is not valid UTF-8".to_string()))
}

fn export(force: bool, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path =
        resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let project_path = get_project_path()?;
    let mut storage = SqliteStorage::open(&db_path)?;
    let output_dir = project_export_dir(&project_path);

    let mut exporter = Exporter::new(&mut storage, project_path.clone());

    match exporter.export(force) {
        Ok(stats) => {
            if json {
                let output = serde_json::json!({
                    "success": true,
                    "project": project_path,
                    "output_dir": output_dir.display().to_string(),
                    "stats": stats,
                });
                println!("{}", serde_json::to_string(&output)?);
            } else if stats.is_empty() {
                println!("No records exported.");
            } else {
                println!("Export complete for: {project_path}");
                println!();
                if stats.sessions > 0 {
                    println!("  Sessions:      {}", stats.sessions);
                }
                if stats.issues > 0 {
                    println!("  Issues:        {}", stats.issues);
                }
                if stats.context_items > 0 {
                    println!("  Context Items: {}", stats.context_items);
                }
                if stats.memories > 0 {
                    println!("  Memories:      {}", stats.memories);
                }
                if stats.checkpoints > 0 {
                    println!("  Checkpoints:   {}", stats.checkpoints);
                }
                println!();
                println!("  Total: {} records", stats.total());
                println!("  Location: {}", output_dir.display());
            }
            Ok(())
        }
        Err(crate::sync::SyncError::NothingToExport) => {
            if json {
                let output = serde_json::json!({
                    "error": "nothing_to_export",
                    "project": project_path,
                    "message": "No dirty records to export for this project. Use --force to export all records."
                });
                println!("{output}");
            } else {
                println!("No dirty records to export for: {project_path}");
                println!("Use --force to export all records regardless of dirty state.");
            }
            Ok(())
        }
        Err(e) => Err(Error::Other(e.to_string())),
    }
}

fn import(force: bool, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path =
        resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let project_path = get_project_path()?;
    let mut storage = SqliteStorage::open(&db_path)?;
    let import_dir = project_export_dir(&project_path);

    // Choose merge strategy based on --force flag
    let strategy = if force {
        MergeStrategy::PreferExternal
    } else {
        MergeStrategy::PreferNewer
    };

    let mut importer = Importer::new(&mut storage, strategy);

    match importer.import_all(&import_dir) {
        Ok(stats) => {
            let total = stats.total_processed();
            if json {
                let output = serde_json::json!({
                    "success": true,
                    "project": project_path,
                    "import_dir": import_dir.display().to_string(),
                    "stats": stats,
                });
                println!("{}", serde_json::to_string(&output)?);
            } else if total == 0 {
                println!("No records to import for: {project_path}");
                println!("Export files not found in: {}", import_dir.display());
            } else {
                println!("Import complete for: {project_path}");
                println!();
                print_entity_stats("Sessions", &stats.sessions);
                print_entity_stats("Issues", &stats.issues);
                print_entity_stats("Context Items", &stats.context_items);
                print_entity_stats("Memories", &stats.memories);
                print_entity_stats("Checkpoints", &stats.checkpoints);
                println!();
                println!(
                    "Total: {} created, {} updated, {} skipped",
                    stats.total_created(),
                    stats.total_updated(),
                    total - stats.total_created() - stats.total_updated()
                );
            }
            Ok(())
        }
        Err(crate::sync::SyncError::FileNotFound(path)) => {
            if json {
                let output = serde_json::json!({
                    "error": "file_not_found",
                    "project": project_path,
                    "path": path
                });
                println!("{output}");
            } else {
                println!("Import file not found: {path}");
                println!("Run 'sc sync export' first to create JSONL files.");
            }
            Ok(())
        }
        Err(e) => Err(Error::Other(e.to_string())),
    }
}

fn print_entity_stats(name: &str, stats: &crate::sync::EntityStats) {
    let total = stats.total();
    if total > 0 {
        println!(
            "  {}: {} created, {} updated, {} skipped",
            name, stats.created, stats.updated, stats.skipped
        );
    }
}

fn status(db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db_path =
        resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    let project_path = get_project_path()?;
    let storage = SqliteStorage::open(&db_path)?;
    let export_dir = project_export_dir(&project_path);

    let sync_status = crate::sync::get_sync_status(&storage, &export_dir, &project_path)
        .map_err(|e| Error::Other(e.to_string()))?;

    if json {
        let output = serde_json::json!({
            "project": project_path,
            "export_dir": export_dir.display().to_string(),
            "status": sync_status,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Sync status for: {project_path}");
        println!("Export directory: {}", export_dir.display());
        println!();
        crate::sync::print_status(&sync_status);
    }

    Ok(())
}

// ── Push / Pull ─────────────────────────────────────────────

/// JSONL files produced by sync export.
const JSONL_FILES: &[&str] = &[
    "sessions.jsonl",
    "issues.jsonl",
    "context_items.jsonl",
    "memories.jsonl",
    "checkpoints.jsonl",
    "plans.jsonl",
    "time_entries.jsonl",
    "deletions.jsonl",
];

/// Push local JSONL data to remote host via SCP + SSH import.
///
/// Flow: local export (silent) → SCP files to remote → SSH `sc sync import`.
/// Produces a single JSON output object (no double-output from inner export).
fn push(
    force: bool,
    remote_path: Option<&str>,
    db_path: Option<&PathBuf>,
    json: bool,
) -> Result<()> {
    let config = load_remote_config()?;

    // Step 1: Run local export silently (directly via Exporter, no stdout)
    let db = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db.exists() {
        return Err(Error::NotInitialized);
    }
    let project_path = get_project_path()?;
    let local_export_dir = project_export_dir(&project_path);
    {
        let mut storage = SqliteStorage::open(&db)?;
        let mut exporter = Exporter::new(&mut storage, project_path.clone());
        // Ignore NothingToExport — we'll push whatever files exist
        match exporter.export(force) {
            Ok(stats) => {
                if !json {
                    let total = stats.total();
                    if total > 0 {
                        println!("Exported {total} records locally.");
                    }
                }
            }
            Err(crate::sync::SyncError::NothingToExport) => {
                if !json {
                    println!("No new records to export (pushing existing files).");
                }
            }
            Err(e) => return Err(Error::Other(e.to_string())),
        }
    }

    // Step 2: Determine paths
    let remote_project = resolve_remote_project(&config, remote_path)?;
    let remote_export_dir = format!("{remote_project}/.savecontext/");

    debug!(local = %local_export_dir.display(), remote = %remote_export_dir, "Push paths");

    // Step 3: Ensure remote directory exists (shell-quoted)
    ssh_exec(
        &config,
        &format!("mkdir -p {}", shell_quote(&remote_export_dir)),
    )?;

    // Step 4: SCP local JSONL files to remote
    let files_to_push = collect_jsonl_files(&local_export_dir);
    if files_to_push.is_empty() {
        if json {
            let output = serde_json::json!({
                "success": true,
                "message": "No JSONL files to push",
                "project": project_path,
            });
            println!("{}", serde_json::to_string(&output)?);
        } else {
            println!("No JSONL files to push.");
        }
        return Ok(());
    }

    scp_to_remote(&files_to_push, &remote_export_dir, &config)?;

    // Step 5: Run import on remote (shell-quoted)
    let force_flag = if force { " --force" } else { "" };
    let sc_path = config.remote_sc_path.as_deref().unwrap_or("sc");
    let import_cmd = format!(
        "cd {} && {} sync import{}",
        shell_quote(&remote_project),
        shell_quote(sc_path),
        force_flag,
    );
    ssh_exec(&config, &import_cmd)?;

    if json {
        let output = serde_json::json!({
            "success": true,
            "files_pushed": files_to_push.len(),
            "local_project": project_path,
            "remote_project": remote_project,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!(
            "Push complete: {} files -> {}@{}:{}",
            files_to_push.len(),
            config.user,
            config.host,
            remote_export_dir
        );
    }

    Ok(())
}

/// Pull remote JSONL data from remote host via SSH export + SCP.
///
/// Flow: SSH `sc sync export` on remote → SCP `*.jsonl` from remote → local import (silent).
/// Uses wildcard glob for SCP to tolerate missing JSONL files on remote.
fn pull(
    force: bool,
    remote_path: Option<&str>,
    db_path: Option<&PathBuf>,
    json: bool,
) -> Result<()> {
    let config = load_remote_config()?;

    // Step 1: Determine paths
    let project_path = get_project_path()?;
    let local_export_dir = project_export_dir(&project_path);
    let remote_project = resolve_remote_project(&config, remote_path)?;
    let remote_export_dir = format!("{remote_project}/.savecontext/");

    debug!(local = %local_export_dir.display(), remote = %remote_export_dir, "Pull paths");

    // Step 2: Run export on remote (shell-quoted)
    let force_flag = if force { " --force" } else { "" };
    let sc_path = config.remote_sc_path.as_deref().unwrap_or("sc");
    let export_cmd = format!(
        "cd {} && {} sync export{}",
        shell_quote(&remote_project),
        shell_quote(sc_path),
        force_flag,
    );
    ssh_exec(&config, &export_cmd)?;

    // Step 3: Ensure local directory exists
    std::fs::create_dir_all(&local_export_dir).map_err(|e| {
        Error::Other(format!(
            "Failed to create local export directory {}: {e}",
            local_export_dir.display()
        ))
    })?;

    // Step 4: SCP remote JSONL files to local using wildcard glob.
    // This tolerates missing files (e.g., no plans.jsonl on remote).
    let remote_glob = format!("{}*.jsonl", remote_export_dir);
    scp_from_remote_glob(&remote_glob, &local_export_dir, &config)?;

    // Step 5: Run local import silently (directly via Importer, no stdout)
    let db = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db.exists() {
        return Err(Error::NotInitialized);
    }
    let strategy = if force {
        MergeStrategy::PreferExternal
    } else {
        MergeStrategy::PreferNewer
    };
    let import_stats = {
        let mut storage = SqliteStorage::open(&db)?;
        let mut importer = Importer::new(&mut storage, strategy);
        importer
            .import_all(&local_export_dir)
            .map_err(|e| Error::Other(e.to_string()))?
    };

    if json {
        let output = serde_json::json!({
            "success": true,
            "remote_project": remote_project,
            "local_project": project_path,
            "import_stats": import_stats,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        let total = import_stats.total_processed();
        println!(
            "Pull complete: {}@{}:{} -> local",
            config.user, config.host, remote_export_dir
        );
        if total > 0 {
            println!(
                "  {} created, {} updated, {} skipped",
                import_stats.total_created(),
                import_stats.total_updated(),
                total - import_stats.total_created() - import_stats.total_updated()
            );
        }
    }

    Ok(())
}

// ── SSH/SCP Helpers ─────────────────────────────────────────

/// Resolve the remote project path from config or per-command override.
fn resolve_remote_project(config: &RemoteConfig, override_path: Option<&str>) -> Result<String> {
    if let Some(path) = override_path {
        return Ok(path.to_string());
    }
    if let Some(ref path) = config.remote_project_path {
        return Ok(path.clone());
    }
    // Default: use the same path as local CWD
    get_project_path()
}

/// Execute a command on the remote host via SSH.
fn ssh_exec(config: &RemoteConfig, remote_cmd: &str) -> Result<()> {
    let mut args = build_ssh_base_args(config);
    args.push(remote_cmd.to_string());

    debug!(ssh_args = ?args, "SSH exec");

    let output = Command::new("ssh")
        .args(&args)
        .output()
        .map_err(|e| {
            Error::Remote(format!("Failed to execute ssh: {e}. Is ssh installed?"))
        })?;

    if !output.stderr.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        debug!(stderr = %stderr, "SSH stderr");
    }

    if !output.status.success() {
        let code = output.status.code().unwrap_or(1);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Remote(format!(
            "Remote command failed (exit {code}): {stderr}"
        )));
    }

    Ok(())
}

/// Collect existing JSONL files from the local export directory.
fn collect_jsonl_files(dir: &std::path::Path) -> Vec<PathBuf> {
    JSONL_FILES
        .iter()
        .map(|f| dir.join(f))
        .filter(|p| p.exists())
        .collect()
}

/// SCP local files to a remote directory.
fn scp_to_remote(
    local_files: &[PathBuf],
    remote_dir: &str,
    config: &RemoteConfig,
) -> Result<()> {
    let mut args = build_scp_base_args(config);

    // Add local file paths
    for file in local_files {
        args.push(file.display().to_string());
    }

    // Remote destination
    args.push(format!("{}@{}:{}", config.user, config.host, remote_dir));

    debug!(scp_args = ?args, "SCP to remote");

    let output = Command::new("scp")
        .args(&args)
        .output()
        .map_err(|e| {
            Error::Remote(format!("Failed to execute scp: {e}. Is scp installed?"))
        })?;

    if !output.status.success() {
        let code = output.status.code().unwrap_or(1);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Remote(format!(
            "SCP push failed (exit {code}): {stderr}"
        )));
    }

    Ok(())
}

/// SCP remote files to a local directory using a glob pattern.
///
/// Uses a single `user@host:pattern` source to let the remote shell expand
/// the glob, which tolerates missing files (only transfers what exists).
fn scp_from_remote_glob(
    remote_glob: &str,
    local_dir: &std::path::Path,
    config: &RemoteConfig,
) -> Result<()> {
    let mut args = build_scp_base_args(config);

    // Remote source with glob (the remote shell expands the wildcard)
    args.push(format!("{}@{}:{}", config.user, config.host, remote_glob));

    // Local destination
    args.push(local_dir.display().to_string());

    debug!(scp_args = ?args, "SCP from remote (glob)");

    let output = Command::new("scp")
        .args(&args)
        .output()
        .map_err(|e| {
            Error::Remote(format!("Failed to execute scp: {e}. Is scp installed?"))
        })?;

    if !output.status.success() {
        let code = output.status.code().unwrap_or(1);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Tolerate "no match" errors — remote may have no JSONL files yet
        let stderr_lower = stderr.to_lowercase();
        if stderr_lower.contains("no match") || stderr_lower.contains("no such file") {
            debug!("SCP glob found no files on remote — this is OK for first pull");
            return Ok(());
        }
        return Err(Error::Remote(format!(
            "SCP pull failed (exit {code}): {stderr}"
        )));
    }

    Ok(())
}

/// SCP a single file from the remote host to a local path.
fn scp_from_remote(
    remote_path: &str,
    local_path: &std::path::Path,
    config: &RemoteConfig,
) -> Result<()> {
    let mut args = build_scp_base_args(config);
    args.push(format!(
        "{}@{}:{}",
        config.user, config.host, remote_path
    ));
    args.push(local_path.display().to_string());

    debug!(scp_args = ?args, "SCP from remote (single file)");

    let output = Command::new("scp")
        .args(&args)
        .output()
        .map_err(|e| Error::Remote(format!("Failed to execute scp: {e}")))?;

    if !output.status.success() {
        let code = output.status.code().unwrap_or(1);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Remote(format!(
            "SCP pull failed (exit {code}): {stderr}"
        )));
    }

    Ok(())
}

/// Execute a command on the remote host and capture stdout.
fn ssh_exec_output(config: &RemoteConfig, remote_cmd: &str) -> Result<String> {
    let mut args = build_ssh_base_args(config);
    args.push(remote_cmd.to_string());

    debug!(ssh_args = ?args, "SSH exec (capture output)");

    let output = Command::new("ssh")
        .args(&args)
        .output()
        .map_err(|e| Error::Remote(format!("Failed to execute ssh: {e}")))?;

    if !output.status.success() {
        let code = output.status.code().unwrap_or(1);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Remote(format!(
            "Remote command failed (exit {code}): {stderr}"
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Compute SHA256 hash of a file, returned as a lowercase hex string.
fn file_sha256(path: &std::path::Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(path)
        .map_err(|e| Error::Other(format!("Failed to open {}: {e}", path.display())))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| Error::Other(format!("Failed to read {}: {e}", path.display())))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// ── Full DB Sync ────────────────────────────────────────────

/// Default remote database path (standard SaveContext location).
const DEFAULT_REMOTE_DB: &str = "~/.savecontext/data/savecontext.db";

/// Resolve the remote database path from config or use default.
fn resolve_remote_db(config: &RemoteConfig) -> String {
    config
        .remote_db_path
        .clone()
        .unwrap_or_else(|| DEFAULT_REMOTE_DB.to_string())
}

/// Create a local database backup file.
///
/// Uses SQLite's Backup API to produce a consistent snapshot.
/// Output defaults to `{db_path}.backup` if no path specified.
fn backup(output: Option<&str>, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let db = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db.exists() {
        return Err(Error::NotInitialized);
    }

    let dest = match output {
        Some(p) => PathBuf::from(p),
        None => {
            let mut p = db.clone();
            p.set_extension("db.backup");
            p
        }
    };

    let storage = SqliteStorage::open(&db)?;
    storage.backup_to(&dest)?;

    let file_size = std::fs::metadata(&dest)
        .map(|m| m.len())
        .unwrap_or(0);

    if json {
        let out = serde_json::json!({
            "success": true,
            "source": db.display().to_string(),
            "backup": dest.display().to_string(),
            "size_bytes": file_size,
        });
        println!("{}", serde_json::to_string(&out)?);
    } else {
        println!("Backup created: {}", dest.display());
        println!("  Source: {}", db.display());
        println!("  Size:   {:.2} MB", file_size as f64 / 1_048_576.0);
    }

    Ok(())
}

/// Push full database to remote host via SQLite backup + SCP.
///
/// Flow:
/// 1. Create local backup via Backup API
/// 2. SCP backup to remote as `{remote_db}.new`
/// 3. SSH: integrity check on remote
/// 4. SSH: timestamped backup of existing remote DB
/// 5. SSH: atomic replace (mv + remove WAL/SHM)
/// 6. Clean up local temp file
fn push_full(db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let config = load_remote_config()?;
    let db = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;
    if !db.exists() {
        return Err(Error::NotInitialized);
    }

    let remote_db = resolve_remote_db(&config);

    // Step 1: Create local backup
    let temp_backup = db.with_extension("db.push-tmp");
    let storage = SqliteStorage::open(&db)?;
    storage.backup_to(&temp_backup)?;
    // Drop storage to release the connection
    drop(storage);

    let file_size = std::fs::metadata(&temp_backup)
        .map(|m| m.len())
        .unwrap_or(0);

    if !json {
        println!(
            "Created local backup ({:.2} MB)",
            file_size as f64 / 1_048_576.0
        );
    }

    // Step 2: SCP backup to remote as {remote_db}.new
    let remote_staging = format!("{remote_db}.new");
    // Ensure remote directory exists
    let remote_dir_cmd = if remote_db.starts_with('~') {
        // For paths starting with ~, extract the directory part
        format!(
            "mkdir -p $(dirname {})",
            shell_quote(&remote_db)
        )
    } else {
        format!(
            "mkdir -p $(dirname {})",
            shell_quote(&remote_db)
        )
    };
    ssh_exec(&config, &remote_dir_cmd)?;

    scp_to_remote(&[temp_backup.clone()], &remote_staging, &config)?;

    if !json {
        println!("Uploaded to {}@{}:{}", config.user, config.host, remote_staging);
    }

    // Step 3: Verify transfer via SHA256 checksum
    let local_hash = file_sha256(&temp_backup)?;
    let hash_cmd = format!("sha256sum {} | cut -d' ' -f1", shell_quote(&remote_staging));
    let remote_hash = ssh_exec_output(&config, &hash_cmd)?;
    if local_hash != remote_hash {
        let _ = ssh_exec(
            &config,
            &format!("rm -f {}", shell_quote(&remote_staging)),
        );
        let _ = std::fs::remove_file(&temp_backup);
        return Err(Error::Remote(format!(
            "Checksum mismatch: local={local_hash}, remote={remote_hash}"
        )));
    }

    if !json {
        println!("Checksum verified: {local_hash}");
    }

    // Step 4: Timestamped backup of existing remote DB (if it exists)
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let pre_push_backup = format!("{remote_db}.pre-push-{timestamp}");
    let backup_cmd = format!(
        "test -f {} && cp {} {} || true",
        shell_quote(&remote_db),
        shell_quote(&remote_db),
        shell_quote(&pre_push_backup),
    );
    ssh_exec(&config, &backup_cmd)?;

    // Step 5: Atomic replace
    let replace_cmd = format!(
        "mv {} {} && rm -f {}-wal {}-shm",
        shell_quote(&remote_staging),
        shell_quote(&remote_db),
        shell_quote(&remote_db),
        shell_quote(&remote_db),
    );
    ssh_exec(&config, &replace_cmd)?;

    // Step 6: Clean up local temp file
    let _ = std::fs::remove_file(&temp_backup);

    if json {
        let out = serde_json::json!({
            "success": true,
            "mode": "full",
            "size_bytes": file_size,
            "remote_db": remote_db,
            "remote_host": format!("{}@{}:{}", config.user, config.host, config.port),
            "pre_push_backup": pre_push_backup,
        });
        println!("{}", serde_json::to_string(&out)?);
    } else {
        println!(
            "Full push complete: {:.2} MB -> {}@{}:{}",
            file_size as f64 / 1_048_576.0,
            config.user,
            config.host,
            remote_db
        );
        println!("  Remote backup: {pre_push_backup}");
    }

    Ok(())
}

/// Pull full database from remote host via SSH backup + SCP.
///
/// Flow:
/// 1. SSH: create backup on remote via `sc sync backup`
/// 2. SCP backup file to local temp path
/// 3. Validate locally (integrity check)
/// 4. Timestamped backup of existing local DB
/// 5. Atomic replace (mv + remove WAL/SHM)
fn pull_full(db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let config = load_remote_config()?;
    let db = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    let remote_db = resolve_remote_db(&config);
    let sc_path = config.remote_sc_path.as_deref().unwrap_or("sc");

    // Step 1: Create backup on remote
    let backup_path = format!("{remote_db}.backup");
    let backup_cmd = format!(
        "{} --db {} sync backup --output {} --json",
        shell_quote(sc_path),
        shell_quote(&remote_db),
        shell_quote(&backup_path),
    );

    if !json {
        println!("Creating backup on remote...");
    }
    ssh_exec(&config, &backup_cmd)?;

    // Step 2: SCP backup to local temp
    let local_temp = db.with_extension("db.pull-tmp");
    scp_from_remote(&backup_path, &local_temp, &config)?;

    let file_size = std::fs::metadata(&local_temp)
        .map(|m| m.len())
        .unwrap_or(0);

    if !json {
        println!(
            "Downloaded {:.2} MB from {}@{}",
            file_size as f64 / 1_048_576.0,
            config.user,
            config.host
        );
    }

    // Step 3: Validate locally — open and run integrity check
    {
        let check_storage = SqliteStorage::open(&local_temp)?;
        let result: String = check_storage
            .conn()
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if result != "ok" {
            let _ = std::fs::remove_file(&local_temp);
            return Err(Error::Other(format!(
                "Downloaded database failed integrity check: {result}"
            )));
        }
    }

    if !json {
        println!("Local integrity check passed.");
    }

    // Step 4: Timestamped backup of existing local DB (if it exists)
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let pre_pull_backup = db.with_extension(format!("db.pre-pull-{timestamp}"));
    if db.exists() {
        std::fs::copy(&db, &pre_pull_backup).map_err(|e| {
            Error::Other(format!(
                "Failed to create local backup at {}: {e}",
                pre_pull_backup.display()
            ))
        })?;
    }

    // Step 5: Atomic replace
    std::fs::rename(&local_temp, &db).map_err(|e| {
        Error::Other(format!("Failed to replace local database: {e}"))
    })?;
    // Remove stale WAL/SHM files
    let wal = db.with_extension("db-wal");
    let shm = db.with_extension("db-shm");
    let _ = std::fs::remove_file(&wal);
    let _ = std::fs::remove_file(&shm);

    // Step 6: Clean up remote backup
    let cleanup_cmd = format!("rm -f {}", shell_quote(&backup_path));
    let _ = ssh_exec(&config, &cleanup_cmd);

    if json {
        let out = serde_json::json!({
            "success": true,
            "mode": "full",
            "size_bytes": file_size,
            "remote_db": remote_db,
            "remote_host": format!("{}@{}:{}", config.user, config.host, config.port),
            "local_backup": pre_pull_backup.display().to_string(),
        });
        println!("{}", serde_json::to_string(&out)?);
    } else {
        println!(
            "Full pull complete: {}@{}:{} -> {}",
            config.user,
            config.host,
            remote_db,
            db.display()
        );
        println!("  Size: {:.2} MB", file_size as f64 / 1_048_576.0);
        if pre_pull_backup.exists() {
            println!("  Local backup: {}", pre_pull_backup.display());
        }
    }

    Ok(())
}
