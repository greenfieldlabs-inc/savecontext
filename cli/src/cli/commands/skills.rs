//! Skills install and management commands.
//!
//! Downloads skills, hooks, and status line scripts from GitHub
//! and installs them for detected AI coding tools (Claude Code, Codex, Gemini).
//!
//! This enables Rust CLI users to get full skill/hook support without
//! needing npm/bun or cloning the repository.

use crate::cli::SkillsCommands;
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::{debug, info, warn};

// ── Constants ────────────────────────────────────────────────

/// GitHub raw content base URL for skill files.
const GITHUB_RAW_BASE: &str =
    "https://raw.githubusercontent.com/shaneholloman/savecontext-mono/main/savecontext/server";

/// Skill files relative to the server directory.
/// CLI mode skills.
const CLI_SKILL_FILES: &[&str] = &[
    "skills/SaveContext-CLI/SKILL.md",
    "skills/SaveContext-CLI/Workflows/QuickSave.md",
    "skills/SaveContext-CLI/Workflows/SessionStart.md",
    "skills/SaveContext-CLI/Workflows/Resume.md",
    "skills/SaveContext-CLI/Workflows/WrapUp.md",
    "skills/SaveContext-CLI/Workflows/Compaction.md",
    "skills/SaveContext-CLI/Workflows/FeatureLifecycle.md",
    "skills/SaveContext-CLI/Workflows/IssueTracking.md",
    "skills/SaveContext-CLI/Workflows/Planning.md",
    "skills/SaveContext-CLI/Workflows/AdvancedWorkflows.md",
    "skills/SaveContext-CLI/Workflows/Reference.md",
    "skills/SaveContext-CLI/Workflows/Prime.md",
];

/// MCP mode skills.
const MCP_SKILL_FILES: &[&str] = &[
    "skills/SaveContext-MCP/SKILL.md",
    "skills/SaveContext-MCP/Workflows/QuickSave.md",
    "skills/SaveContext-MCP/Workflows/SessionStart.md",
    "skills/SaveContext-MCP/Workflows/Resume.md",
    "skills/SaveContext-MCP/Workflows/WrapUp.md",
    "skills/SaveContext-MCP/Workflows/Compaction.md",
    "skills/SaveContext-MCP/Workflows/FeatureLifecycle.md",
    "skills/SaveContext-MCP/Workflows/IssueTracking.md",
    "skills/SaveContext-MCP/Workflows/Planning.md",
    "skills/SaveContext-MCP/Workflows/AdvancedWorkflows.md",
    "skills/SaveContext-MCP/Workflows/Reference.md",
];

/// Hook and status line scripts.
const HOOK_FILES: &[&str] = &[
    "scripts/statusline.py",
    "scripts/update-status-cache.py",
    "scripts/statusline.json",
];

/// Known tool directories and their skill installation paths.
const KNOWN_TOOLS: &[(&str, &str)] = &[
    ("claude-code", ".claude/skills"),
    ("codex", ".codex/skills"),
    ("gemini", ".gemini/skills"),
];

// ── Types ────────────────────────────────────────────────────

/// A detected AI coding tool on this machine.
struct DetectedTool {
    name: String,
    skills_dir: PathBuf,
}

/// Tracks installed skills (compatible with TypeScript skill-sync.json).
#[derive(Debug, Serialize, Deserialize, Default)]
struct SkillSyncConfig {
    installations: Vec<SkillInstallation>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SkillInstallation {
    tool: String,
    path: String,
    #[serde(rename = "installedAt")]
    installed_at: u64,
    mode: String,
}

/// Result of an install operation for JSON output.
#[derive(Debug, Serialize)]
struct InstallResult {
    success: bool,
    tools: Vec<ToolInstallResult>,
    hooks_installed: bool,
    settings_configured: bool,
    python_found: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct ToolInstallResult {
    tool: String,
    path: String,
    files_installed: usize,
    modes: Vec<String>,
}

// ── Entry Points ─────────────────────────────────────────────

/// Execute skills commands.
pub fn execute(command: &SkillsCommands, json: bool) -> Result<()> {
    match command {
        SkillsCommands::Install { tool, mode } => install(tool.as_deref(), mode, json),
        SkillsCommands::Status => status(json),
        SkillsCommands::Update { tool } => update(tool.as_deref(), json),
    }
}

fn install(tool: Option<&str>, mode: &str, json: bool) -> Result<()> {
    let modes = parse_modes(mode)?;
    let home = home_dir()?;

    // Detect or filter tools
    let tools = if let Some(name) = tool {
        let t = resolve_tool(name, &home)?;
        vec![t]
    } else {
        detect_tools(&home)
    };

    if tools.is_empty() {
        if json {
            let output = serde_json::json!({
                "success": false,
                "error": "No AI coding tools detected. Install Claude Code, Codex, or Gemini first.",
                "tools": []
            });
            println!("{}", serde_json::to_string(&output)?);
            return Ok(());
        }
        return Err(Error::SkillInstall(
            "No AI coding tools detected. Install Claude Code, Codex, or Gemini CLI first."
                .to_string(),
        ));
    }

    if !json {
        println!("Installing SaveContext skills...");
        println!();
    }

    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| Error::SkillInstall(format!("Failed to create async runtime: {e}")))?;

    let mut result = InstallResult {
        success: true,
        tools: Vec::new(),
        hooks_installed: false,
        settings_configured: false,
        python_found: None,
        error: None,
    };

    // Create a shared HTTP client for connection reuse across all downloads
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| Error::Download(format!("HTTP client error: {e}")))?;

    // Download and install skills for each tool
    for detected in &tools {
        match rt.block_on(install_skills_for_tool(detected, &modes, &client)) {
            Ok(tool_result) => {
                if !json {
                    println!(
                        "  {} — {} files installed ({})",
                        detected.name,
                        tool_result.files_installed,
                        tool_result.modes.join(", ")
                    );
                }
                result.tools.push(tool_result);
            }
            Err(e) => {
                if !json {
                    eprintln!("  {} — failed: {e}", detected.name);
                }
                result.success = false;
                result.error = Some(e.to_string());
            }
        }
    }

    // Install hooks
    match rt.block_on(install_hooks(&home, &client)) {
        Ok(()) => {
            result.hooks_installed = true;
            if !json {
                println!("  Hooks installed to ~/.savecontext/hooks/");
            }
        }
        Err(e) => {
            if !json {
                eprintln!("  Hooks failed: {e}");
            }
        }
    }

    // Configure Claude Code settings (if Claude Code is among the tools)
    let python = find_python();
    result.python_found = python.clone();

    let has_claude = tools.iter().any(|t| t.name == "claude-code");
    if has_claude {
        if let Some(ref py) = python {
            match configure_claude_settings(py, &home) {
                Ok(()) => {
                    result.settings_configured = true;
                    if !json {
                        println!("  Claude Code settings.json updated (statusline + hooks)");
                    }
                }
                Err(e) => {
                    if !json {
                        eprintln!("  Claude Code settings update failed: {e}");
                    }
                }
            }
        } else if !json {
            println!("  Warning: Python not found. Hooks require Python 3.");
            println!("  Install Python and re-run: sc skills install");
        }
    }

    // Update skill-sync.json tracking
    update_sync_config(&tools, &modes);

    if json {
        println!("{}", serde_json::to_string(&result)?);
    } else {
        println!();
        if result.success {
            println!("Skills installed successfully.");
        } else {
            println!("Skills installed with errors. Check output above.");
        }
    }

    Ok(())
}

fn status(json: bool) -> Result<()> {
    let config = load_sync_config();

    if json {
        let output = serde_json::json!({
            "installations": config.installations,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else if config.installations.is_empty() {
        println!("No skills installed.");
        println!("Run: sc skills install");
    } else {
        println!("Installed skills:");
        println!();
        for inst in &config.installations {
            let ts = chrono::DateTime::from_timestamp_millis(inst.installed_at as i64)
                .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| "unknown".to_string());
            println!("  {} — mode: {}, installed: {}", inst.tool, inst.mode, ts);
            println!("    {}", inst.path);
        }
    }
    Ok(())
}

fn update(tool: Option<&str>, json: bool) -> Result<()> {
    // Update is just re-install
    install(tool, "both", json)
}

// ── Helpers ──────────────────────────────────────────────────

fn home_dir() -> Result<PathBuf> {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .ok_or_else(|| Error::SkillInstall("Could not determine home directory".to_string()))
}

fn parse_modes(mode: &str) -> Result<Vec<String>> {
    match mode.to_lowercase().as_str() {
        "both" => Ok(vec!["cli".to_string(), "mcp".to_string()]),
        "cli" => Ok(vec!["cli".to_string()]),
        "mcp" => Ok(vec!["mcp".to_string()]),
        other => Err(Error::InvalidArgument(format!(
            "Invalid mode '{other}'. Use: cli, mcp, or both"
        ))),
    }
}

fn detect_tools(home: &Path) -> Vec<DetectedTool> {
    let mut tools = Vec::new();
    for (name, rel_path) in KNOWN_TOOLS {
        // Check if the tool's config directory exists (e.g., ~/.claude/)
        let config_dir = home.join(rel_path.split('/').next().unwrap_or(""));
        if config_dir.exists() {
            let skills_dir = home.join(rel_path);
            debug!(tool = name, path = %skills_dir.display(), "Detected tool");
            tools.push(DetectedTool {
                name: name.to_string(),
                skills_dir,
            });
        }
    }
    tools
}

fn resolve_tool(name: &str, home: &Path) -> Result<DetectedTool> {
    // Normalize tool name
    let normalized = match name.to_lowercase().as_str() {
        "claude" | "claude-code" | "claudecode" => "claude-code",
        "codex" | "codex-cli" => "codex",
        "gemini" | "gemini-cli" => "gemini",
        other => {
            return Err(Error::InvalidArgument(format!(
                "Unknown tool '{other}'. Supported: claude-code, codex, gemini"
            )));
        }
    };

    let (_, rel_path) = KNOWN_TOOLS
        .iter()
        .find(|(n, _)| *n == normalized)
        .unwrap();

    Ok(DetectedTool {
        name: normalized.to_string(),
        skills_dir: home.join(rel_path),
    })
}

async fn download_file(relative_path: &str, client: &reqwest::Client) -> Result<String> {
    let url = format!("{GITHUB_RAW_BASE}/{relative_path}");
    debug!(url = %url, "Downloading");

    let response = client
        .get(&url)
        .header("User-Agent", "savecontext-cli")
        .send()
        .await
        .map_err(|e| Error::Download(format!("Failed to fetch {url}: {e}")))?;

    if !response.status().is_success() {
        return Err(Error::Download(format!(
            "HTTP {} for {url}",
            response.status()
        )));
    }

    response
        .text()
        .await
        .map_err(|e| Error::Download(format!("Failed to read response from {url}: {e}")))
}

async fn install_skills_for_tool(
    tool: &DetectedTool,
    modes: &[String],
    client: &reqwest::Client,
) -> Result<ToolInstallResult> {
    let mut files_installed = 0;
    let mut installed_modes = Vec::new();

    for mode in modes {
        let file_list = match mode.as_str() {
            "cli" => CLI_SKILL_FILES,
            "mcp" => MCP_SKILL_FILES,
            _ => continue,
        };

        for relative_path in file_list {
            let content = download_file(relative_path, client).await?;

            // Map skill path: "skills/SaveContext-CLI/SKILL.md"
            // → ~/.claude/skills/SaveContext-CLI/SKILL.md
            let dest = tool.skills_dir.join(
                relative_path
                    .strip_prefix("skills/")
                    .unwrap_or(relative_path),
            );

            // Create parent directories
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    Error::SkillInstall(format!("Failed to create directory {}: {e}", parent.display()))
                })?;
            }

            fs::write(&dest, content).map_err(|e| {
                Error::SkillInstall(format!("Failed to write {}: {e}", dest.display()))
            })?;

            files_installed += 1;
        }

        installed_modes.push(mode.clone());
    }

    // Clean up legacy skill directories (same as TypeScript setup)
    cleanup_legacy_skills(&tool.skills_dir);

    Ok(ToolInstallResult {
        tool: tool.name.clone(),
        path: tool.skills_dir.display().to_string(),
        files_installed,
        modes: installed_modes,
    })
}

/// Remove old-style skill directories that predate the CLI/MCP split.
fn cleanup_legacy_skills(skills_dir: &Path) {
    for legacy_name in &["savecontext", "SaveContext"] {
        let legacy_path = skills_dir.join(legacy_name);
        if legacy_path.exists() {
            info!(path = %legacy_path.display(), "Removing legacy skill directory");
            let _ = fs::remove_dir_all(&legacy_path);
        }
    }
}

async fn install_hooks(home: &Path, client: &reqwest::Client) -> Result<()> {
    let hooks_dir = home.join(".savecontext").join("hooks");
    let sc_dir = home.join(".savecontext");

    fs::create_dir_all(&hooks_dir)
        .map_err(|e| Error::SkillInstall(format!("Failed to create hooks dir: {e}")))?;

    for relative_path in HOOK_FILES {
        let content = download_file(relative_path, client).await?;

        // "scripts/statusline.py" → ~/.savecontext/statusline.py (status line at root)
        // "scripts/update-status-cache.py" → ~/.savecontext/hooks/update-status-cache.py
        // "scripts/statusline.json" → ~/.savecontext/statusline.json (at root)
        let filename = Path::new(relative_path)
            .file_name()
            .unwrap_or_default()
            .to_str()
            .unwrap_or_default();

        let dest = if filename == "update-status-cache.py" {
            hooks_dir.join(filename)
        } else {
            sc_dir.join(filename)
        };

        fs::write(&dest, &content).map_err(|e| {
            Error::SkillInstall(format!("Failed to write {}: {e}", dest.display()))
        })?;

        // Make Python scripts executable on Unix
        #[cfg(unix)]
        if filename.ends_with(".py") {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(0o755));
        }
    }

    Ok(())
}

fn find_python() -> Option<String> {
    for cmd in &["python3", "python"] {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                let version = version.trim();
                // Ensure it's Python 3
                if version.contains("Python 3") {
                    return Some(cmd.to_string());
                }
                // Check stderr too (some Python versions print to stderr)
                let stderr_ver = String::from_utf8_lossy(&output.stderr);
                if stderr_ver.trim().contains("Python 3") {
                    return Some(cmd.to_string());
                }
            }
        }
    }
    warn!("Python 3 not found in PATH");
    None
}

fn configure_claude_settings(python_cmd: &str, home: &Path) -> Result<()> {
    let settings_path = home.join(".claude").join("settings.json");
    let hook_dest = home
        .join(".savecontext")
        .join("hooks")
        .join("update-status-cache.py");
    let statusline_dest = home.join(".savecontext").join("statusline.py");

    // Read existing settings or start fresh
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| Error::Config(format!("Failed to read settings.json: {e}")))?;
        match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                return Err(Error::Config(format!(
                    "Cannot parse existing settings.json: {e}. \
                     Fix the JSON syntax and re-run: sc skills install"
                )));
            }
        }
    } else {
        serde_json::json!({})
    };

    // Set statusLine (matches Claude Code expected format)
    settings["statusLine"] = serde_json::json!({
        "command": format!("{python_cmd} {}", statusline_dest.display()),
        "refreshSeconds": 3,
    });

    // Configure hooks — preserve existing, add/update SaveContext hook
    if settings.get("hooks").is_none() {
        settings["hooks"] = serde_json::json!({});
    }
    if settings["hooks"].get("PostToolUse").is_none() {
        settings["hooks"]["PostToolUse"] = serde_json::json!([]);
    }

    // Remove any existing SaveContext hook
    if let Some(arr) = settings["hooks"]["PostToolUse"].as_array_mut() {
        arr.retain(|hook| {
            hook.get("matcher")
                .and_then(|m| m.as_str())
                .map_or(true, |m| m != "mcp__savecontext__.*")
        });

        // Add SaveContext hook
        arr.push(serde_json::json!({
            "matcher": "mcp__savecontext__.*",
            "hooks": [{
                "type": "command",
                "command": format!("{python_cmd} {}", hook_dest.display()),
                "timeout": 10
            }]
        }));
    }

    // Write settings back
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| Error::Config(format!("Failed to create .claude dir: {e}")))?;
    }

    let json_str = serde_json::to_string_pretty(&settings)?;
    fs::write(&settings_path, format!("{json_str}\n"))
        .map_err(|e| Error::Config(format!("Failed to write settings.json: {e}")))?;

    debug!(path = %settings_path.display(), "Updated Claude Code settings");
    Ok(())
}

fn sync_config_path() -> PathBuf {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().join(".savecontext").join("skill-sync.json"))
        .unwrap_or_else(|| PathBuf::from(".savecontext/skill-sync.json"))
}

fn load_sync_config() -> SkillSyncConfig {
    let path = sync_config_path();
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        SkillSyncConfig::default()
    }
}

fn update_sync_config(tools: &[DetectedTool], modes: &[String]) {
    let mut config = load_sync_config();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let mode_str = if modes.len() > 1 {
        "both".to_string()
    } else {
        modes.first().cloned().unwrap_or_else(|| "both".to_string())
    };

    for tool in tools {
        // Remove existing entry for this tool
        config
            .installations
            .retain(|i| i.tool != tool.name);

        config.installations.push(SkillInstallation {
            tool: tool.name.clone(),
            path: tool.skills_dir.display().to_string(),
            installed_at: now,
            mode: mode_str.clone(),
        });
    }

    let path = sync_config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json_str) = serde_json::to_string_pretty(&config) {
        let _ = fs::write(&path, format!("{json_str}\n"));
    }
}
