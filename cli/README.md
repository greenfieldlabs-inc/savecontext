# SaveContext CLI (`sc`)

The Rust-native command-line interface for SaveContext. This CLI is the primary implementation, with the MCP server delegating operations to it via a bridge pattern.

## Installation

### From Source (Development)

```bash
cd cli
cargo build --release
# Binary at target/release/sc
```

### Add to PATH

```bash
# Option 1: Symlink to a directory in PATH
ln -sf "$(pwd)/target/release/sc" /usr/local/bin/sc

# Option 2: Add to shell profile
export PATH="$PATH:/path/to/savecontext/cli/target/release"
```

## Architecture

```
AI Coding Tools (Claude Code, Cursor, Cline, etc.)
                    │
                    ▼
    ┌───────────────────────────────────────────┐
    │  MCP Server (TypeScript)                  │
    │  @savecontext/mcp                         │
    │               │                           │
    │               ▼                           │
    │  ┌─────────────────────────────────────┐  │
    │  │  CLI Bridge                         │  │
    │  │  server/src/cli/bridge.ts           │  │
    │  │  Delegates to Rust CLI              │  │
    │  └─────────────────────────────────────┘  │
    └───────────────────┬───────────────────────┘
                        │
                        ▼
    ┌───────────────────────────────────────────┐
    │  Rust CLI (`sc`)                          │
    │  45+ commands for sessions, issues,       │
    │  context, memory, plans, checkpoints      │
    │  Background embedding generation          │
    └───────────────────┬───────────────────────┘
                        │
                        ▼
    ┌───────────────────────────────────────────┐
    │  SQLite Database                          │
    │  ~/.savecontext/data/savecontext.db       │
    └───────────────────────────────────────────┘
```

The MCP server acts as a thin transport layer that receives tool calls from AI coding assistants and delegates them to the Rust CLI. This architecture provides:

- **Single source of truth**: All business logic lives in Rust
- **Direct CLI access**: Power users can use `sc` directly from terminal
- **Background processing**: Embedding generation happens asynchronously after save
- **Performance**: Native Rust execution for database operations

## Quick Reference

### Global Flags

```bash
--db <path>       # Custom database path (default: ~/.savecontext/data/savecontext.db)
--actor <name>    # Actor name for audit trail
--session <id>    # Active session ID
--json            # Output as JSON
--format <fmt>    # Output format: json, csv, table (default: table)
--silent          # Minimal output (IDs only for create/mutate)
--dry-run         # Preview mutations without writing
-v, -vv, -vvv    # Increase verbosity (info, debug, trace)
-q, --quiet       # Quiet mode
--no-color        # Disable colored output
```

### Commands

#### Session Management
```bash
sc session start "Feature work" -d "Description"   # Start a session
sc session list                                     # List sessions
sc session list --status all                        # Include completed
sc session pause                                    # Pause current session
sc session resume <id>                              # Resume a session
sc session end                                      # End current session
sc session rename "New name"                        # Rename session
sc session delete <id>                              # Delete session
sc session add-path /path/to/project                # Add path to session
sc session remove-path /path/to/project             # Remove path from session
```

#### Context Items
```bash
sc save auth-decision "Using JWT tokens" -c decision -p high
sc get --query "authentication"                     # Semantic search
sc get --key auth-decision                          # Get by key
sc get --category decision                          # Filter by category
sc update auth-decision --value "Updated reasoning"
sc delete auth-decision
sc tag add auth-decision -t important,security
sc tag remove auth-decision -t security
```

#### Issues
```bash
sc issue create "Fix login bug" -t bug -p 3         # Create issue
sc issue list                                       # List open issues
sc issue list --status all                          # Include closed
sc issue show SC-a1b2                               # Show details
sc issue update SC-a1b2 --status in_progress        # Update
sc issue complete SC-a1b2                           # Mark done
sc issue claim SC-a1b2                              # Assign to self
sc issue release SC-a1b2                            # Unassign
sc issue clone SC-a1b2                              # Clone issue
sc issue duplicate SC-a1b2 --of SC-c3d4             # Mark as duplicate
sc issue ready                                      # List ready issues
sc issue next-block -c 3                            # Claim next batch
sc issue label add SC-a1b2 -l frontend,urgent
sc issue dep add SC-a1b2 --depends-on SC-c3d4
```

#### Checkpoints
```bash
sc checkpoint create "pre-refactor" --include-git
sc checkpoint list
sc checkpoint show <id>
sc checkpoint restore <id>
sc checkpoint delete <id>
sc checkpoint add-items <id> -k key1,key2
sc checkpoint remove-items <id> -k key1
```

#### Memory (Persistent Across Sessions)
```bash
sc memory save test-cmd "npm test" -c command
sc memory get test-cmd
sc memory list
sc memory list -c config
sc memory delete test-cmd
```

#### Projects
```bash
sc project create /path/to/project -n "My Project"
sc project list
sc project show <id>
sc project update <id> --name "New Name"
sc project delete <id>
```

#### Plans
```bash
sc plan create "Q1 Features" -c "## Goals\n- Feature 1\n- Feature 2"
sc plan list
sc plan show <id>
sc plan update <id> --status completed
```

#### Embeddings
```bash
sc embeddings status                                # Check config
sc embeddings configure --provider ollama --enable
sc embeddings configure --provider huggingface --token <token>
sc embeddings backfill                              # Generate for existing items
sc embeddings test "Hello world"                    # Test connectivity
```

#### Sync (JSONL Export/Import)
```bash
sc sync status
sc sync export
sc sync import
```

#### Other
```bash
sc init --global                                    # Initialize database
sc status                                           # Show session status
sc compaction                                       # Prepare for compaction
sc completions bash > ~/.bash_completion.d/sc      # Shell completions
sc version
```

## Embedding Configuration

The CLI supports background embedding generation for semantic search. Configure via environment variables or the `embeddings configure` command:

### Ollama (Recommended for Local)

```bash
# Uses nomic-embed-text by default
sc embeddings configure --provider ollama --enable

# Or with custom model
sc embeddings configure --provider ollama --model mxbai-embed-large --enable
```

### HuggingFace (Cloud API)

```bash
sc embeddings configure --provider huggingface --token hf_xxx --enable
```

### Environment Variables

```bash
export SC_EMBEDDINGS_PROVIDER=ollama    # or huggingface
export SC_EMBEDDINGS_MODEL=nomic-embed-text
export SC_EMBEDDINGS_ENDPOINT=http://localhost:11434
export HUGGINGFACE_TOKEN=hf_xxx         # For HuggingFace
```

## Output Modes

### JSON Output

All commands support `--json` for machine-readable output:

```bash
sc session list --json | jq '.sessions[0].name'
sc issue list --json | jq '.issues | length'
sc get --query "auth" --json | jq '.items[].key'
```

### Auto-JSON (Non-TTY)

When stdout is piped, output is automatically JSON — no flag needed:

```bash
sc issue list | jq '.issues[].title'    # Auto-JSON (piped)
sc issue list                            # Human-readable (TTY)
```

### Format Flag

```bash
sc issue list --format json    # JSON output
sc issue list --format csv     # CSV output (id,title,status,priority,type,assigned_to)
sc issue list --format table   # Human-readable table (default)
```

### Silent Mode

For scripting — create/mutate commands print only the ID:

```bash
ID=$(sc issue create "Bug fix" --silent)
sc save my-key "value" --silent           # Prints: my-key
sc session start "work" --silent          # Prints: sess_xxxx
```

### Dry Run

Preview mutations without writing to the database:

```bash
sc issue create "Test" --dry-run          # Would create issue: Test [task, priority=2]
sc issue create "Test" --dry-run --json   # {"dry_run":true,"action":"create_issue",...}
```

## Error Handling

### Structured Errors

Errors include machine-readable codes, hints, and recovery suggestions:

```json
{
  "error": {
    "code": "ISSUE_NOT_FOUND",
    "message": "Issue not found: SC-xxxx",
    "retryable": false,
    "exit_code": 3,
    "hint": "Did you mean: SC-a1b2, SC-a1b3?"
  }
}
```

Structured JSON errors are automatic when piped (non-TTY) or with `--json`.

### Exit Code Categories

| Exit | Category | Action |
|------|----------|--------|
| 0 | Success | Continue |
| 1 | Internal | Report bug |
| 2 | Database | Check init/permissions |
| 3 | Not Found | Verify ID, check hint for suggestions |
| 4 | Validation | Fix input, retry |
| 5 | Dependency | Resolve dependency first |
| 6-9 | Other | See `cli/AGENTS.md` for full reference |

For the complete error code table and retryable flags, see [`cli/AGENTS.md`](AGENTS.md).

### Intent Detection

The CLI auto-normalizes common synonyms, so you don't need to memorize canonical values:

- **Status**: `done` → `closed`, `wip` → `in_progress`, `todo` → `open`
- **Type**: `defect` → `bug`, `story` → `feature`, `cleanup` → `chore`
- **Priority**: `critical` → 4, `high` → 3, `low` → 1, `P0`-`P4` accepted

### Similar ID Suggestions

When an ID isn't found, the error includes suggestions for similar existing IDs.

### Session Hints

When no active session is bound to your terminal, the error lists recent resumable sessions with their IDs, names, and statuses.

## Shell Completions

```bash
# Bash
sc completions bash > ~/.bash_completion.d/sc

# Zsh
sc completions zsh > ~/.zfunc/_sc

# Fish
sc completions fish > ~/.config/fish/completions/sc.fish

# PowerShell
sc completions powershell > $PROFILE.d/sc.ps1
```

## Development

```bash
# Build debug
cargo build

# Build release
cargo build --release

# Run tests
cargo test

# Run with verbose logging (or use -v/-vv flags)
RUST_LOG=debug cargo run -- session list
# Note: Debug output is minimal currently - most commands just output JSON

# Check lints
cargo clippy
```

## License

AGPL-3.0 - See [LICENSE](../LICENSE) for details.
