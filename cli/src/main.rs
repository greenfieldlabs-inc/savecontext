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
fn preprocess_args(args: impl Iterator<Item = String>) -> Vec<String> {
    // Map of --flag names to their positional subcommand contexts.
    // When we see e.g. `sc issue create --title "foo"`, we strip
    // `--title` and leave `"foo"` as the positional arg.
    //
    // Only applies to flags that shadow positional args — named
    // flags like --description already work via clap.
    const POSITIONAL_ALIASES: &[&str] = &[
        "--title",  // issue create, plan create
        "--id",     // issue update/delete/show/complete/claim/release,
                    // project update, plan update, checkpoint restore,
                    // session resume/delete, memory delete/get
        "--key",    // save, update, delete, tag, memory save/delete/get
        "--value",  // save
        "--name",   // session start, session rename
        "--path",   // project create
    ];

    let mut result = Vec::new();
    let mut iter = args.peekable();

    while let Some(arg) = iter.next() {
        if POSITIONAL_ALIASES.contains(&arg.as_str()) {
            // Strip the flag, keep the value
            if let Some(value) = iter.next() {
                result.push(value);
            }
        } else if let Some(flag) = POSITIONAL_ALIASES
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
    let json = cli.json
        || cli.format == OutputFormat::Json
        || !std::io::IsTerminal::is_terminal(&std::io::stdout());

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
            1 => EnvFilter::new("info"),
            2 => EnvFilter::new("debug,rusqlite=info"),
            _ => EnvFilter::new("trace"),
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
        Commands::Prime { transcript, transcript_limit, compact } => {
            commands::prime::execute(cli.db.as_ref(), cli.session.as_deref(), json, *transcript, *transcript_limit, *compact)
        }

        // Shell completions
        Commands::Completions { shell } => commands::completions::execute(shell),

        // Embeddings
        Commands::Embeddings { command } => {
            commands::embeddings::execute(command.clone(), cli.db.as_ref(), json)
        }
    }
}
