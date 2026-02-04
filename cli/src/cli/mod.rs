//! CLI definitions using clap.

use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

/// Output format for list/query commands.
#[derive(ValueEnum, Clone, Debug, Default, PartialEq, Eq)]
pub enum OutputFormat {
    /// Human-readable table (default)
    #[default]
    Table,
    /// JSON (same as --json)
    Json,
    /// Comma-separated values
    Csv,
}

pub mod commands;

/// SaveContext CLI - The OS for AI coding agents
#[derive(Parser, Debug)]
#[command(name = "sc", author, version, about, long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// Database path (default: ~/.savecontext/data/savecontext.db)
    #[arg(long, global = true, env = "SC_DB")]
    pub db: Option<PathBuf>,

    /// Actor name for audit trail
    #[arg(long, global = true, env = "SC_ACTOR")]
    pub actor: Option<String>,

    /// Active session ID (passed by MCP server)
    #[arg(long, global = true, env = "SC_SESSION")]
    pub session: Option<String>,

    /// Output as JSON (for agent integration)
    #[arg(long, alias = "robot", global = true)]
    pub json: bool,

    /// Output format (table, json, csv)
    #[arg(long, value_enum, global = true, default_value_t)]
    pub format: OutputFormat,

    /// Output only the ID/key (for agent scripting)
    #[arg(long, global = true)]
    pub silent: bool,

    /// Preview changes without writing to the database
    #[arg(long, global = true)]
    pub dry_run: bool,

    /// Increase logging verbosity (-v, -vv)
    #[arg(short, long, action = clap::ArgAction::Count, global = true)]
    pub verbose: u8,

    /// Quiet mode (no output except errors)
    #[arg(short, long, global = true)]
    pub quiet: bool,

    /// Disable colored output
    #[arg(long, global = true)]
    pub no_color: bool,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Initialize a SaveContext workspace
    Init {
        /// Use global location (~/.savecontext/)
        #[arg(long)]
        global: bool,

        /// Overwrite existing database
        #[arg(long)]
        force: bool,
    },

    /// Print version information
    Version,

    /// Session management
    Session {
        #[command(subcommand)]
        command: SessionCommands,
    },

    /// Show current session status
    Status,

    /// Save a context item
    Save(SaveArgs),

    /// Get/search context items
    Get(GetArgs),

    /// Delete a context item
    Delete {
        /// Key of the item to delete
        key: String,
    },

    /// Update a context item
    Update(UpdateArgs),

    /// Tag context items
    Tag {
        #[command(subcommand)]
        command: TagCommands,
    },

    /// Issue management
    Issue {
        #[command(subcommand)]
        command: IssueCommands,
    },

    /// Checkpoint management
    Checkpoint {
        #[command(subcommand)]
        command: CheckpointCommands,
    },

    /// Project memory (persistent across sessions)
    Memory {
        #[command(subcommand)]
        command: MemoryCommands,
    },

    /// Sync with JSONL files
    Sync {
        #[command(subcommand)]
        command: SyncCommands,
    },

    /// Project management
    Project {
        #[command(subcommand)]
        command: ProjectCommands,
    },

    /// Plan management (PRDs, specs, feature docs)
    Plan {
        #[command(subcommand)]
        command: PlanCommands,
    },

    /// Prepare context for compaction (auto-checkpoint + summary)
    Compaction,

    /// Generate context primer for agent injection
    Prime {
        /// Include Claude Code transcript summaries
        #[arg(long)]
        transcript: bool,

        /// Maximum transcript entries to include
        #[arg(long, default_value = "5")]
        transcript_limit: usize,

        /// Compact output for agent system prompt injection
        #[arg(long)]
        compact: bool,
    },

    /// Generate shell completions
    Completions {
        /// Shell to generate completions for
        #[arg(value_enum)]
        shell: Shell,
    },

    /// Embedding configuration and management
    Embeddings {
        #[command(subcommand)]
        command: EmbeddingsCommands,
    },
}

/// Supported shells for completions.
#[derive(clap::ValueEnum, Clone, Debug)]
pub enum Shell {
    Bash,
    Zsh,
    Fish,
    PowerShell,
    Elvish,
}

// ============================================================================
// Session Commands
// ============================================================================

#[derive(Subcommand, Debug)]
pub enum SessionCommands {
    /// Start a new session
    Start {
        /// Session name
        name: String,

        /// Session description
        #[arg(short, long)]
        description: Option<String>,

        /// Project path (defaults to current directory)
        #[arg(short, long)]
        project: Option<String>,

        /// Channel name (auto-derived from git branch if not provided)
        #[arg(long)]
        channel: Option<String>,

        /// Force create a new session instead of resuming existing one
        #[arg(long)]
        force_new: bool,
    },

    /// End current session
    End,

    /// Pause current session
    Pause,

    /// Resume a paused session
    Resume {
        /// Session ID to resume
        id: String,
    },

    /// List sessions
    List {
        /// Filter by status (active, paused, completed, all)
        #[arg(short, long, default_value = "active")]
        status: String,

        /// Maximum sessions to return
        #[arg(short, long, default_value = "10")]
        limit: usize,

        /// Search sessions by name or description
        #[arg(long)]
        search: Option<String>,

        /// Filter by project path
        #[arg(short, long)]
        project: Option<String>,

        /// Show sessions from all projects (ignore project filter)
        #[arg(long)]
        all_projects: bool,

        /// Include completed sessions (when status is not 'all' or 'completed')
        #[arg(long)]
        include_completed: bool,
    },

    /// Switch to a different session
    Switch {
        /// Session ID to switch to
        id: String,
    },

    /// Rename current session
    Rename {
        /// New session name
        name: String,
    },

    /// Delete a session permanently
    Delete {
        /// Session ID
        id: String,

        /// Skip confirmation and delete
        #[arg(short, long)]
        force: bool,
    },

    /// Add a project path to a session
    AddPath {
        /// Session ID (uses current active session if not specified)
        #[arg(short, long)]
        id: Option<String>,

        /// Project path to add (defaults to current directory)
        path: Option<String>,
    },

    /// Remove a project path from a session
    RemovePath {
        /// Session ID (uses current active session if not specified)
        #[arg(short, long)]
        id: Option<String>,

        /// Project path to remove
        path: String,
    },
}

// ============================================================================
// Context Item Commands (Save/Get)
// ============================================================================

#[derive(Args, Debug)]
pub struct SaveArgs {
    /// Unique key for this context item
    pub key: String,

    /// Value to save
    pub value: String,

    /// Category (reminder, decision, progress, note)
    #[arg(short, long, default_value = "note")]
    pub category: String,

    /// Priority (high, normal, low)
    #[arg(short, long, default_value = "normal")]
    pub priority: String,
}

#[derive(Args, Debug, Default)]
pub struct GetArgs {
    /// Search query (keyword search)
    #[arg(short = 's', long)]
    pub query: Option<String>,

    /// Get by exact key
    #[arg(short, long)]
    pub key: Option<String>,

    /// Filter by category
    #[arg(short, long)]
    pub category: Option<String>,

    /// Filter by priority
    #[arg(short = 'P', long)]
    pub priority: Option<String>,

    /// Search across all sessions (not just current)
    #[arg(long)]
    pub search_all_sessions: bool,

    /// Semantic search threshold (0.0-1.0, lower = more results)
    #[arg(long)]
    pub threshold: Option<f64>,

    /// Semantic search mode (fast, quality, tiered)
    ///
    /// - fast: Instant results using Model2Vec (lower accuracy)
    /// - quality: Slower but more accurate results using Ollama/HuggingFace
    /// - tiered: Fast candidates, quality re-ranking (default)
    #[arg(long, value_parser = parse_search_mode)]
    pub search_mode: Option<crate::embeddings::SearchMode>,

    /// Pagination offset
    #[arg(long)]
    pub offset: Option<usize>,

    /// Maximum items to return
    #[arg(short, long, default_value = "50")]
    pub limit: usize,
}

/// Parse search mode from string
fn parse_search_mode(s: &str) -> std::result::Result<crate::embeddings::SearchMode, String> {
    s.parse()
}

#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// Key of the item to update
    pub key: String,

    /// New value
    #[arg(long)]
    pub value: Option<String>,

    /// New category (reminder, decision, progress, note)
    #[arg(short, long)]
    pub category: Option<String>,

    /// New priority (high, normal, low)
    #[arg(short, long)]
    pub priority: Option<String>,

    /// New channel
    #[arg(long)]
    pub channel: Option<String>,
}

#[derive(Subcommand, Debug)]
pub enum TagCommands {
    /// Add tags to context items
    Add {
        /// Key of the item to tag
        key: String,

        /// Tags to add (comma-separated or multiple --tag flags)
        #[arg(short, long, value_delimiter = ',', required = true)]
        tags: Vec<String>,
    },

    /// Remove tags from context items
    Remove {
        /// Key of the item to untag
        key: String,

        /// Tags to remove (comma-separated or multiple --tag flags)
        #[arg(short, long, value_delimiter = ',', required = true)]
        tags: Vec<String>,
    },
}

// ============================================================================
// Issue Commands
// ============================================================================

#[derive(Subcommand, Debug)]
pub enum IssueCommands {
    /// Create a new issue
    Create(IssueCreateArgs),

    /// List issues
    List(IssueListArgs),

    /// Show issue details
    Show {
        /// Issue ID (short or full)
        id: String,
    },

    /// Update an issue
    Update(IssueUpdateArgs),

    /// Mark issue(s) as complete
    Complete {
        /// Issue IDs (one or more)
        ids: Vec<String>,
    },

    /// Claim issue(s) (assign to self)
    Claim {
        /// Issue IDs (one or more)
        ids: Vec<String>,
    },

    /// Release issue(s)
    Release {
        /// Issue IDs (one or more)
        ids: Vec<String>,
    },

    /// Delete issue(s)
    Delete {
        /// Issue IDs (one or more)
        ids: Vec<String>,
    },

    /// Manage issue labels
    Label {
        #[command(subcommand)]
        command: IssueLabelCommands,
    },

    /// Manage issue dependencies
    Dep {
        #[command(subcommand)]
        command: IssueDepCommands,
    },

    /// Clone an issue
    Clone {
        /// Issue ID to clone
        id: String,

        /// New title (defaults to "Copy of <original>")
        #[arg(short, long)]
        title: Option<String>,
    },

    /// Mark issue as duplicate of another
    Duplicate {
        /// Issue ID to mark as duplicate
        id: String,

        /// Issue ID this is a duplicate of
        #[arg(long)]
        of: String,
    },

    /// List issues ready to work on
    Ready {
        /// Maximum issues to return
        #[arg(short, long, default_value = "10")]
        limit: usize,
    },

    /// Get next block of issues and claim them
    NextBlock {
        /// Number of issues to claim
        #[arg(short, long, default_value = "3")]
        count: usize,
    },

    /// Create multiple issues at once with dependencies
    Batch {
        /// JSON input containing issues array, dependencies, and optional planId
        #[arg(long)]
        json_input: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum IssueLabelCommands {
    /// Add labels to an issue
    Add {
        /// Issue ID
        id: String,

        /// Labels to add (comma-separated)
        #[arg(short, long, value_delimiter = ',', required = true)]
        labels: Vec<String>,
    },

    /// Remove labels from an issue
    Remove {
        /// Issue ID
        id: String,

        /// Labels to remove (comma-separated)
        #[arg(short, long, value_delimiter = ',', required = true)]
        labels: Vec<String>,
    },
}

#[derive(Subcommand, Debug)]
pub enum IssueDepCommands {
    /// Add a dependency to an issue
    Add {
        /// Issue ID
        id: String,

        /// ID of issue this depends on
        #[arg(long)]
        depends_on: String,

        /// Dependency type (blocks, related, parent-child, discovered-from)
        #[arg(short = 't', long, default_value = "blocks")]
        dep_type: String,
    },

    /// Remove a dependency from an issue
    Remove {
        /// Issue ID
        id: String,

        /// ID of issue to remove dependency on
        #[arg(long)]
        depends_on: String,
    },
}

#[derive(Args, Debug)]
pub struct IssueCreateArgs {
    /// Issue title
    pub title: String,

    /// Issue description
    #[arg(short, long)]
    pub description: Option<String>,

    /// Implementation details or notes
    #[arg(long)]
    pub details: Option<String>,

    /// Issue type (task, bug, feature, epic, chore)
    #[arg(short = 't', long, default_value = "task")]
    pub issue_type: String,

    /// Priority (0=lowest to 4=critical)
    #[arg(short, long, default_value = "2")]
    pub priority: i32,

    /// Parent issue ID (for subtasks)
    #[arg(long)]
    pub parent: Option<String>,

    /// Link issue to a Plan (PRD/spec)
    #[arg(long)]
    pub plan_id: Option<String>,

    /// Labels (-l bug -l security or -l bug,security)
    #[arg(short, long, value_delimiter = ',')]
    pub labels: Option<Vec<String>>,

    /// Import issues from a JSONL file (one JSON object per line)
    #[arg(short, long)]
    pub file: Option<PathBuf>,
}

#[derive(Args, Debug, Default)]
pub struct IssueListArgs {
    /// Filter by specific issue ID (short or full)
    #[arg(long)]
    pub id: Option<String>,

    /// Filter by status (backlog, open, in_progress, blocked, closed, deferred, all)
    #[arg(short, long, default_value = "open")]
    pub status: String,

    /// Filter by exact priority (0-4)
    #[arg(short, long)]
    pub priority: Option<i32>,

    /// Filter by minimum priority
    #[arg(long)]
    pub priority_min: Option<i32>,

    /// Filter by maximum priority
    #[arg(long)]
    pub priority_max: Option<i32>,

    /// Filter by type
    #[arg(short = 't', long)]
    pub issue_type: Option<String>,

    /// Filter by labels (all must match, comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub labels: Option<Vec<String>>,

    /// Filter by labels (any must match, comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub labels_any: Option<Vec<String>>,

    /// Filter by parent issue ID
    #[arg(long)]
    pub parent: Option<String>,

    /// Filter by plan ID
    #[arg(long)]
    pub plan: Option<String>,

    /// Filter issues with subtasks
    #[arg(long)]
    pub has_subtasks: bool,

    /// Filter issues without subtasks
    #[arg(long)]
    pub no_subtasks: bool,

    /// Filter issues with dependencies
    #[arg(long)]
    pub has_deps: bool,

    /// Filter issues without dependencies
    #[arg(long)]
    pub no_deps: bool,

    /// Sort by field (priority, createdAt, updatedAt)
    #[arg(long, default_value = "createdAt")]
    pub sort: String,

    /// Sort order (asc, desc)
    #[arg(long, default_value = "desc")]
    pub order: String,

    /// Filter by issues created in last N days
    #[arg(long)]
    pub created_days: Option<i64>,

    /// Filter by issues created in last N hours
    #[arg(long)]
    pub created_hours: Option<i64>,

    /// Filter by issues updated in last N days
    #[arg(long)]
    pub updated_days: Option<i64>,

    /// Filter by issues updated in last N hours
    #[arg(long)]
    pub updated_hours: Option<i64>,

    /// Search in title/description
    #[arg(long)]
    pub search: Option<String>,

    /// Filter by assignee
    #[arg(long)]
    pub assignee: Option<String>,

    /// Search across all projects
    #[arg(long)]
    pub all_projects: bool,

    /// Maximum issues to return
    #[arg(short, long, default_value = "50")]
    pub limit: usize,
}

#[derive(Args, Debug)]
pub struct IssueUpdateArgs {
    /// Issue ID
    pub id: String,

    /// New title
    #[arg(long)]
    pub title: Option<String>,

    /// New description
    #[arg(short, long)]
    pub description: Option<String>,

    /// New details
    #[arg(long)]
    pub details: Option<String>,

    /// New status
    #[arg(short, long)]
    pub status: Option<String>,

    /// New priority
    #[arg(short, long)]
    pub priority: Option<i32>,

    /// New type
    #[arg(short = 't', long)]
    pub issue_type: Option<String>,

    /// New parent issue ID
    #[arg(long)]
    pub parent: Option<String>,

    /// New plan ID
    #[arg(long)]
    pub plan: Option<String>,
}

// ============================================================================
// Checkpoint Commands
// ============================================================================

#[derive(Subcommand, Debug)]
pub enum CheckpointCommands {
    /// Create a checkpoint
    Create {
        /// Checkpoint name
        name: String,

        /// Description
        #[arg(short, long)]
        description: Option<String>,

        /// Include git status
        #[arg(long)]
        include_git: bool,
    },

    /// List checkpoints
    List {
        /// Search checkpoints by name or description
        #[arg(short, long)]
        search: Option<String>,

        /// Filter by session ID
        #[arg(long)]
        session: Option<String>,

        /// Filter by project path
        #[arg(long)]
        project: Option<String>,

        /// Include checkpoints from all projects
        #[arg(long)]
        all_projects: bool,

        /// Maximum checkpoints to return
        #[arg(short, long, default_value = "20")]
        limit: usize,

        /// Pagination offset
        #[arg(long)]
        offset: Option<usize>,
    },

    /// Show checkpoint details
    Show {
        /// Checkpoint ID
        id: String,
    },

    /// Restore from checkpoint
    Restore {
        /// Checkpoint ID
        id: String,

        /// Only restore items in these categories (comma-separated)
        #[arg(long, value_delimiter = ',')]
        categories: Option<Vec<String>>,

        /// Only restore items with these tags (comma-separated)
        #[arg(long, value_delimiter = ',')]
        tags: Option<Vec<String>>,
    },

    /// Delete a checkpoint
    Delete {
        /// Checkpoint ID
        id: String,
    },

    /// Add items to an existing checkpoint
    AddItems {
        /// Checkpoint ID
        id: String,

        /// Context item keys to add (comma-separated)
        #[arg(short, long, value_delimiter = ',', required = true)]
        keys: Vec<String>,
    },

    /// Remove items from a checkpoint
    RemoveItems {
        /// Checkpoint ID
        id: String,

        /// Context item keys to remove (comma-separated)
        #[arg(short, long, value_delimiter = ',', required = true)]
        keys: Vec<String>,
    },

    /// List items in a checkpoint
    Items {
        /// Checkpoint ID
        id: String,
    },
}

// ============================================================================
// Memory Commands (Project-level persistent storage)
// ============================================================================

#[derive(Subcommand, Debug)]
pub enum MemoryCommands {
    /// Save a memory item
    Save {
        /// Key
        key: String,

        /// Value
        value: String,

        /// Category (command, config, note)
        #[arg(short, long, default_value = "command")]
        category: String,
    },

    /// Get a memory item
    Get {
        /// Key
        key: String,
    },

    /// List memory items
    List {
        /// Filter by category
        #[arg(short, long)]
        category: Option<String>,
    },

    /// Delete a memory item
    Delete {
        /// Key
        key: String,
    },
}

// ============================================================================
// Sync Commands
// ============================================================================

#[derive(Subcommand, Debug)]
pub enum SyncCommands {
    /// Export to JSONL
    Export {
        /// Force export even if JSONL is newer
        #[arg(long)]
        force: bool,
    },

    /// Import from JSONL
    Import {
        /// Force import even with conflicts
        #[arg(long)]
        force: bool,
    },

    /// Show sync status
    Status,
}

// ============================================================================
// Project Commands
// ============================================================================

#[derive(Subcommand, Debug)]
pub enum ProjectCommands {
    /// Create a new project
    Create(ProjectCreateArgs),

    /// List all projects
    List {
        /// Include session count for each project
        #[arg(long)]
        session_count: bool,

        /// Maximum projects to return
        #[arg(short, long, default_value = "50")]
        limit: usize,
    },

    /// Show project details
    Show {
        /// Project ID or path
        id: String,
    },

    /// Update a project
    Update(ProjectUpdateArgs),

    /// Delete a project
    Delete {
        /// Project ID or path
        id: String,

        /// Skip confirmation and delete
        #[arg(short, long)]
        force: bool,
    },
}

#[derive(Args, Debug)]
pub struct ProjectCreateArgs {
    /// Project path (defaults to current directory)
    pub path: Option<String>,

    /// Project name (defaults to directory name)
    #[arg(short, long)]
    pub name: Option<String>,

    /// Project description
    #[arg(short, long)]
    pub description: Option<String>,

    /// Issue ID prefix (e.g., "SC" creates SC-1, SC-2)
    #[arg(short = 'p', long)]
    pub issue_prefix: Option<String>,
}

#[derive(Args, Debug)]
pub struct ProjectUpdateArgs {
    /// Project ID or path
    pub id: String,

    /// New project name
    #[arg(short, long)]
    pub name: Option<String>,

    /// New description
    #[arg(short, long)]
    pub description: Option<String>,

    /// New issue ID prefix
    #[arg(short = 'p', long)]
    pub issue_prefix: Option<String>,
}

// ============================================================================
// Plan Commands
// ============================================================================

#[derive(Subcommand, Debug)]
pub enum PlanCommands {
    /// Create a new plan
    Create(PlanCreateArgs),

    /// List plans
    List {
        /// Filter by status (draft, active, completed, all)
        #[arg(short, long, default_value = "active")]
        status: String,

        /// Maximum plans to return
        #[arg(short, long, default_value = "50")]
        limit: usize,
    },

    /// Show plan details
    Show {
        /// Plan ID
        id: String,
    },

    /// Update a plan
    Update(PlanUpdateArgs),
}

#[derive(Args, Debug)]
pub struct PlanCreateArgs {
    /// Plan title
    pub title: String,

    /// Plan content (markdown PRD/spec)
    #[arg(short, long)]
    pub content: Option<String>,

    /// Plan status (draft, active, completed)
    #[arg(short, long, default_value = "active")]
    pub status: String,

    /// Success criteria
    #[arg(long)]
    pub success_criteria: Option<String>,
}

#[derive(Args, Debug)]
pub struct PlanUpdateArgs {
    /// Plan ID
    pub id: String,

    /// New title
    #[arg(long)]
    pub title: Option<String>,

    /// New content
    #[arg(short, long)]
    pub content: Option<String>,

    /// New status (draft, active, completed)
    #[arg(short, long)]
    pub status: Option<String>,

    /// New success criteria
    #[arg(long)]
    pub success_criteria: Option<String>,
}

// ============================================================================
// Embeddings Commands
// ============================================================================

#[derive(Subcommand, Debug, Clone)]
pub enum EmbeddingsCommands {
    /// Show embeddings status and configuration
    Status,

    /// Configure embedding provider
    Configure {
        /// Provider (ollama, huggingface)
        #[arg(short, long)]
        provider: Option<String>,

        /// Enable embeddings
        #[arg(long)]
        enable: bool,

        /// Disable embeddings
        #[arg(long)]
        disable: bool,

        /// Model to use (provider-specific)
        #[arg(short, long)]
        model: Option<String>,

        /// API endpoint (for custom servers)
        #[arg(long)]
        endpoint: Option<String>,

        /// API token (for HuggingFace)
        #[arg(long)]
        token: Option<String>,
    },

    /// Backfill embeddings for existing context items
    Backfill {
        /// Maximum items to process
        #[arg(short, long)]
        limit: Option<usize>,

        /// Session ID to backfill (defaults to current)
        #[arg(short, long)]
        session: Option<String>,

        /// Force regeneration of existing embeddings
        #[arg(long)]
        force: bool,
    },

    /// Test embedding provider connectivity
    Test {
        /// Text to generate test embedding for
        #[arg(default_value = "Hello world")]
        text: String,
    },

    /// Process pending embeddings in background (internal use)
    #[command(hide = true)]
    ProcessPending {
        /// Maximum items to process
        #[arg(short, long, default_value = "10")]
        limit: usize,

        /// Run silently (no output)
        #[arg(long)]
        quiet: bool,
    },

    /// Upgrade items with fast embeddings to quality embeddings
    ///
    /// Items saved with the 2-tier system get instant fast embeddings (Model2Vec).
    /// This command generates higher-quality embeddings (Ollama/HuggingFace)
    /// for items that only have fast embeddings.
    UpgradeQuality {
        /// Maximum items to process
        #[arg(short, long)]
        limit: Option<usize>,

        /// Session ID to upgrade (defaults to all sessions)
        #[arg(short, long)]
        session: Option<String>,
    },
}
