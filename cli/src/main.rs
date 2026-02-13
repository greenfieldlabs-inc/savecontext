//! SaveContext CLI entry point.

use clap::Parser;
use sc::cli::commands;
use sc::cli::{Cli, Commands, OutputFormat};
use sc::error::Error;
use std::process::ExitCode;

/// Rewrite named flags to positional args for agent ergonomics.
///
/// Agents (Claude Code, Codex, etc.) naturally generate `--title "foo"`
/// instead of positional `"foo"`. This preprocessor transparently
/// converts known flag patterns so both forms work.
///
/// Context-aware: some flags are positional in one command but named
/// in another (e.g. `--value` is positional in `save` but named in
/// `update`). The preprocessor detects the subcommand first.
fn preprocess_args(args: impl Iterator<Item = String>) -> Vec<String> {
    let raw: Vec<String> = args.collect();
    let subcommand = detect_subcommand(&raw);

    // Aliases safe to strip for ALL commands
    let mut aliases: Vec<&str> = vec![
        "--title",  // issue create, plan create
        "--id",     // issue update/delete/show/complete/claim/release,
                    // project update, plan update, checkpoint restore,
                    // session resume/delete, memory delete/get
        "--name",   // session start, session rename
        "--path",   // project create
    ];

    // --key is positional in: save, update, delete, tag, memory save/delete/get
    // --key is a NAMED flag in: get (GetArgs.key)
    if subcommand.as_deref() != Some("get") {
        aliases.push("--key");
    }

    // --value is positional in: save, memory save
    // --value is a NAMED flag in: update (UpdateArgs.value)
    if subcommand.as_deref() != Some("update") {
        aliases.push("--value");
    }

    let mut result = Vec::new();
    let mut iter = raw.into_iter().peekable();

    while let Some(arg) = iter.next() {
        if aliases.contains(&arg.as_str()) {
            // Strip the flag, keep the value
            if let Some(value) = iter.next() {
                result.push(value);
            }
        } else if let Some(flag) = aliases
            .iter()
            .find(|f| arg.starts_with(&format!("{}=", f)))
        {
            // Handle --flag=value form
            let value = arg[flag.len() + 1..].to_string();
            result.push(value);
        } else {
            result.push(arg);
        }
    }

    result
}

/// Detect the primary subcommand from the arg list.
///
/// Scans for the first known subcommand token after the binary name.
/// Used by `preprocess_args` to apply context-aware alias stripping.
fn detect_subcommand(args: &[String]) -> Option<String> {
    const SUBCOMMANDS: &[&str] = &[
        "save", "get", "update", "delete", "tag",
        "session", "status", "issue", "checkpoint", "memory",
        "sync", "project", "plan", "compaction", "prime",
        "init", "version", "completions", "embeddings",
    ];

    args.iter()
        .skip(1) // skip binary name
        .find(|a| SUBCOMMANDS.contains(&a.as_str()))
        .cloned()
}

fn main() -> ExitCode {
    let args = preprocess_args(std::env::args());
    let cli = Cli::parse_from(args);

    if cli.silent {
        sc::SILENT.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    if cli.dry_run {
        sc::DRY_RUN.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    if cli.format == OutputFormat::Csv {
        sc::CSV_OUTPUT.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    // Set up tracing based on verbosity
    init_tracing(cli.verbose, cli.quiet);

    // Resolve effective JSON mode: --json OR --format json OR non-TTY stdout
    // When --format csv is explicit, don't override with auto-JSON
    let json = cli.json
        || cli.format == OutputFormat::Json
        || (cli.format != OutputFormat::Csv
            && !std::io::IsTerminal::is_terminal(&std::io::stdout()));

    // Run the command and handle errors
    match run(&cli, json) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            if json {
                eprintln!("{}", e.to_structured_json());
            } else if !cli.quiet {
                if let Some(hint) = e.hint() {
                    eprintln!("Error: {e}\n  Hint: {hint}");
                } else {
                    eprintln!("Error: {e}");
                }
            }
            ExitCode::from(e.exit_code())
        }
    }
}

fn init_tracing(verbose: u8, quiet: bool) {
    use tracing_subscriber::EnvFilter;

    if quiet {
        return;
    }

    // Honor RUST_LOG if set, otherwise use verbosity flag
    let filter = if std::env::var("RUST_LOG").is_ok() {
        EnvFilter::from_default_env()
    } else {
        match verbose {
            0 => EnvFilter::new("warn"),
            1 => EnvFilter::new("sc=info"),
            2 => EnvFilter::new("sc=debug"),
            _ => EnvFilter::new("sc=trace"),
        }
    };

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .without_time()
        .init();
}

fn run(cli: &Cli, json: bool) -> Result<(), Error> {
    match &cli.command {
        Commands::Init { global, force } => {
            commands::init::execute(*global, *force, json)
        }
        Commands::Version => commands::version::execute(json),

        // Session commands
        Commands::Session { command } => {
            commands::session::execute(command, cli.db.as_ref(), cli.actor.as_deref(), cli.session.as_deref(), json)
        }

        // Status
        Commands::Status => commands::status::execute(cli.db.as_ref(), cli.session.as_deref(), json),

        // Context items
        Commands::Save(args) => {
            commands::context::execute_save(args, cli.db.as_ref(), cli.actor.as_deref(), cli.session.as_deref(), json)
        }
        Commands::Get(args) => {
            commands::context::execute_get(args, cli.db.as_ref(), cli.session.as_deref(), json)
        }
        Commands::Delete { key } => {
            commands::context::execute_delete(key, cli.db.as_ref(), cli.actor.as_deref(), cli.session.as_deref(), json)
        }
        Commands::Update(args) => {
            commands::context::execute_update(args, cli.db.as_ref(), cli.actor.as_deref(), cli.session.as_deref(), json)
        }
        Commands::Tag { command } => {
            commands::context::execute_tag(command, cli.db.as_ref(), cli.actor.as_deref(), cli.session.as_deref(), json)
        }

        // Issues
        Commands::Issue { command } => {
            commands::issue::execute(command, cli.db.as_ref(), cli.actor.as_deref(), json)
        }

        // Checkpoints
        Commands::Checkpoint { command } => {
            commands::checkpoint::execute(command, cli.db.as_ref(), cli.actor.as_deref(), cli.session.as_deref(), json)
        }

        // Memory
        Commands::Memory { command } => {
            commands::memory::execute(command, cli.db.as_ref(), cli.actor.as_deref(), json)
        }

        // Sync
        Commands::Sync { command } => commands::sync::execute(command, cli.db.as_ref(), json),

        // Project
        Commands::Project { command } => {
            commands::project::execute(command, cli.db.as_ref(), cli.actor.as_deref(), json)
        }

        // Plan
        Commands::Plan { command } => {
            commands::plan::execute(command, cli.db.as_ref(), cli.actor.as_deref(), json)
        }

        // Compaction
        Commands::Compaction => {
            commands::compaction::execute(cli.db.as_ref(), cli.actor.as_deref(), cli.session.as_deref(), json)
        }

        // Prime (read-only context aggregation for agent injection)
        Commands::Prime { transcript, transcript_limit, compact, smart, budget, query, decay_days } => {
            commands::prime::execute(
                cli.db.as_ref(),
                cli.session.as_deref(),
                json,
                *transcript,
                *transcript_limit,
                *compact,
                *smart,
                *budget,
                query.as_deref(),
                *decay_days,
            )
        }

        // Shell completions
        Commands::Completions { shell } => commands::completions::execute(shell),

        // Embeddings
        Commands::Embeddings { command } => {
            commands::embeddings::execute(command.clone(), cli.db.as_ref(), json)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pp(args: &[&str]) -> Vec<String> {
        preprocess_args(args.iter().map(|s| s.to_string()))
    }

    #[test]
    fn test_save_strips_value_flag() {
        // --value is positional for save, so strip the flag name
        assert_eq!(
            pp(&["sc", "save", "my-key", "--value", "hello world"]),
            vec!["sc", "save", "my-key", "hello world"]
        );
    }

    #[test]
    fn test_save_strips_key_flag() {
        assert_eq!(
            pp(&["sc", "save", "--key", "my-key", "some value"]),
            vec!["sc", "save", "my-key", "some value"]
        );
    }

    #[test]
    fn test_update_preserves_value_flag() {
        // --value is a named flag for update, must NOT be stripped
        assert_eq!(
            pp(&["sc", "update", "my-key", "--value", "new content"]),
            vec!["sc", "update", "my-key", "--value", "new content"]
        );
    }

    #[test]
    fn test_update_strips_key_flag() {
        // --key IS positional for update, so strip it
        assert_eq!(
            pp(&["sc", "update", "--key", "my-key", "--value", "new content"]),
            vec!["sc", "update", "my-key", "--value", "new content"]
        );
    }

    #[test]
    fn test_get_preserves_key_flag() {
        // --key is a named flag for get, must NOT be stripped
        assert_eq!(
            pp(&["sc", "get", "--key", "my-key"]),
            vec!["sc", "get", "--key", "my-key"]
        );
    }

    #[test]
    fn test_issue_create_strips_title() {
        assert_eq!(
            pp(&["sc", "issue", "create", "--title", "Bug report"]),
            vec!["sc", "issue", "create", "Bug report"]
        );
    }

    #[test]
    fn test_equals_form() {
        assert_eq!(
            pp(&["sc", "save", "--key=my-key", "--value=hello"]),
            vec!["sc", "save", "my-key", "hello"]
        );
    }

    #[test]
    fn test_global_flags_preserved() {
        assert_eq!(
            pp(&["sc", "--json", "save", "--key", "k", "--value", "v"]),
            vec!["sc", "--json", "save", "k", "v"]
        );
    }

    #[test]
    fn test_detect_subcommand_basic() {
        let args: Vec<String> = vec!["sc", "save", "key", "val"]
            .into_iter().map(String::from).collect();
        assert_eq!(detect_subcommand(&args), Some("save".to_string()));
    }

    #[test]
    fn test_detect_subcommand_with_flags() {
        let args: Vec<String> = vec!["sc", "--json", "--db", "/tmp/db", "update", "key"]
            .into_iter().map(String::from).collect();
        assert_eq!(detect_subcommand(&args), Some("update".to_string()));
    }
}
