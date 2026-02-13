<div align="center">

# SaveContext

**The OS for AI coding agents**

[![npm version](https://img.shields.io/npm/v/@savecontext/mcp?color=brightgreen)](https://www.npmjs.com/package/@savecontext/mcp)
[![crates.io](https://img.shields.io/crates/v/savecontext-cli)](https://crates.io/crates/savecontext-cli)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![MCP](https://img.shields.io/badge/MCP-Compatible-orange)](https://modelcontextprotocol.io)

[Website](https://savecontext.dev) • [NPM](https://www.npmjs.com/package/@savecontext/mcp) • [Crates.io](https://crates.io/crates/savecontext-cli) • [Changelog](https://savecontext.dev/changelog)

</div>

---

SaveContext gives AI coding agents the operational layer they're missing — sessions, issue tracking, plans, semantic search, and multi-agent coordination, all stored locally in SQLite and available through a native CLI (`sc`) or any MCP-compatible client.

No cloud account. No API keys. No rate limits.

<div align="center">
<h3>Quick Install</h3>

```bash
cargo install savecontext-cli && sc init
```

<p><em>Requires Rust. See <a href="#installation">Installation</a> for alternatives.</em></p>
</div>

---

## Quick Start

```bash
# Start a session
sc session start "building auth system"

# Save context as you work
sc save auth-choice "JWT with refresh tokens" -c decision -p high
sc save login-done "Login endpoint complete with rate limiting" -c progress

# Track work with issues
sc issue create "Add auth middleware" -t task -p 3
sc issue create "Fix token refresh bug" -t bug -p 4
sc issue claim SC-a1b2

# Check current state
sc status
```

To connect an MCP-compatible client (Claude Code, Cursor, Codex, Gemini, etc.):

```bash
bunx @savecontext/mcp
```

Then add it to your client's MCP configuration — see [Configuration](#configuration).

---

## Why SaveContext?

### The Problem

AI coding agents lose all context between conversations. Decisions, progress, and rationale vanish when the window closes. Issue tracking lives in external tools that agents can't use natively. And when multiple agents work on the same project, there's no coordination — they duplicate work, create conflicts, and have no shared state.

### The Solution

SaveContext is a local operational layer that runs alongside your AI coding agent. It provides sessions to scope work, issues to track tasks, plans to spec features, semantic search to find past decisions by meaning, and coordination primitives so multiple agents can work without stepping on each other. Everything stored in a single SQLite database on your machine.

### How It Compares

| Feature | SaveContext | GitHub Issues | Linear/Jira | Beads | TODO comments |
|---------|:-----------:|:-------------:|:-----------:|:-----:|:-------------:|
| Works offline | **Yes** | No | No | Yes | Yes |
| Sessions & context | **Yes** | No | No | No | No |
| Issue tracking | **Yes** | Yes | Yes | Yes | No |
| Plans & specs | **Yes** | Projects | Yes | No | No |
| Semantic search | **Yes** | No | No | No | No |
| Smart context injection | **Yes** | No | No | No | No |
| Dependencies | **Yes** | Limited | Yes | Yes | No |
| Multi-agent coordination | **Yes** | No | Limited | No | No |
| MCP protocol | **Yes** | No | No | No | No |
| CLI + MCP access | **Yes** | API only | API only | CLI only | N/A |
| Zero setup cost | **Yes** | Free tier | $$/user | Yes | Yes |
| Checkpoints & restore | **Yes** | No | No | No | No |

---

## What You Can Do

### Sessions & Context

Sessions organize your work and scope context to what matters. Context items persist across conversations — your agent never loses track of decisions, progress, or notes.

```bash
sc session start "payment integration"
sc save stripe-approach "Event-driven with webhooks, not polling" -c decision -p high
sc save api-keys "Use test key sk_test_..." -c config
sc checkpoint create "pre-refactor" --include-git

# Later — resume where you left off
sc session list --search "payment"
sc session resume sess_abc123

# Find past context by meaning, not exact keywords
sc get -s "how do we handle stripe webhooks"
```

### Issue Tracking

Full issue tracking with epics, dependencies, priorities, labels, and multi-agent coordination. Agents can claim work, track blockers, and see what's ready.

```bash
# Create an epic with subtasks
sc issue create "Epic: Auth System" -t epic -p 3
sc issue create "Add JWT types" -t task --parent SC-a1b2
sc issue create "Auth middleware" -t task --parent SC-a1b2
sc issue create "Login endpoint" -t task --parent SC-a1b2

# Add dependencies between issues
sc issue dep add SC-c3d4 --depends-on SC-a1b2

# See what's ready to work on (unblocked + unassigned)
sc issue ready

# Claim and complete
sc issue claim SC-c3d4
sc issue complete SC-c3d4 --reason "Implemented with RS256 signing"

# Analytics
sc issue count --group-by status
sc issue stale --days 7
sc issue blocked
sc issue dep tree
```

### Plans & Epics

Create specs, link them to implementation issues, and track progress through epic completion.

```bash
sc plan create "Q1 Auth Overhaul" -c "## Goals
- Replace session auth with JWT
- Add MFA support
- SSO integration"

# Link issues to plans
sc issue create "Epic: JWT Migration" -t epic --plan-id plan_xyz

# Epic progress tracked automatically
sc issue show SC-a1b2
# Progress: 3/5 tasks (60%)
#   Closed:      3
#   In progress: 1
#   Open:        1
```

### Semantic Search

Find past decisions by meaning, not keywords. Smart search auto-decomposes multi-word queries, adapts thresholds, and expands scope when needed.

```bash
sc get -s "database connection pooling strategy"
sc get -s "auth middleware rate limiting"   # Auto-decomposes into terms + bigrams
sc get -s "postgres" --search-all-sessions  # Search across all sessions

# Optional: higher quality search
ollama pull nomic-embed-text
```

### Smart Context Injection

Inject the most relevant context into your AI agent's current context window. Smart prime scores every context item using temporal decay, priority, category weight, and optional semantic boosting, then applies MMR diversity re-ranking and packs items into a token budget.

```bash
# Ranked context within 4000 token budget (default)
sc prime --smart --compact

# Tight budget — only the most important items
sc prime --smart --compact --budget 1000

# Boost items related to a specific topic
sc prime --smart --compact --query "authentication"

# Aggressive recency bias (3-day half-life vs default 14)
sc prime --smart --compact --decay-days 3

# JSON output with scoring stats
sc prime --smart --json
```

Scoring formula: `temporal_decay * priority_weight * category_weight * semantic_boost`

| Factor | Values |
|--------|--------|
| Temporal decay | Exponential: today=1.0, 7d=0.71, 14d=0.5, 28d=0.25 |
| Priority | high=3.0x, normal=1.0x, low=0.5x |
| Category | decision=2.0x, reminder=1.5x, progress=1.0x, note=0.5x |
| Semantic boost | 0.5x to 2.5x based on cosine similarity to `--query` |

### Multi-Agent Coordination

Multiple agents can work on the same project simultaneously. Each agent claims work from a shared queue, preventing conflicts.

```bash
# Agent 1 claims work
SC_ACTOR=claude-agent-1 sc issue next-block --count 3

# Agent 2 claims different work
SC_ACTOR=codex-agent-2 sc issue next-block --count 3

# See who's working on what
sc issue list -s in_progress
```

---

## Design Principles

### 1. CLI-First

All business logic lives in Rust. The MCP server is a thin wrapper that delegates every call to the CLI. Use `sc` directly from your terminal, or connect any MCP-compatible client — same behavior either way.

```bash
sc issue list              # Direct CLI
bunx @savecontext/mcp     # MCP clients get the same commands
```

### 2. Local-Only

No cloud, no accounts, no sync. All data lives in a single SQLite database with WAL mode for fast concurrent reads and crash-safe writes.

```
~/.savecontext/
└── data/
    └── savecontext.db    # Everything lives here
```

### 3. Agent-First

Every command supports `--json` for structured output. When stdout is piped, output is automatically JSON — no flag needed. `--silent` returns only IDs for scripting. Structured errors include machine-readable codes, hints, and similar ID suggestions.

```bash
sc issue list              # TTY → human-readable table
sc issue list | jq         # Piped → auto-JSON
sc issue create "Bug" --silent  # Returns: SC-a1b2
```

Intent detection normalizes common synonyms so agents don't need to memorize canonical values:

| Input | Normalized to |
|-------|---------------|
| `done`, `resolved`, `fixed` | `closed` |
| `wip`, `working` | `in_progress` |
| `defect` | `bug` |
| `story` | `feature` |
| `P0`, `critical` | priority `4` |

### 4. Non-Invasive

SaveContext never runs git commands, never auto-commits, and never installs hooks. It only touches `~/.savecontext/`. Your repo stays clean.

### 5. Smart Search

Built-in Model2Vec embeddings work immediately with zero configuration. Multi-word queries are auto-decomposed into terms and bigrams, searched individually, and fused via Reciprocal Rank Fusion. Thresholds adapt dynamically. Install Ollama for higher quality results. No API keys needed for either tier.

```bash
sc get -s "authentication strategy"          # Built-in embeddings, adaptive threshold
sc get -s "auth middleware rate limiting"     # Auto-decomposes into subqueries + RRF
ollama pull nomic-embed-text                 # Optional: upgrade quality
sc get -s "authentication strategy"          # Now uses Ollama automatically
```

---

## Commands

Full flag reference in [`cli/README.md`](cli/README.md). Agent integration patterns in [`cli/AGENTS.md`](cli/AGENTS.md).

### Sessions

| Command | Description | Example |
|---------|-------------|---------|
| `session start` | Start session | `sc session start "auth feature"` |
| `session list` | Find sessions | `sc session list --search "auth"` |
| `session resume` | Resume session | `sc session resume sess_abc123` |
| `session pause` | Pause session | `sc session pause` |
| `session end` | End session | `sc session end` |
| `session rename` | Rename session | `sc session rename "better name"` |
| `session switch` | Switch session | `sc session switch sess_xyz` |
| `session delete` | Delete session | `sc session delete sess_abc123` |
| `session add-path` | Add project path | `sc session add-path /backend` |
| `session remove-path` | Remove project path | `sc session remove-path /backend` |

### Context Items

| Command | Description | Example |
|---------|-------------|---------|
| `save` | Save context item | `sc save auth-choice "JWT tokens" -c decision -p high` |
| `get` | Search / retrieve | `sc get -s "how we handle auth"` |
| `update` | Update item | `sc update auth-choice --value "Updated reasoning"` |
| `delete` | Delete item | `sc delete auth-choice` |
| `tag add` | Add tags | `sc tag add auth-choice -t important,security` |
| `tag remove` | Remove tags | `sc tag remove auth-choice -t security` |

### Issues

| Command | Description | Example |
|---------|-------------|---------|
| `issue create` | Create issue | `sc issue create "Fix bug" -t bug -p 3` |
| `issue list` | List issues | `sc issue list -s open` |
| `issue show` | Show details | `sc issue show SC-a1b2` |
| `issue update` | Update issue | `sc issue update SC-a1b2 -s in_progress` |
| `issue complete` | Close with reason | `sc issue complete SC-a1b2 --reason "Done"` |
| `issue claim` | Claim work | `sc issue claim SC-a1b2` |
| `issue release` | Release work | `sc issue release SC-a1b2` |
| `issue ready` | Ready queue | `sc issue ready` |
| `issue next-block` | Claim batch | `sc issue next-block -c 3` |
| `issue batch` | Bulk create | `sc issue batch --json-input '{...}'` |
| `issue clone` | Clone issue | `sc issue clone SC-a1b2` |
| `issue duplicate` | Mark duplicate | `sc issue duplicate SC-a1b2 --of SC-c3d4` |
| `issue delete` | Delete issue | `sc issue delete SC-a1b2` |

### Issue Analytics

| Command | Description | Example |
|---------|-------------|---------|
| `issue count` | Count with grouping | `sc issue count --group-by status` |
| `issue stale` | Stale issues | `sc issue stale --days 7` |
| `issue blocked` | Blocked + blockers | `sc issue blocked` |

### Dependencies & Labels

| Command | Description | Example |
|---------|-------------|---------|
| `issue dep add` | Add dependency | `sc issue dep add SC-a1b2 --depends-on SC-c3d4` |
| `issue dep remove` | Remove dependency | `sc issue dep remove SC-a1b2 --depends-on SC-c3d4` |
| `issue dep tree` | Dependency tree | `sc issue dep tree SC-a1b2` |
| `issue label add` | Add labels | `sc issue label add SC-a1b2 -l frontend,urgent` |
| `issue label remove` | Remove labels | `sc issue label remove SC-a1b2 -l urgent` |

### Checkpoints

| Command | Description | Example |
|---------|-------------|---------|
| `checkpoint create` | Create snapshot | `sc checkpoint create "pre-refactor" --include-git` |
| `checkpoint list` | Find checkpoints | `sc checkpoint list -s "refactor"` |
| `checkpoint show` | Show details | `sc checkpoint show ckpt_abc` |
| `checkpoint restore` | Restore state | `sc checkpoint restore ckpt_abc` |
| `checkpoint delete` | Delete checkpoint | `sc checkpoint delete ckpt_abc` |
| `checkpoint items` | List items in checkpoint | `sc checkpoint items ckpt_abc` |
| `checkpoint add-items` | Add items to checkpoint | `sc checkpoint add-items ckpt_abc -k key1,key2` |
| `checkpoint remove-items` | Remove items | `sc checkpoint remove-items ckpt_abc -k key1` |

### Memory (persistent across sessions)

| Command | Description | Example |
|---------|-------------|---------|
| `memory save` | Save memory item | `sc memory save test-cmd "npm test" -c command` |
| `memory get` | Get memory item | `sc memory get test-cmd` |
| `memory list` | List memory | `sc memory list -c command` |
| `memory delete` | Delete memory | `sc memory delete test-cmd` |

### Plans

| Command | Description | Example |
|---------|-------------|---------|
| `plan create` | Create plan/PRD | `sc plan create "Q1 Auth" -c "## Goals..."` |
| `plan list` | List plans | `sc plan list` |
| `plan show` | Show plan + epics | `sc plan show plan_abc` |
| `plan update` | Update plan | `sc plan update plan_abc -s completed` |
| `plan capture` | Capture agent's plan file | `sc plan capture` |

### Projects

| Command | Description | Example |
|---------|-------------|---------|
| `project create` | Register project | `sc project create /path/to/project -n "My App"` |
| `project list` | List projects | `sc project list` |
| `project show` | Show project details | `sc project show proj_abc` |
| `project update` | Update project | `sc project update proj_abc --name "New Name"` |
| `project delete` | Delete project | `sc project delete proj_abc` |

### System

| Command | Description | Example |
|---------|-------------|---------|
| `status` | Current session state | `sc status` |
| `prime` | Context dump | `sc prime --compact` |
| `prime --smart` | Smart ranked context | `sc prime --smart --compact --budget 2000` |
| `compaction` | Prepare for compaction | `sc compaction` |
| `init` | Initialize database | `sc init` |
| `embeddings status` | Search config | `sc embeddings status` |
| `embeddings configure` | Set up provider | `sc embeddings configure --provider ollama --enable` |
| `embeddings backfill` | Generate missing embeddings | `sc embeddings backfill` |
| `embeddings test` | Test provider connectivity | `sc embeddings test "Hello world"` |
| `embeddings upgrade-quality` | Upgrade to quality tier | `sc embeddings upgrade-quality` |
| `sync status` | Check sync state | `sc sync status` |
| `sync export` | Export to JSONL | `sc sync export` |
| `sync import` | Import from JSONL | `sc sync import` |
| `completions` | Shell completions | `sc completions bash` |
| `version` | Show version | `sc version` |

### Global Flags

| Flag | Description |
|------|-------------|
| `--json` | JSON output |
| `--format <fmt>` | Output format: `json`, `csv`, `table` |
| `--silent` | ID-only output (for scripting) |
| `--dry-run` | Preview without writing |
| `--db <path>` | Custom database path |
| `--actor <name>` | Agent identity for audit trail |
| `--session <id>` | Override active session |
| `-v` / `-vv` / `-vvv` | Verbose logging (info / debug / trace) |
| `-q` / `--quiet` | Suppress output |
| `--no-color` | Disable colors |
| `--robot` | Alias for `--json` |

---

## Installation

### CLI (Primary)

The Rust CLI (`sc`) is the source of truth for all SaveContext operations.

```bash
# From crates.io
cargo install savecontext-cli

# Or build from source
git clone https://github.com/greenfieldlabs-inc/savecontext.git
cd savecontext/cli && cargo build --release
cp target/release/sc /usr/local/bin/sc

# Verify
sc --version
```

### MCP Server

The MCP server wraps the CLI for clients that speak the [Model Context Protocol](https://modelcontextprotocol.io). Requires [Bun](https://bun.sh) and the CLI above.

```bash
curl -fsSL https://bun.sh/install | bash   # Install Bun (if needed)
bunx @savecontext/mcp                       # Run the MCP server
```

### Semantic Search (Optional)

```bash
ollama pull nomic-embed-text   # Higher quality search via Ollama
```

SaveContext includes built-in local embeddings (~15ms) that work immediately. Ollama adds a higher quality tier (~50ms) when available. See [`cli/README.md`](cli/README.md#embedding-configuration) for HuggingFace and other providers.

---

## Configuration

Add SaveContext to your MCP client:

<details>
<summary><b>Claude Code</b></summary>

```json
{
  "mcpServers": {
    "savecontext": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@savecontext/mcp"]
    }
  }
}
```

Config locations: `~/.claude.json` (global) or `.mcp.json` (project)

</details>

<details>
<summary><b>Cursor</b></summary>

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "bunx",
      "args": ["@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>VS Code</b></summary>

```json
{
  "mcp": {
    "servers": {
      "savecontext": {
        "type": "stdio",
        "command": "bunx",
        "args": ["@savecontext/mcp"]
      }
    }
  }
}
```

</details>

<details>
<summary><b>OpenAI Codex</b></summary>

```toml
[mcp_servers.savecontext]
args = ["@savecontext/mcp"]
command = "bunx"
startup_timeout_ms = 20_000
```

</details>

<details>
<summary><b>Gemini CLI</b></summary>

```bash
gemini mcp add savecontext --command "bunx" --args "@savecontext/mcp"
```

</details>

<details>
<summary><b>Factory</b></summary>

```bash
droid mcp add savecontext "bunx @savecontext/mcp"
```

</details>

<details>
<summary><b>Zed</b></summary>

```json
{
  "context_servers": {
    "SaveContext": {
      "source": "custom",
      "command": "bunx",
      "args": ["@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Other MCP clients (Cline, Windsurf, JetBrains, Roo Code, Augment, Kilo Code, etc.)</b></summary>

Most MCP clients use the same JSON format:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "bunx",
      "args": ["@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>GUI apps (Claude Desktop, Perplexity, LM Studio, BoltAI)</b></summary>

GUI apps may not inherit your shell's PATH. Use the full path to bunx:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "/Users/YOUR_USERNAME/.bun/bin/bunx",
      "args": ["@savecontext/mcp"],
      "env": {
        "PATH": "/Users/YOUR_USERNAME/.bun/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
      }
    }
  }
}
```

Find your bun path with: `which bunx`

</details>

<details>
<summary><b>Compaction Settings</b></summary>

Control when SaveContext preserves context before your conversation window fills up:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "bunx",
      "args": ["@savecontext/mcp"],
      "env": {
        "SAVECONTEXT_COMPACTION_THRESHOLD": "70",
        "SAVECONTEXT_COMPACTION_MODE": "remind"
      }
    }
  }
}
```

| Setting | Options | Default |
|---------|---------|---------|
| `COMPACTION_THRESHOLD` | 50-90 (% of context window) | 70 |
| `COMPACTION_MODE` | `auto`, `remind`, `manual` | `remind` |

</details>

---

## Dashboard

A local web interface for visual management of sessions, issues, plans, and memory.

```bash
bunx @savecontext/dashboard         # Starts on port 3333
bunx @savecontext/dashboard -p 4000  # Custom port
```

Reads from the same SQLite database as the CLI (`~/.savecontext/data/savecontext.db`).

---

## Status Line

Display real-time session info in your terminal. Works with any tool that supports lifecycle hooks — see [`docs/HOOKS.md`](docs/HOOKS.md) for templates.

```bash
bunx @savecontext/mcp@latest --setup-statusline

# To remove
bunx @savecontext/mcp@latest --uninstall-statusline
```

Shows: session name, context usage, cost, duration, and lines changed.

![Claude Code Status Line](https://pub-4304173ae3f74a77852a77192ab0b3e3.r2.dev/claude-statusline.png)

<details>
<summary><b>How it works</b></summary>

A PostToolUse Python hook writes session info to a local cache file on every SaveContext operation. Claude Code's native statusline reads from the cache on each prompt. Each terminal gets its own cache key for isolation.

**Supported terminals:** Terminal.app, iTerm2, Kitty, Alacritty, GNOME Terminal, Konsole, Windows Terminal, and more.

**Manual override:** `export SAVECONTEXT_STATUS_KEY="my-session"`

**Requires Python 3.x.** The setup script installs `statusline.py` and `update-status-cache.py` to `~/.savecontext/`.

</details>

---

## Skills & Agent Templates

Skills teach AI agents how to use SaveContext. Install them so your agent knows the workflows automatically.

```bash
bunx @savecontext/mcp@latest --setup-skill              # MCP mode (default)
bunx @savecontext/mcp@latest --setup-skill --mode cli    # CLI mode
bunx @savecontext/mcp@latest --setup-skill --mode both   # Both
bunx @savecontext/mcp@latest --setup-skill --sync        # Update all configured tools
```

| Tool | Skills location |
|------|----------------|
| Claude Code | `~/.claude/skills/SaveContext-*/` |
| OpenAI Codex | `~/.codex/skills/SaveContext-*/` |
| Gemini CLI | `~/.gemini/skills/SaveContext-*/` |
| Custom | `--path ~/.my-tool/skills` |

**Agent templates:** Copy [`AGENTS.md`](./AGENTS.md) to your project root for a generic reference, or use [`CLAUDE.md`](./CLAUDE.md) as a Claude Code-specific example.

---

## Architecture

```
AI Coding Agents (Claude Code, Cursor, Codex, Gemini, etc.)
          |                              |
          | MCP Protocol                 | Direct Bash
          v                              v
+-----------------------+    +---------------------+
|  MCP Server (TS)      |    |                     |
|  @savecontext/mcp     |--->|   Rust CLI (`sc`)   |
|  (thin wrapper)       |    |   Source of truth   |
+-----------------------+    |   45+ commands      |
                             +----------+----------+
                                        |
                                        v
                             +-----------------------+
                             |  SQLite Database      |
                             |  ~/.savecontext/      |
                             |  data/savecontext.db  |
                             +-----------------------+
```

### Data Flow

```
Action                     Command                  Storage
────────────────────────────────────────────────────────────────────
Start session       →   sc session start      →   SQLite INSERT
Save context        →   sc save               →   SQLite INSERT + embed queue
Search context      →   sc get -s "query"     →   Vector search + SQLite
Create issue        →   sc issue create       →   SQLite INSERT
Claim issue         →   sc issue claim        →   Atomic UPDATE (assign + status)
MCP tool call       →   bridge.ts → sc        →   Same path as direct CLI
```

### Principles

- **CLI-first** — All business logic lives in Rust. New features land in `sc` first.
- **Local-only** — No cloud, no accounts. All data stays on your machine.
- **SQLite + WAL** — Fast concurrent reads, single-writer, crash-safe.
- **MCP bridge** — The TypeScript server delegates every tool call to the CLI via `server/src/cli/bridge.ts`.

### Project Structure

```
cli/                          # Rust CLI (source of truth)
├── src/
│   ├── main.rs               # Entry point
│   ├── cli/commands/         # 45+ command implementations
│   ├── storage/              # SQLite database layer
│   ├── embeddings/           # Embedding providers (Ollama, HF)
│   └── sync/                 # JSONL import/export
└── Cargo.toml

server/                       # MCP server (delegates to CLI)
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── cli/bridge.ts         # Executes sc commands
│   ├── tools/registry.ts     # MCP tool definitions
│   └── lib/embeddings/       # Tier 1 (Model2Vec) embeddings
└── dist/

dashboard/                    # Local web UI
└── src/
```

---

## Documentation

| Doc | What's in it |
|-----|-------------|
| [`cli/README.md`](cli/README.md) | Full CLI command reference, output modes, embedding config |
| [`cli/AGENTS.md`](cli/AGENTS.md) | Machine-readable agent reference — error codes, synonyms, patterns |
| [`docs/MCP-TOOLS.md`](docs/MCP-TOOLS.md) | MCP tool reference — all tool input/output schemas |
| [`docs/HOOKS.md`](docs/HOOKS.md) | Hook integration — templates for any tool with lifecycle hooks |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Database schema — all tables, columns, and migrations |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

---

## Debugging

Use verbosity flags to trace what the CLI is doing. Output goes to stderr so it doesn't interfere with JSON on stdout.

```bash
sc get -s "auth decisions" -v      # info:  high-level actions (search started, stage matched)
sc get -s "auth decisions" -vv     # debug: decision points (thresholds, RRF scores, resolution sources)
sc get -s "auth decisions" -vvv    # trace: per-item details (sub-query hits, embedding dimensions)
```

Example `-vv` output for a semantic search:

```
DEBUG sc::config: Session resolved session=sess_abc source="TTY status cache"
INFO  sc::cli::commands::context: Starting semantic search query="auth decisions" search_mode=Tiered
DEBUG sc::cli::commands::context: Stage 1: adaptive threshold search
DEBUG sc::cli::commands::context: Adaptive threshold computed top_score=0.138 adaptive_threshold=0.25 candidates=15 above_threshold=0
DEBUG sc::cli::commands::context: Stage 2: decomposition sub_query_count=3 sub_queries=["auth", "decisions", "auth decisions"]
DEBUG sc::cli::commands::context: RRF fusion complete unique_items=5 top_rrf_score=0.032
INFO  sc::cli::commands::context: Stage 2 matched (decomposed query) count=5
```

Override with `RUST_LOG` for full control (including third-party crate output):

```bash
RUST_LOG=debug sc get -s "test"          # Everything at debug (includes reqwest, hyper, rustls)
RUST_LOG=sc=trace sc save "key" "value"  # Only sc crate at trace
```

---

## Troubleshooting

Errors include machine-readable codes, hints, and similar ID suggestions. Use `--json` for structured error output.

| Error | Cause | Fix |
|-------|-------|-----|
| "No active session" | No session started or resumed | `sc session list` then `sc session resume <id>` |
| "Issue not found: SC-xxxx" | Typo or wrong prefix | Check the hint — it suggests similar IDs |
| "bunx not found" | Bun not in PATH | Use full path to bunx (find with `which bunx`) |
| "Module not found" | Stale npm cache | `rm -rf ~/.bun/install/cache/@savecontext*` |
| "SaveContext CLI binary not found" | `sc` not installed | `cargo install savecontext-cli` or set `SC_BINARY_PATH` |
| "Database locked" | Another process has the DB open | Check for running `sc` processes |

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

See [`cli/AGENTS.md`](cli/AGENTS.md) for the full error code table and exit code categories.

---

## FAQ

### Where is data stored?

All data lives in a single SQLite database:

```
~/.savecontext/
└── data/
    └── savecontext.db    # Sessions, context, issues, plans, memory, embeddings
```

No cloud sync — your data never leaves your machine.

### Can I use `sc` without the MCP server?

Yes. The CLI is standalone and fully functional. The MCP server is only needed if you want to connect AI coding tools (Claude Code, Cursor, etc.) via the MCP protocol.

### How do I use SaveContext with AI coding agents?

Two ways:

1. **MCP protocol** — Add `bunx @savecontext/mcp` to your client's config. The agent gets 50+ tools automatically.
2. **Direct CLI** — Agents that support bash can call `sc` commands directly with `--json` for structured output.

See [`cli/AGENTS.md`](cli/AGENTS.md) for integration patterns and workflows.

### How do dependencies work?

```bash
# Issue A depends on Issue B (A is blocked until B is closed)
sc issue dep add SC-a1b2 --depends-on SC-c3d4

# Now SC-a1b2 won't appear in `sc issue ready` until SC-c3d4 is closed
sc issue ready  # Only shows SC-c3d4

# Close the blocker
sc issue complete SC-c3d4

# Now SC-a1b2 is unblocked
sc issue ready  # Shows SC-a1b2
```

### Can sessions span multiple directories?

Yes. Use `session add-path` for monorepo or multi-project workflows:

```bash
sc session start "full-stack feature"
sc session add-path /app/frontend
sc session add-path /app/backend
sc session add-path /shared/types
```

Context and issues are scoped to all paths in the session.

### How does semantic search work?

SaveContext uses a two-tier embedding system with smart search:

- **Tier 1 (built-in):** Model2Vec embeddings, ~15ms per query, works immediately with zero setup
- **Tier 2 (optional):** Ollama with `nomic-embed-text`, ~50ms per query, higher quality results

When Ollama is available, SaveContext uses it automatically. If not, it falls back to built-in embeddings. No API keys or cloud services needed for either tier.

Smart search runs a 4-stage cascade: (1) full query with adaptive threshold, (2) sub-query decomposition + Reciprocal Rank Fusion for multi-word queries, (3) scope expansion to all sessions, (4) nearest-miss suggestions. This means `sc get -s "auth middleware decisions"` finds results even when no single item matches the full phrase.

The same embedding infrastructure powers **smart prime** (`sc prime --smart`), which scores and ranks all context items for optimal injection into an agent's context window — see [Smart Context Injection](#smart-context-injection).

### What environment variables does SaveContext use?

| Variable | Where | Description |
|----------|-------|-------------|
| `SC_ACTOR` | CLI | Agent identity for multi-agent coordination |
| `SC_SESSION` | CLI | Override active session ID |
| `SAVECONTEXT_DB` | CLI | Custom database path (overrides default) |
| `SC_BINARY_PATH` | MCP Server | Custom path to `sc` binary (if not in PATH) |
| `SC_DEBUG` | MCP Server | Enable debug logging (`true`) |
| `SAVECONTEXT_COMPACTION_THRESHOLD` | MCP Server | Context window % to trigger compaction (50-90) |
| `SAVECONTEXT_COMPACTION_MODE` | MCP Server | Compaction mode: `auto`, `remind`, `manual` |
| `SAVECONTEXT_STATUS_KEY` | MCP Server | Override status line cache key |
| `HF_TOKEN` | CLI | HuggingFace API token for quality embeddings |
| `RUST_LOG` | CLI | Override verbosity flags: `sc=debug`, `sc=trace`, or `debug` for all crates |

### How do I back up my data?

```bash
# Option 1: JSONL export
sc sync export

# Option 2: Copy the database file
cp ~/.savecontext/data/savecontext.db ~/backups/
```

---

## Development

```bash
# CLI
cd cli && cargo build --release && cargo test

# MCP Server
cd server && bun install && bun run build

# Dashboard
cd dashboard && bun install && bun dev
```

## Contributing

See [CONTRIBUTING.md](https://github.com/greenfieldlabs-inc/savecontext/blob/main/CONTRIBUTING.md) for development guidelines.

## Acknowledgments

- [Jeffrey Emanuel](https://x.com/doodlestein) — Model2Vec approach for the 2-tier embedding system
- [beads](https://github.com/steveyegge/beads) — CLI-as-agent-interface pattern that inspired the SaveContext-CLI skill

## License

[AGPL-3.0](LICENSE)
