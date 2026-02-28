//! Remote SSH proxy command.
//!
//! Runs sc commands on a remote host via SSH, using the configuration
//! stored by `sc config remote set`.
//!
//! All arguments after `sc remote` are forwarded as-is to the remote sc binary.
//! Each argument is individually shell-quoted to prevent injection.
//! Example: `sc remote status` → `ssh user@host 'sc' 'status' '--json'`

use crate::cli::commands::config::{build_ssh_base_args, load_remote_config, shell_quote};
use crate::error::{Error, Result};
use std::path::PathBuf;
use std::process::Command;
use tracing::debug;

/// Execute a remote command via SSH proxy.
pub fn execute(args: &[String], _db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    if args.is_empty() {
        return Err(Error::InvalidArgument(
            "No command specified. Usage: sc remote <command> [args...]".to_string(),
        ));
    }

    let config = load_remote_config()?;

    // Build the remote sc command with each arg individually quoted
    let sc_path = config.remote_sc_path.as_deref().unwrap_or("sc");
    let mut quoted_parts: Vec<String> = vec![shell_quote(sc_path)];
    for arg in args {
        quoted_parts.push(shell_quote(arg));
    }

    // Always add --json for structured output if not already present
    let has_json_flag = args.iter().any(|a| a == "--json" || a == "--format=json");
    if json && !has_json_flag {
        quoted_parts.push(shell_quote("--json"));
    }

    let remote_cmd = quoted_parts.join(" ");
    debug!(remote_cmd = %remote_cmd, "Executing remote command");

    // Build SSH command using shared helper
    let mut ssh_args = build_ssh_base_args(&config);
    ssh_args.push(remote_cmd);

    debug!(ssh_args = ?ssh_args, "SSH command");

    let output = Command::new("ssh")
        .args(&ssh_args)
        .output()
        .map_err(|e| {
            Error::Remote(format!(
                "Failed to execute ssh: {e}. Is ssh installed and in PATH?"
            ))
        })?;

    // Relay stdout directly
    if !output.stdout.is_empty() {
        print!("{}", String::from_utf8_lossy(&output.stdout));
    }

    // Relay stderr
    if !output.stderr.is_empty() {
        eprint!("{}", String::from_utf8_lossy(&output.stderr));
    }

    if !output.status.success() {
        let code = output.status.code().unwrap_or(1);
        return Err(Error::Remote(format!(
            "Remote command failed with exit code {code}"
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::commands::config::RemoteConfig;

    #[test]
    fn test_build_ssh_base_args_default_port() {
        let config = RemoteConfig {
            host: "example.com".to_string(),
            user: "shane".to_string(),
            port: 22,
            identity_file: None,
            remote_sc_path: Some("sc".to_string()),
            remote_project_path: None,
            remote_db_path: None,
        };

        let args = build_ssh_base_args(&config);
        assert!(args.contains(&"shane@example.com".to_string()));
        assert!(!args.contains(&"-p".to_string()));
    }

    #[test]
    fn test_build_ssh_base_args_custom_port() {
        let config = RemoteConfig {
            host: "example.com".to_string(),
            user: "shane".to_string(),
            port: 2222,
            identity_file: None,
            remote_sc_path: None,
            remote_project_path: None,
            remote_db_path: None,
        };

        let args = build_ssh_base_args(&config);
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"2222".to_string()));
    }

    #[test]
    fn test_build_ssh_base_args_with_identity() {
        let config = RemoteConfig {
            host: "example.com".to_string(),
            user: "shane".to_string(),
            port: 22,
            identity_file: Some("~/.ssh/id_rsa".to_string()),
            remote_sc_path: None,
            remote_project_path: None,
            remote_db_path: None,
        };

        let args = build_ssh_base_args(&config);
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"~/.ssh/id_rsa".to_string()));
    }
}
