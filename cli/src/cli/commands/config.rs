//! Configuration management commands.
//!
//! Manages SaveContext settings including remote host configuration
//! stored at `~/.savecontext/config.json`.

use crate::cli::{ConfigCommands, ConfigRemoteCommands};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ── Types ────────────────────────────────────────────────────

/// Top-level SaveContext configuration.
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SaveContextConfig {
    #[serde(default)]
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<RemoteConfig>,
}

/// Remote host configuration for SSH proxy and sync.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteConfig {
    pub host: String,
    pub user: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default = "default_sc_path")]
    pub remote_sc_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_db_path: Option<String>,
}

fn default_port() -> u16 {
    22
}

fn default_sc_path() -> Option<String> {
    Some("sc".to_string())
}

// ── Public API ───────────────────────────────────────────────

/// Execute config commands.
pub fn execute(command: &ConfigCommands, json: bool) -> Result<()> {
    match command {
        ConfigCommands::Remote { command } => match command {
            ConfigRemoteCommands::Set(args) => remote_set(args, json),
            ConfigRemoteCommands::Show => remote_show(json),
            ConfigRemoteCommands::Remove => remote_remove(json),
        },
    }
}

/// Load the SaveContext configuration file.
///
/// Returns default config if file doesn't exist or is invalid.
pub fn load_config() -> SaveContextConfig {
    let path = config_path();
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        SaveContextConfig::default()
    }
}

/// Load the remote configuration, returning an error if not configured.
pub fn load_remote_config() -> Result<RemoteConfig> {
    let config = load_config();
    config.remote.ok_or_else(|| {
        Error::Remote(
            "No remote configured. Run: sc config remote set --host <host> --user <user>"
                .to_string(),
        )
    })
}

/// Path to the global config file.
pub fn config_path() -> PathBuf {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().join(".savecontext").join("config.json"))
        .unwrap_or_else(|| PathBuf::from(".savecontext/config.json"))
}

// ── Command Handlers ─────────────────────────────────────────

fn remote_set(args: &crate::cli::RemoteSetArgs, json: bool) -> Result<()> {
    let mut config = load_config();
    config.version = 1;
    config.remote = Some(RemoteConfig {
        host: args.host.clone(),
        user: args.user.clone(),
        port: args.port,
        identity_file: args.identity_file.clone(),
        remote_sc_path: args.remote_sc_path.clone(),
        remote_project_path: args.remote_project_path.clone(),
        remote_db_path: args.remote_db_path.clone(),
    });

    save_config(&config)?;

    if json {
        let output = serde_json::json!({
            "success": true,
            "remote": config.remote,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Remote configuration saved.");
        println!();
        println!("  Host: {}@{}:{}", args.user, args.host, args.port);
        if let Some(ref key) = args.identity_file {
            println!("  Key:  {key}");
        }
        if let Some(ref path) = args.remote_project_path {
            println!("  Path: {path}");
        }
        println!();
        println!("Test with: sc remote version");
    }

    Ok(())
}

fn remote_show(json: bool) -> Result<()> {
    let config = load_config();

    if json {
        let output = serde_json::json!({
            "configured": config.remote.is_some(),
            "remote": config.remote,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else if let Some(ref remote) = config.remote {
        println!("Remote configuration:");
        println!();
        println!("  Host: {}@{}:{}", remote.user, remote.host, remote.port);
        if let Some(ref key) = remote.identity_file {
            println!("  Key:  {key}");
        }
        println!(
            "  SC:   {}",
            remote.remote_sc_path.as_deref().unwrap_or("sc")
        );
        if let Some(ref path) = remote.remote_project_path {
            println!("  Path: {path}");
        }
        if let Some(ref db) = remote.remote_db_path {
            println!("  DB:   {db}");
        }
    } else {
        println!("No remote configured.");
        println!("Run: sc config remote set --host <host> --user <user>");
    }

    Ok(())
}

fn remote_remove(json: bool) -> Result<()> {
    let mut config = load_config();
    let was_configured = config.remote.is_some();
    config.remote = None;

    save_config(&config)?;

    if json {
        let output = serde_json::json!({
            "success": true,
            "removed": was_configured,
        });
        println!("{}", serde_json::to_string(&output)?);
    } else if was_configured {
        println!("Remote configuration removed.");
    } else {
        println!("No remote configuration to remove.");
    }

    Ok(())
}

// ── SSH Helpers (shared by remote.rs and sync.rs) ───────────

/// Shell-quote a string for safe interpolation into a remote shell command.
///
/// Wraps the value in single quotes and escapes any embedded single quotes
/// using the `'\''` idiom (end quote, escaped literal quote, restart quote).
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Build base SSH connection args from remote config.
///
/// Returns args for: identity file, port, BatchMode, ConnectTimeout, user@host.
/// Does NOT include the remote command — caller appends that.
pub fn build_ssh_base_args(config: &RemoteConfig) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(ref key) = config.identity_file {
        args.push("-i".to_string());
        args.push(key.clone());
    }

    if config.port != 22 {
        args.push("-p".to_string());
        args.push(config.port.to_string());
    }

    args.push("-o".to_string());
    args.push("BatchMode=yes".to_string());
    args.push("-o".to_string());
    args.push("ConnectTimeout=10".to_string());

    // Target: user@host
    args.push(format!("{}@{}", config.user, config.host));

    args
}

/// Build base SCP connection args from remote config.
///
/// Same as SSH but uses uppercase `-P` for port (SCP convention).
/// Does NOT include source/destination paths — caller appends those.
pub fn build_scp_base_args(config: &RemoteConfig) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(ref key) = config.identity_file {
        args.push("-i".to_string());
        args.push(key.clone());
    }

    if config.port != 22 {
        args.push("-P".to_string()); // SCP uses uppercase -P
        args.push(config.port.to_string());
    }

    args.push("-o".to_string());
    args.push("BatchMode=yes".to_string());
    args.push("-o".to_string());
    args.push("ConnectTimeout=10".to_string());

    args
}

// ── Helpers ──────────────────────────────────────────────────

fn save_config(config: &SaveContextConfig) -> Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| Error::Config(format!("Failed to create config directory: {e}")))?;
    }

    let json_str = serde_json::to_string_pretty(config)?;
    fs::write(&path, format!("{json_str}\n"))
        .map_err(|e| Error::Config(format!("Failed to write config: {e}")))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = SaveContextConfig::default();
        assert_eq!(config.version, 0);
        assert!(config.remote.is_none());
    }

    #[test]
    fn test_remote_config_serialization() {
        let config = SaveContextConfig {
            version: 1,
            remote: Some(RemoteConfig {
                host: "example.com".to_string(),
                user: "shane".to_string(),
                port: 22,
                identity_file: None,
                remote_sc_path: Some("sc".to_string()),
                remote_project_path: None,
                remote_db_path: None,
            }),
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: SaveContextConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.version, 1);
        let remote = parsed.remote.unwrap();
        assert_eq!(remote.host, "example.com");
        assert_eq!(remote.user, "shane");
        assert_eq!(remote.port, 22);
    }

    #[test]
    fn test_config_path_is_under_savecontext() {
        let path = config_path();
        assert!(path.to_string_lossy().contains(".savecontext"));
        assert!(path.to_string_lossy().ends_with("config.json"));
    }

    #[test]
    fn test_shell_quote_simple() {
        assert_eq!(shell_quote("hello"), "'hello'");
    }

    #[test]
    fn test_shell_quote_with_spaces() {
        assert_eq!(shell_quote("/path/to/my project"), "'/path/to/my project'");
    }

    #[test]
    fn test_shell_quote_with_semicolon() {
        assert_eq!(shell_quote("foo; rm -rf /"), "'foo; rm -rf /'");
    }

    #[test]
    fn test_shell_quote_with_single_quotes() {
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn test_shell_quote_with_backticks() {
        assert_eq!(shell_quote("`whoami`"), "'`whoami`'");
    }

    #[test]
    fn test_build_ssh_base_args_includes_user_host() {
        let config = RemoteConfig {
            host: "example.com".to_string(),
            user: "shane".to_string(),
            port: 22,
            identity_file: None,
            remote_sc_path: None,
            remote_project_path: None,
            remote_db_path: None,
        };
        let args = build_ssh_base_args(&config);
        assert!(args.contains(&"shane@example.com".to_string()));
        assert!(!args.contains(&"-p".to_string()));
    }

    #[test]
    fn test_build_scp_base_args_custom_port() {
        let config = RemoteConfig {
            host: "example.com".to_string(),
            user: "shane".to_string(),
            port: 2222,
            identity_file: None,
            remote_sc_path: None,
            remote_project_path: None,
            remote_db_path: None,
        };
        let args = build_scp_base_args(&config);
        assert!(args.contains(&"-P".to_string())); // uppercase for SCP
        assert!(args.contains(&"2222".to_string()));
        // SCP base args should NOT include user@host
        assert!(!args.contains(&"shane@example.com".to_string()));
    }
}
