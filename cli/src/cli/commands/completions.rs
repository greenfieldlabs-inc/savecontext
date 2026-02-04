//! Shell completions command implementation.

use crate::cli::{Cli, Shell};
use crate::error::Result;
use clap::CommandFactory;
use clap_complete::{generate, shells};
use std::io;

/// Generate shell completions for the specified shell.
pub fn execute(shell: &Shell) -> Result<()> {
    let mut cmd = Cli::command();

    match shell {
        Shell::Bash => generate(shells::Bash, &mut cmd, "sc", &mut io::stdout()),
        Shell::Zsh => generate(shells::Zsh, &mut cmd, "sc", &mut io::stdout()),
        Shell::Fish => generate(shells::Fish, &mut cmd, "sc", &mut io::stdout()),
        Shell::PowerShell => generate(shells::PowerShell, &mut cmd, "sc", &mut io::stdout()),
        Shell::Elvish => generate(shells::Elvish, &mut cmd, "sc", &mut io::stdout()),
    }

    Ok(())
}
