<div align="center">

# SaveContext

**Local-first project memory for AI coding assistants**

[![npm version](https://img.shields.io/npm/v/@savecontext/mcp?color=brightgreen)](https://www.npmjs.com/package/@savecontext/mcp)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![MCP](https://img.shields.io/badge/MCP-Compatible-orange)](https://modelcontextprotocol.io)

[Website](https://savecontext.dev) • [NPM](https://www.npmjs.com/package/@savecontext/mcp) • [Changelog](https://savecontext.dev/changelog)

</div>

---

## Overview

SaveContext is a Model Context Protocol (MCP) server that gives AI coding assistants persistent memory across sessions. It combines context management, issue tracking, and project planning into a single local-first tool that works with any MCP-compatible client.

**Core capabilities:**
- **Context & Memory** — Save decisions, progress, and notes that persist across conversations
- **Issue Tracking** — Manage tasks, bugs, and epics with dependencies and hierarchies
- **Plans & PRDs** — Create specs and link them to implementation issues
- **Semantic Search** — Find past decisions by meaning, not just keywords
- **Checkpoints** — Snapshot and restore session state at any point

## Features

- **Local Semantic Search**: AI-powered search using Ollama or Transformers.js for offline embedding generation
- **Multi-Agent Support**: Run multiple CLI/IDE instances simultaneously with agent-scoped session tracking
- **Automatic Provider Detection**: Detects 30+ MCP clients including coding tools (Claude Code, Cursor, Cline, VS Code, JetBrains, etc.) and desktop apps (Claude Desktop, Perplexity, ChatGPT, Raycast, etc.)
- **Session Lifecycle Management**: Full session state management with pause, resume, end, switch, and delete operations
- **Multi-Path Sessions**: Sessions can span multiple related directories (monorepos, frontend/backend, etc.)
- **Project Isolation**: Automatically filters sessions by project path - only see sessions from your current repository
- **Auto-Resume**: If an active session exists for your project, automatically resume it instead of creating duplicates
- **Session Management**: Organize work by sessions with automatic channel detection from git branches
- **Checkpoints**: Create named snapshots of session state with optional git status capture
- **Checkpoint Search**: Lightweight keyword search across all checkpoints with project/session filtering to find historical decisions
- **Smart Compaction**: Analyze priority items and generate restoration summaries when approaching context limits
- **Channel System**: Automatically derive channels from git branches (e.g., `feature/auth` → `feature-auth`)
- **Local Storage**: SQLite database with WAL mode for fast, reliable persistence
- **Cross-Tool Compatible**: Works with any MCP-compatible client (Claude Code, Cursor, Factory, Codex, Cline, etc.)
- **Fully Offline**: No cloud account required, all data stays on your machine
- **Plans System**: Create PRDs and specs, link issues to plans, track implementation progress
- **Dashboard UI**: Local Next.js web interface for visual session, context, and issue management

## Installation

### Using npm (Recommended)

```bash
npm install -g @savecontext/mcp
```

### Using npx (No installation)

```bash
npx -y @savecontext/mcp
```

### From source (Development)

```bash
git clone https://github.com/greenfieldlabs-inc/savecontext.git
cd savecontext/server
pnpm install
pnpm build
```

---

## Quick Start

Get started with SaveContext in under a minute:

```bash
# 1. Install the package
npm install -g @savecontext/mcp

# 2. Add to your AI tool's MCP config
```

Add this to your MCP configuration (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

That's it! Your AI assistant now has persistent memory across sessions.

**Optional:** Install [Ollama](https://ollama.com) for AI-powered semantic search:
```bash
ollama pull nomic-embed-text
```

---

## Claude Code Status Line

**Never lose track of your session** - See real-time session info directly in Claude Code's status bar.

![Claude Code Status Line](https://pub-4304173ae3f74a77852a77192ab0b3e3.r2.dev/claude-statusline.png)

### What You See

| Metric | Description |
|--------|-------------|
| **Session Name** | Your current SaveContext session |
| **Context** | Token count + visual progress bar + percentage |
| **Cost** | Running cost for this Claude Code session |
| **Duration** | How long the session has been active |
| **Lines** | Net lines changed (+/-) |

### Setup

```bash
npx @savecontext/mcp@latest --setup-statusline
```

Then restart Claude Code. That's it.

### How It Works

1. **PostToolUse Hook**: A Claude Code hook intercepts SaveContext MCP tool responses and writes session info to a local cache file (`~/.savecontext/status-cache/<key>.json`)
2. **Status Script**: Claude Code runs the status line script on each prompt, which reads the cache and parses your transcript for context usage
3. **Terminal Isolation**: Each terminal instance gets its own cache key, so multiple Claude Code windows show their own sessions without overlap

### Cross-Platform Support

The statusline scripts automatically detect your platform and terminal to generate a unique session key:

| Platform | Detection Method | Example Key |
|----------|------------------|-------------|
| **Windows Terminal** | `WT_SESSION` env var | `wt-abc123-def` |
| **ConEmu/Cmder** | `ConEmuPID` env var | `conemu-12345` |
| **Windows CMD/PS** | `SESSIONNAME` + PPID | `win-Console-1234` |
| **WSL** | Kernel contains "microsoft" | `wt-*` or `wslpid-*` |
| **macOS Terminal.app** | `TERM_SESSION_ID` | `term-abc123` |
| **iTerm2** | `ITERM_SESSION_ID` | `iterm-xyz789` |
| **GNOME Terminal** | `GNOME_TERMINAL_SERVICE` | `gnome-12345` |
| **Konsole** | `KONSOLE_DBUS_SESSION` | `konsole-12345` |
| **Kitty** | `KITTY_PID` | `kitty-12345` |
| **Tilix** | `TILIX_ID` | `tilix-session-1` |
| **Alacritty** | `ALACRITTY_SOCKET` | `alacritty-12345` |
| **TTY (SSH, etc.)** | `ps -o tty=` command | `tty-pts_0` |
| **Fallback** | Parent process ID | `linuxpid-*`, `macpid-*`, `winpid-*` |

**Manual Override**: Set `SAVECONTEXT_STATUS_KEY` environment variable to use a custom key:
```bash
export SAVECONTEXT_STATUS_KEY="my-custom-session"
```

### Troubleshooting

If the statusline doesn't work after setup:

1. **Check Python is installed**: The scripts require Python 3.x
   - Windows: Install from [python.org](https://python.org) or run `winget install Python.Python.3`
   - macOS: Run `brew install python3` or use system Python
   - Linux: Run `apt install python3` or equivalent

2. **Verify scripts are installed**: Check `~/.savecontext/` contains:
   - `statusline.py`
   - `hooks/update-status-cache.py`

3. **Restart Claude Code**: Changes to `settings.json` require a restart

4. **Check Claude Code settings**: Run `cat ~/.claude/settings.json` and verify the `statusLine` and `hooks` sections exist

**Still not working?** Please [open an issue](https://github.com/greenfieldlabs-inc/savecontext/issues) with:
- Your OS and terminal (e.g., "Windows 11 + Windows Terminal", "macOS + iTerm2")
- Output of `python3 --version` (or `py -3 --version` on Windows)
- Any error messages from Claude Code

### What Gets Tracked

The hook monitors session lifecycle tools and updates the status line when:
- Sessions start, resume, or switch (`context_session_start`, `context_session_resume`, `context_session_switch`)
- Sessions are renamed (`context_session_rename`)
- Sessions pause or end (`context_session_pause`, `context_session_end`) - clears status
- Status is checked (`context_status`)

Other tools like `context_save`, `context_get`, checkpoints, etc. don't change the status line since the session itself hasn't changed.

### Script Locations

| Script | Location | Purpose |
|--------|----------|---------|
| Status line | `~/.savecontext/statusline.py` | Reads cache and displays session info |
| PostToolUse hook | `~/.savecontext/hooks/update-status-cache.py` | Intercepts MCP responses, updates cache |

Source available at [`server/scripts/`](https://github.com/greenfieldlabs-inc/savecontext/blob/main/server/scripts/).

---

## Skills

SaveContext includes a skill system that teaches AI coding assistants how to use SaveContext effectively. Skills are markdown files containing workflows, best practices, and usage patterns.

### Setup Skills

```bash
npx @savecontext/mcp@latest --setup-skill
```

This installs the SaveContext skill to your AI tool's skills directory.

### Supported Tools

We natively support **Claude Code** and **OpenAI Codex** with automatic path detection:

| Tool | Default Location |
|------|------------------|
| Claude Code | `~/.claude/skills/savecontext/` |
| OpenAI Codex | `~/.codex/skills/savecontext/` |

### Custom Tool Locations

You can add skills to any AI tool that supports a skills directory:

```bash
# Install to a custom path
npx @savecontext/mcp@latest --setup-skill --path ~/.my-ai-tool/skills/savecontext
```

Your custom locations are saved to `~/.savecontext/skill-sync.json` and will be updated automatically when you run `--setup-skill --sync` in the future.

### Syncing Skills

To update skills across all your configured tools:

```bash
npx @savecontext/mcp@latest --setup-skill --sync
```

This re-installs skills to every location in your sync config, including any custom paths you've added.

**Want native support for another AI tool?** [Open an issue](https://github.com/greenfieldlabs-inc/savecontext/issues) with the tool name and its skills directory path.

---

### Manual Configuration

If you prefer manual setup, add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "python3 ~/.savecontext/statusline.py"
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__savecontext__.*",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.savecontext/hooks/update-status-cache.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Then copy the scripts from the package to `~/.savecontext/`:
```bash
# Get script paths from installed package
SCRIPTS=$(npm root -g)/@savecontext/mcp/scripts
cp "$SCRIPTS/statusline.py" ~/.savecontext/
mkdir -p ~/.savecontext/hooks
cp "$SCRIPTS/update-status-cache.py" ~/.savecontext/hooks/
chmod +x ~/.savecontext/statusline.py ~/.savecontext/hooks/update-status-cache.py
```

---

## CLI Session Management

Manage sessions directly from the command line.

### Commands

| Command | Description |
|---------|-------------|
| `savecontext-sessions list` | List sessions with search and filtering |
| `savecontext-sessions show` | Display session details |
| `savecontext-sessions rename` | Rename a session (interactive picker) |
| `savecontext-sessions delete` | Delete a session with confirmation |
| `savecontext-sessions archive` | Mark session as completed (soft close) |
| `savecontext-sessions add-path` | Add a project path to a session |
| `savecontext-sessions remove-path` | Remove a project path from a session |

### Usage

All commands that accept `[session_id]` show an interactive picker if no ID is provided.

```bash
# List sessions (filters to current directory by default)
savecontext-sessions list
savecontext-sessions list --global          # All projects
savecontext-sessions list --search "auth"   # Search by name/description
savecontext-sessions list --all             # Include archived sessions

# Show session details (context items, checkpoints, paths)
savecontext-sessions show [session_id]

# Rename a session
savecontext-sessions rename [session_id]

# Archive a session (marks as completed, data preserved)
savecontext-sessions archive [session_id]

# Delete a session permanently
savecontext-sessions delete [session_id]

# Manage multi-project sessions
savecontext-sessions add-path [session_id]     # Add current directory
savecontext-sessions remove-path [session_id]  # Remove a path
```

## CLI Project Management

Manage projects directly from the command line.

### Commands

| Command | Description |
|---------|-------------|
| `savecontext-projects list` | List all projects with session counts |
| `savecontext-projects rename` | Rename a project (interactive picker) |
| `savecontext-projects delete` | Delete a project (sessions unlinked, not deleted) |
| `savecontext-projects merge` | Merge two projects into one |

### Usage

All commands use interactive pickers to select projects.

```bash
# List all projects
savecontext-projects list
savecontext-projects list --counts   # Include session counts (slower)
savecontext-projects list --json     # JSON output

# Rename a project
savecontext-projects rename

# Delete a project (sessions unlinked, not deleted)
savecontext-projects delete
savecontext-projects delete --force  # Skip confirmation for projects with sessions

# Merge two projects (moves all sessions to target)
savecontext-projects merge
savecontext-projects merge --keep-source  # Don't delete source project after merge
```

## Dashboard

A local Next.js web interface for visual session, context, memory, plan, and issue management.

### Running the Dashboard

```bash
cd savecontext/dashboard
pnpm install
pnpm dev          # runs on port 3333
pnpm dev -p 4000  # or specify a custom port
```

### Features

- **Projects View**: See all projects with session counts
- **Sessions**: Browse sessions, view context items, manage checkpoints
- **Memory**: View and manage project memory (commands, configs, notes)
- **Issues**: Track tasks, bugs, features with Linear-style interface
- **Plans**: Create and manage PRDs/specs linked to issues

> **Note**: The dashboard reads from the same SQLite database as the MCP server (`~/.savecontext/data/savecontext.db`).

## Configuration

<details>
<summary><b>Install in Claude Code</b></summary>

<br>

```json
{
  "mcpServers": {
    "savecontext": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

**Config File Locations:**
- User config (all projects): `~/.claude.json`
- Project config (shared): `.mcp.json` in project root
- Local config (private): `~/.claude.json` (with project scope)

</details>

<details>
<summary><b>Install in Cursor</b></summary>

<br>

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

**Config File Location:**
- macOS: `~/Library/Application Support/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`
- Windows: `%APPDATA%\Cursor\User\globalStorage\rooveterinaryinc.roo-cline\settings\cline_mcp_settings.json`
- Linux: `~/.config/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`

</details>

<details>
<summary><b>Install in Cline</b></summary>

<br>

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in VS Code</b></summary>

<br>

```json
{
  "mcp": {
    "servers": {
      "savecontext": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@savecontext/mcp"]
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Factory</b></summary>

<br>

Factory's droid supports MCP servers through its CLI.

```bash
droid mcp add savecontext "npx -y @savecontext/mcp"
```

</details>

<details>
<summary><b>Install in OpenAI Codex</b></summary>

<br>

```toml
[mcp_servers.savecontext]
args = ["-y", "@savecontext/mcp"]
command = "npx"
startup_timeout_ms = 20_000
```

</details>

<details>
<summary><b>Install in Google Antigravity</b></summary>

<br>

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in Zed</b></summary>

<br>

Add this to your Zed `settings.json`:

```json
{
  "context_servers": {
    "SaveContext": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in Claude Desktop</b></summary>

<br>

Open Claude Desktop developer settings and edit your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

**Config File Location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

</details>

<details>
<summary><b>Install in JetBrains AI Assistant</b></summary>

<br>

1. In JetBrains IDEs, go to `Settings` → `Tools` → `AI Assistant` → `Model Context Protocol (MCP)`
2. Click `+ Add`
3. Click on `Command` in the top-left corner and select `As JSON`
4. Add this configuration:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

5. Click `Apply` to save changes

</details>

<details>
<summary><b>Install in Roo Code</b></summary>

<br>

Roo Code natively supports MCP servers.

Edit Roo Code's MCP settings:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in Augment Code</b></summary>

<br>

```json
{
  "mcp": {
    "servers": {
      "savecontext": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@savecontext/mcp"]
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Kilo Code</b></summary>

<br>

Add to your Kilo Code MCP configuration:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in Gemini CLI</b></summary>

<br>

Add SaveContext to your Gemini CLI configuration:

```bash
gemini mcp add savecontext \
  --command "npx" \
  --args "-y @savecontext/mcp"
```

</details>

<details>
<summary><b>Install in Perplexity Desktop</b></summary>

<br>

Navigate to Perplexity Desktop Settings → Integrations → MCP Servers:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in LM Studio</b></summary>

<br>

In LM Studio, go to Settings → Tools → MCP and add:

```json
{
  "servers": {
    "savecontext": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in GitHub Copilot Coding Agent</b></summary>

<br>

Add to your Copilot Coding Agent configuration:

```json
{
  "mcp": {
    "servers": {
      "savecontext": {
        "command": "npx",
        "args": ["-y", "@savecontext/mcp"]
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Copilot CLI</b></summary>

<br>

Configure via GitHub Copilot CLI settings:

```bash
gh copilot config set mcp.servers.savecontext.command "npx"
gh copilot config set mcp.servers.savecontext.args "-y @savecontext/mcp"
```

</details>

<details>
<summary><b>Install in Warp AI</b></summary>

<br>

In Warp terminal, navigate to Settings → AI → MCP Servers:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in Qodo Gen</b></summary>

<br>

Add to Qodo Gen MCP configuration file:

```json
{
  "servers": {
    "savecontext": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in Replit AI</b></summary>

<br>

In your Replit project, add to `.replit` configuration:

```toml
[mcp.servers.savecontext]
command = "npx"
args = ["-y", "@savecontext/mcp"]
```

</details>

<details>
<summary><b>Install in Amazon Q Developer</b></summary>

<br>

Configure in Amazon Q Developer settings:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in Sourcegraph Cody</b></summary>

<br>

Add to Cody's MCP server configuration:

```json
{
  "mcp": {
    "servers": {
      "savecontext": {
        "command": "npx",
        "args": ["-y", "@savecontext/mcp"]
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Tabnine</b></summary>

<br>

In Tabnine settings, navigate to Extensions → MCP:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>Install in BoltAI</b></summary>

<br>

Open the "Settings" page of the app, navigate to "Plugins," and enter the following JSON:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

For more information, see [BoltAI's Documentation](https://docs.boltai.com/docs/plugins/mcp-servers). For BoltAI on iOS, [see this guide](https://docs.boltai.com/docs/boltai-mobile/mcp-servers).

</details>

<details>
<summary><b>Install in Opencode</b></summary>

<br>

Add this to your Opencode configuration file. See [Opencode MCP docs](https://opencode.ai/docs/mcp-servers) for more info.

```json
{
  "mcp": {
    "savecontext": {
      "type": "local",
      "command": ["npx", "-y", "@savecontext/mcp"],
      "enabled": true
    }
  }
}
```

</details>

<details>
<summary><b>Install in Qwen Coder</b></summary>

<br>

See [Qwen Coder MCP Configuration](https://qwenlm.github.io/qwen-code-docs/en/tools/mcp-server/#how-to-set-up-your-mcp-server) for details.

1. Open the Qwen Coder settings file at `~/.qwen/settings.json`
2. Add the following to the `mcpServers` object:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

If the `mcpServers` object does not exist, create it.

</details>

<details>
<summary><b>Install in Visual Studio 2022</b></summary>

<br>

Configure SaveContext MCP in Visual Studio 2022 by following the [Visual Studio MCP Servers documentation](https://learn.microsoft.com/visualstudio/ide/mcp-servers?view=vs-2022).

Add this to your Visual Studio MCP config file:

```json
{
  "mcp": {
    "servers": {
      "savecontext": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@savecontext/mcp"]
      }
    }
  }
}
```

For more information and troubleshooting, refer to the [Visual Studio MCP Servers documentation](https://learn.microsoft.com/visualstudio/ide/mcp-servers?view=vs-2022).

</details>

<details>
<summary><b>Install in Windsurf</b></summary>

<br>

Add this to your Windsurf MCP config file. See [Windsurf MCP docs](https://docs.windsurf.com/windsurf/cascade/mcp) for more info.

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"]
    }
  }
}
```

</details>

<details>
<summary><b>From Source (Development)</b></summary>

<br>

For local development (running from source):

```json
{
  "mcpServers": {
    "savecontext": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/savecontext/server/dist/index.js"]
    }
  }
}
```

</details>

> **Note**: Compaction settings are experimental. See [Compaction Settings](#compaction-settings) for configuration options.

The server communicates via stdio using the MCP protocol.

### Advanced Configuration

SaveContext can be configured via environment variables in your MCP server settings to control compaction behavior.
#### Compaction Settings

> ⚠️ **EXPERIMENTAL FEATURE**: Compaction configuration only validated with Claude Code - requires CLI restart when env vars change. Other MCP clients may not support the instructions field.

Control when and how SaveContext preserves context before your conversation window fills up:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"],
      "env": {
        "SAVECONTEXT_COMPACTION_THRESHOLD": "70",
        "SAVECONTEXT_COMPACTION_MODE": "remind"
      }
    }
  }
}
```

**`SAVECONTEXT_COMPACTION_THRESHOLD`** (default: `70`)
- Context usage percentage (50-90) that triggers compaction behavior
- When conversation reaches this % of context window, compaction activates
- Lower values = more frequent compaction, higher values = longer conversations before compaction

**`SAVECONTEXT_COMPACTION_MODE`** (default: `remind`)
- `auto` - Automatically calls `context_prepare_compaction` at threshold (no user interaction needed)
- `remind` - AI suggests compaction to user and explains what will be preserved
- `manual` - Only compacts when user explicitly requests it

**Recommended Settings:**
- Long technical sessions: `threshold=70, mode=auto`
- Pair programming: `threshold=80, mode=remind`
- Short tasks: `threshold=90, mode=manual`

#### Local Semantic Search

SaveContext supports local semantic search using vector embeddings. When enabled, `context_get` can find items by meaning rather than just keywords.

**How It Works:**
1. When you save context items, embeddings are generated in the background
2. The `context_get` tool's `query` parameter uses vector similarity to find relevant items
3. Falls back to keyword search if no embedding provider is available

**Setting Up Ollama (Recommended):**

[Ollama](https://ollama.ai) provides fast, local embedding generation:

```bash
# Install Ollama
brew install ollama  # macOS
# or download from https://ollama.ai

# Pull the embedding model
ollama pull nomic-embed-text

# Ollama runs automatically in the background
```

SaveContext will automatically detect and use Ollama when available.

**Using HuggingFace (Custom Models):**

Use any embedding model from HuggingFace Hub:

```bash
# Set your HuggingFace token
export HF_TOKEN=hf_your_token_here

# Optionally specify a custom model
export HF_MODEL=BAAI/bge-base-en-v1.5
```

Supported models include: `sentence-transformers/all-MiniLM-L6-v2`, `BAAI/bge-*`, `thenlper/gte-*`, `intfloat/e5-*`, `nomic-ai/nomic-embed-text-v1.5`, and any HuggingFace embedding model.

**Fallback to Transformers.js:**

If no other provider is available, SaveContext falls back to [@xenova/transformers](https://github.com/xenova/transformers.js) which runs entirely in-process. This is slower but requires no external dependencies.

**Provider Comparison:**

| Feature | Ollama | HuggingFace | Transformers.js |
|---------|--------|-------------|-----------------|
| Speed | Fast (~50ms) | Medium (~200ms) | Slower (~500ms) |
| Model | nomic-embed-text | Any HF model | all-MiniLM-L6-v2 |
| Setup | Requires install | HF_TOKEN env | Automatic |
| Location | Local | Cloud API | In-process |

**Environment Variables:**

| Variable | Description |
|----------|-------------|
| `SAVECONTEXT_EMBEDDINGS_ENABLED` | Set to `false` to disable embeddings |
| `SAVECONTEXT_EMBEDDING_PROVIDER` | Force provider: `ollama`, `huggingface`, or `transformers` |
| `OLLAMA_ENDPOINT` | Ollama API URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | Ollama model (default: `nomic-embed-text`) |
| `HF_TOKEN` | HuggingFace API token (required for HF provider) |
| `HF_MODEL` | HuggingFace model ID (default: `sentence-transformers/all-MiniLM-L6-v2`) |

**Embeddings CLI:**

Manage embeddings with the `savecontext-embeddings` command:

```bash
# Check embedding status and coverage
savecontext-embeddings status

# Generate embeddings for items without them
savecontext-embeddings backfill
savecontext-embeddings backfill --limit 500         # Process up to 500 items
savecontext-embeddings backfill --provider ollama   # Force specific provider
savecontext-embeddings backfill --dry-run           # Preview without generating

# View and configure providers
savecontext-embeddings providers                    # List available providers
savecontext-embeddings models                       # List supported HuggingFace models
savecontext-embeddings config                       # View current configuration
savecontext-embeddings config --provider ollama     # Set preferred provider
savecontext-embeddings config --enabled false       # Disable embeddings

# Reset embeddings (useful when switching models)
savecontext-embeddings reset                        # Prompts for confirmation
savecontext-embeddings reset --force                # Skip confirmation
```

**Config File:**

Settings persist in `~/.savecontext/config.json`. The CLI's `config` command manages this file.

**Keyword Fallback:**

When no embedding provider is available, `context_get` with a `query` parameter uses keyword matching instead:
- Splits query into keywords (3+ characters)
- Scores items by keyword matches in key and value
- Returns top matches sorted by score
- Response includes `search_mode: "keyword"` and a tip to install Ollama

**Using Semantic Search:**

```javascript
// Find items by meaning
context_get({ query: "how did we handle authentication" })

// Combine with filters
context_get({ query: "database decisions", category: "decision" })

// Adjust threshold (lower = more results)
context_get({ query: "API endpoints", threshold: 0.3 })

// Search across all sessions
context_get({ query: "payment integration", search_all_sessions: true })
```

## Architecture

All data is stored locally on your machine in SQLite:

```
┌────────────────────────────────────────────────────────┐
│  Your Machine                                          │
│                                                        │
│  ┌──────────────────┐    ┌───────────────────────────┐ │
│  │  AI Coding Tool  │◄──►│  SaveContext MCP Server   │ │
│  │  (Claude Code,   │    │  (stdio process)          │ │
│  │   Cursor, etc.)  │    └─────────────┬─────────────┘ │
│  └──────────────────┘                  │               │
│                                        ▼               │
│                          ┌───────────────────────────┐ │
│                          │  SQLite Database          │ │
│                          │  ~/.savecontext/data/     │ │
│                          │  savecontext.db           │ │
│                          └───────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

- **No account required** - completely self-hosted
- **No network calls** - all data stays local
- **Unlimited usage** - no rate limits

### Server Implementation

The MCP server is built on `@modelcontextprotocol/sdk` and provides 52 tools for context management, including session lifecycle, memory storage, issue tracking, plan management, and checkpoints. The server maintains a single active session per connection and stores data in a local SQLite database with optional semantic search via sqlite-vec.

```
server/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── cloud-client.ts       # Cloud API client (legacy, to be removed)
│   ├── cli/
│   │   ├── sessions.ts       # savecontext-sessions CLI
│   │   ├── projects.ts       # savecontext-projects CLI
│   │   ├── embeddings.ts     # savecontext-embeddings CLI
│   │   ├── issues.ts         # savecontext-issues CLI
│   │   ├── plans.ts          # savecontext-plans CLI
│   │   ├── migrate.ts        # savecontext-migrate CLI (cloud→local)
│   │   ├── auth.ts           # savecontext-auth CLI (legacy)
│   │   ├── device-flow.ts    # OAuth device flow (legacy)
│   │   └── setup.ts          # --setup-skill, --setup-statusline
│   ├── database/
│   │   ├── index.ts          # DatabaseManager class
│   │   ├── schema.sql        # SQLite schema
│   │   └── migrations/       # 10 migration files
│   ├── tools/
│   │   └── registry.ts       # Tool definitions (52 MCP tools)
│   ├── lib/
│   │   └── embeddings/
│   │       ├── index.ts      # Provider exports
│   │       ├── factory.ts    # Provider factory
│   │       ├── ollama.ts     # Ollama provider
│   │       ├── huggingface.ts # HuggingFace provider
│   │       ├── transformers.ts # Transformers.js fallback
│   │       └── chunker.ts    # Text chunking
│   ├── types/                # 18 domain type files
│   └── utils/                # Shared utilities
└── dist/                     # Compiled JavaScript
```

### Database Schema

The server uses SQLite with the following schema:

**sessions** - Tracks coding sessions
- `id` (TEXT PRIMARY KEY) - Unique session identifier
- `name` (TEXT) - Session name
- `description` (TEXT) - Optional description
- `channel` (TEXT) - Derived from git branch or session name
- `branch` (TEXT) - Git branch name if available
- `project_path` (TEXT) - Absolute path to project/repository
- `status` (TEXT) - Session state: 'active', 'paused', or 'completed'
- `ended_at` (INTEGER) - Timestamp when paused or completed
- `created_at` (INTEGER) - Timestamp
- `updated_at` (INTEGER) - Timestamp

**context_items** - Stores individual context entries
- `id` (TEXT PRIMARY KEY)
- `session_id` (TEXT) - Foreign key to sessions
- `key` (TEXT) - Unique identifier within session
- `value` (TEXT) - Context content
- `category` (TEXT) - One of: reminder, decision, progress, note
- `priority` (TEXT) - One of: high, normal, low
- `channel` (TEXT) - Channel for filtering
- `size` (INTEGER) - Character count
- `embedding_status` (TEXT) - Embedding state: none, pending, complete, failed
- `embedding_provider` (TEXT) - Which provider generated the embedding
- `embedding_model` (TEXT) - Model used for embedding
- `embedding_dimensions` (INTEGER) - Vector dimensions (768 for Ollama, 384 for Transformers.js)
- `embedded_at` (INTEGER) - Timestamp when embedding was generated
- `created_at` (INTEGER)
- `updated_at` (INTEGER)

**checkpoints** - Session snapshots
- `id` (TEXT PRIMARY KEY)
- `session_id` (TEXT)
- `name` (TEXT)
- `description` (TEXT)
- `item_count` (INTEGER) - Number of items in checkpoint
- `total_size` (INTEGER) - Total character count
- `git_status` (TEXT) - Optional git working tree status
- `git_branch` (TEXT) - Optional git branch
- `created_at` (INTEGER)

**checkpoint_items** - Links checkpoints to context items
- `checkpoint_id` (TEXT)
- `item_id` (TEXT)
- `item_snapshot` (TEXT) - JSON snapshot of context_item

**agent_sessions** - Tracks which agent is currently working on each session
- `agent_id` (TEXT PRIMARY KEY) - Format depends on client type:
  - Coding tools: `{projectName}-{branch}-{provider}` (e.g., `savecontext-main-claude-code`)
  - Desktop apps: `global-{provider}` (e.g., `global-claude-desktop`) - no project/branch since they can't detect working directory
- `session_id` (TEXT) - Foreign key to sessions
- `project_path` (TEXT) - Full project path (or "global" for desktop apps)
- `git_branch` (TEXT) - Git branch name (null for desktop apps)
- `provider` (TEXT) - MCP client provider:
  - Coding tools: claude-code, cursor, windsurf, vscode, jetbrains, cline, copilot, factory-ai, etc.
  - Desktop apps: claude-desktop, perplexity, chatgpt, lm-studio, bolt-ai, raycast
- `last_active_at` (INTEGER) - Timestamp of last activity

This enables multi-agent support: multiple tools can work on the same session simultaneously (e.g., Claude Code and Claude Desktop), each tracked as a separate agent.

**project_memory** - Stores project-specific commands, configs, and notes
- `id` (TEXT PRIMARY KEY)
- `project_path` (TEXT) - Project directory path
- `key` (TEXT) - Unique identifier within project
- `value` (TEXT) - The stored value (command, URL, note, etc.)
- `category` (TEXT) - Type: command, config, or note
- `created_at` (INTEGER)
- `updated_at` (INTEGER)
- UNIQUE constraint on (project_path, key)

Memory persists across sessions and is accessible by all agents working on the project. Useful for storing frequently used commands, API endpoints, deployment instructions, etc.

**vec_context_items** - Vector embeddings for semantic search (sqlite-vec virtual table)
- `item_id` (TEXT PRIMARY KEY) - Foreign key to context_items
- `embedding` (float[768]) - Vector embedding for similarity search

**embeddings_config** - Stores embedding provider configuration
- `id` (TEXT PRIMARY KEY)
- `provider` (TEXT) - Provider name: ollama or transformers
- `model` (TEXT) - Model name (e.g., nomic-embed-text, all-MiniLM-L6-v2)
- `dimensions` (INTEGER) - Vector dimensions
- `endpoint` (TEXT) - API endpoint (for Ollama)
- `created_at` (INTEGER)
- `updated_at` (INTEGER)

**issues** - Issue tracking for managing work across sessions
- `id` (TEXT PRIMARY KEY)
- `short_id` (TEXT) - Human-readable ID (e.g., PROJ-123)
- `project_path` (TEXT) - Project directory path
- `title` (TEXT) - Issue title
- `description` (TEXT) - Optional issue description
- `details` (TEXT) - Implementation details or notes
- `status` (TEXT) - open, in_progress, blocked, closed, or deferred
- `priority` (INTEGER) - 0=lowest, 1=low, 2=medium, 3=high, 4=critical
- `issue_type` (TEXT) - task, bug, feature, epic, or chore
- `parent_id` (TEXT) - Parent issue ID for subtasks
- `created_in_session` (TEXT) - Session ID where issue was created
- `closed_in_session` (TEXT) - Session ID where issue was closed
- `created_at` (INTEGER)
- `updated_at` (INTEGER)
- `closed_at` (INTEGER) - Timestamp when closed
- `deferred_at` (INTEGER) - Timestamp when deferred

Issues are project-scoped and persist across all sessions for that project. Supports hierarchies (Epic > Task > Subtask), labels, and dependencies.

### Channel System

Channels provide automatic organization of context based on git branches:

1. When starting a session, the server checks for the current git branch
2. Branch name is normalized to a channel identifier (e.g., `feature/auth` → `feature-auth`)
3. All context items inherit the session's channel by default
4. Context can be filtered by channel when retrieving

This allows context to be automatically scoped to the current branch without manual tagging.

### Git Integration

The server integrates with git through Node.js child processes:

- **Branch Detection**: Executes `git rev-parse --abbrev-ref HEAD` to get current branch
- **Status Capture**: Executes `git status --porcelain` for checkpoint metadata
- **Graceful Fallback**: Works in non-git directories by skipping git features

Git information is optional and only captured when `include_git: true` is specified.

## Tool Reference

### Session Management

**context_session_start**
```javascript
{
  name: string,           // Required: session name
  description?: string,   // Optional: session description
  channel?: string,       // Optional: override auto-derived channel
  project_path?: string,  // Optional: override auto-detected project path
  force_new?: boolean     // Optional: force new session instead of resuming
}
```
Creates a new session and sets it as active. Auto-derives channel from git branch and detects project path from current working directory. If an active session already exists for the current project, automatically resumes it instead of creating a duplicate. Use `force_new: true` to always create a fresh session (pauses any existing active session so it can be resumed later).

**context_save**
```javascript
{
  key: string,                              // Required: unique identifier
  value: string,                            // Required: context content
  category?: 'reminder'|'decision'|'progress'|'note',  // Default: 'note'
  priority?: 'high'|'normal'|'low',        // Default: 'normal'
  channel?: string                          // Default: session channel
}
```
Saves a context item to the active session.

**context_get**
```javascript
{
  query?: string,              // RECOMMENDED: semantic search by meaning (e.g., "how did we handle auth")
  search_all_sessions?: boolean,  // Search across ALL sessions (default: false)
  threshold?: number,          // Semantic search threshold 0-1, lower = more results (default: 0.5)
  key?: string,                // Exact key to retrieve specific item (bypasses search)
  category?: string,           // Filter by category
  priority?: string,           // Filter by priority
  channel?: string,            // Filter by channel
  limit?: number,              // Default: 100
  offset?: number              // Default: 0
}
```
Retrieves context items with optional filtering. Use `query` for semantic search by meaning, or `key` for exact retrieval.

**context_delete**
```javascript
{
  key: string  // Required: key of the context item to delete
}
```
Deletes a context item from the current session. Use to remove outdated information, fix mistakes, or clean up test data.

Returns:
```javascript
{
  deleted: true,
  key: "item_key",
  session_id: "sess_..."
}
```

**context_update**
```javascript
{
  key: string,                                      // Required: key of item to update
  value?: string,                                   // Optional: new value
  category?: 'reminder'|'decision'|'progress'|'note',  // Optional: new category
  priority?: 'high'|'normal'|'low',                // Optional: new priority
  channel?: string                                  // Optional: new channel
}
```
Updates an existing context item. Change the value, category, priority, or channel of a previously saved item. At least one field to update is required.

Returns:
```javascript
{
  updated: true,
  key: "item_key",
  value: "updated content",
  category: "decision",
  priority: "high",
  channel: "feature-auth",
  updated_at: 1730577600000
}
```

**context_status**

Returns session statistics including item count, size, checkpoint count, status, and compaction recommendations.

Returns:
```javascript
{
  current_session_id: "sess_...",
  session_name: "Implementing Auth",
  channel: "feature-auth",
  project_path: "/Users/you/project",
  status: "active",
  item_count: 47,
  total_size: 12456,
  checkpoint_count: 3,
  last_updated: 1730577600000,  // Unix timestamp in milliseconds
  session_duration_ms: 3600000,  // Time from created_at to ended_at or now
  should_compact: true,
  compaction_reason: "High item count (47 items, recommended: prepare at 40+ items)"
}
```

**context_session_rename**
```javascript
{
  current_name: string,  // Required: current session name (get from context_status)
  new_name: string       // Required: new session name
}
```
Renames the current active session. Requires `current_name` for verification to prevent accidental renames.

**context_list_sessions**
```javascript
{
  search?: string,             // RECOMMENDED: keyword search on name and description
  limit?: number,              // Default: 10
  project_path?: string,       // Optional: filter by project path (defaults to current directory)
  status?: string,             // Optional: 'active', 'paused', 'completed', or 'all'
  include_completed?: boolean  // Default: false
}
```
Lists recent sessions ordered by most recently updated. Use `search` to find sessions by name or description. By default, filters to show only sessions from the current project path and excludes completed sessions.

**context_session_end**

Ends (completes) the current session. Marks the session as completed with a timestamp and clears it as the active session.

Returns:
```javascript
{
  session_id: "sess_...",
  session_name: "Implementing Auth",
  duration_ms: 3600000,
  item_count: 47,
  checkpoint_count: 3,
  total_size: 12456
}
```

**context_session_pause**

Pauses the current session to resume later. Preserves all session state and can be resumed with `context_session_resume`. Use when switching contexts or taking a break.

Returns:
```javascript
{
  session_id: "sess_...",
  session_name: "Implementing Auth",
  resume_instructions: "To resume: use context_session_resume with session_id: sess_..."
}
```

**context_session_resume**
```javascript
{
  session_id: string  // Required: ID of the session to resume
}
```
Resumes a previously paused session. Restores session state and sets it as the active session. Cannot resume completed sessions.

Returns:
```javascript
{
  session_id: "sess_...",
  session_name: "Implementing Auth",
  channel: "feature-auth",
  project_path: "/Users/you/project",
  item_count: 47,
  created_at: 1730577600000
}
```

**context_session_switch**
```javascript
{
  session_id: string  // Required: ID of the session to switch to
}
```
Switches between sessions atomically. Pauses the current session (if any) and resumes the specified session. Use when working on multiple projects.

Returns:
```javascript
{
  previous_session: "Old Session Name",
  current_session: "New Session Name",
  session_id: "sess_...",
  item_count: 23
}
```

**context_session_delete**
```javascript
{
  session_id: string  // Required: ID of the session to delete
}
```
Deletes a session permanently. Cannot delete active sessions (must pause or end first). Cascade deletes all context items and checkpoints. Use to clean up accidentally created sessions.

Returns:
```javascript
{
  session_id: "sess_...",
  session_name: "Old Session"
}
```

**context_session_add_path**
```javascript
{
  project_path?: string  // Optional: defaults to current working directory
}
```
Adds a project path to the current session, enabling sessions to span multiple related directories (e.g., monorepo folders like `/frontend` and `/backend`, or `/app` and `/dashboard`). If the path already exists in the session, returns success without modification. Requires an active session.

Returns:
```javascript
{
  session_id: "sess_...",
  session_name: "Implementing Auth",
  project_path: "/Users/you/project/backend",
  all_paths: ["/Users/you/project/frontend", "/Users/you/project/backend"],
  path_count: 2,
  already_existed: false
}
```

**context_session_remove_path**
```javascript
{
  project_path: string  // Required: path to remove from session
}
```
Removes a project path from the current session. Cannot remove the last path (sessions must have at least one project path). Use to clean up stale paths or paths added by mistake.

Returns:
```javascript
{
  session_id: "sess_...",
  session_name: "Implementing Auth",
  removed_path: "/Users/you/project/old-path",
  remaining_paths: ["/Users/you/project/frontend"],
  path_count: 1
}
```

### Project Memory & Issues

**context_memory_save**
```javascript
{
  key: string,                        // Required: unique identifier within project
  value: string,                      // Required: the value to remember
  category?: 'command'|'config'|'note'  // Default: 'command'
}
```
Saves project memory (command, config, or note) for the current project. Memory persists across all sessions and is accessible by all agents working on this project. Useful for storing frequently used commands, API endpoints, deployment instructions, etc.

If a memory item with the same key already exists, it will be overwritten with the new value.

Returns:
```javascript
{
  success: true,
  memory: {
    id: "mem_...",
    key: "build_command",
    value: "npm run build:prod",
    category: "command",
    project_path: "/Users/you/project"
  },
  message: "Saved memory 'build_command' to project"
}
```

**context_memory_get**
```javascript
{
  key: string  // Required: key of the memory item to retrieve
}
```
Retrieves a specific memory item by key from the current project.

Returns:
```javascript
{
  success: true,
  memory: {
    key: "api_endpoint",
    value: "https://api.example.com/v1",
    category: "config",
    created_at: 1730577600000
  }
}
```

**context_memory_list**
```javascript
{
  category?: 'command'|'config'|'note'  // Optional: filter by category
}
```
Lists all memory items for the current project with optional category filtering.

Returns:
```javascript
{
  success: true,
  memory: [
    {
      key: "test_command",
      value: "npm test -- --coverage",
      category: "command",
      created_at: 1730577600000
    },
    {
      key: "db_url",
      value: "postgresql://localhost:5432/mydb",
      category: "config",
      created_at: 1730577600000
    }
  ],
  count: 2,
  project_path: "/Users/you/project"
}
```

**context_memory_delete**
```javascript
{
  key: string  // Required: key of the memory item to delete
}
```
Deletes a memory item from the current project. Use to remove outdated commands or configurations.

Returns:
```javascript
{
  success: true,
  deleted: true,
  key: "old_command",
  message: "Deleted memory 'old_command' from project"
}
```

**context_issue_create**
```javascript
{
  title: string,                            // Required: issue title
  description?: string,                     // Optional: issue description
  details?: string,                         // Optional: implementation details
  priority?: number,                        // Optional: 0-4 (default: 2=medium)
  issueType?: 'task'|'bug'|'feature'|'epic'|'chore',  // Default: 'task'
  parentId?: string,                        // Optional: parent issue ID for subtasks
  labels?: string[],                        // Optional: labels for categorization
  planId?: string,                          // Optional: link to a plan
  status?: 'open'|'in_progress'|'blocked'|'closed'|'deferred'  // Default: 'open'
}
```
Creates a new issue for the current project. Issues persist across all sessions and are accessible by all agents working on this project. Supports hierarchies (Epic > Task > Subtask), priority levels, labels, and dependencies.

Returns:
```javascript
{
  success: true,
  issue: {
    id: "issue_...",
    shortId: "PROJ-1",
    title: "Implement user authentication",
    description: "Add JWT-based auth with refresh tokens",
    status: "open",
    priority: 2,
    issueType: "feature",
    projectPath: "/Users/you/project",
    createdAt: 1730577600000
  },
  message: "Created issue: Implement user authentication"
}
```

**context_issue_update**
```javascript
{
  id: string,                               // Required: ID of issue to update
  issue_title: string,                      // Required: current title for verification
  title?: string,                           // Optional: new title
  description?: string,                     // Optional: new description
  details?: string,                         // Optional: new implementation details
  status?: 'open'|'in_progress'|'blocked'|'closed'|'deferred',  // Optional: new status
  priority?: number,                        // Optional: new priority (0-4)
  issueType?: 'task'|'bug'|'feature'|'epic'|'chore',  // Optional: new type
  parentId?: string | null,                 // Optional: new parent (null to remove)
  planId?: string | null,                   // Optional: link to plan (null to remove)
  add_project_path?: string,                // Optional: add issue to additional project
  remove_project_path?: string              // Optional: remove issue from project
}
```
Updates an existing issue. Can modify title, description, status, priority, type, parent, or plan link. Supports multi-project issues via `add_project_path`/`remove_project_path`. When changing status to 'closed', automatically sets the `closed_at` timestamp.

Returns:
```javascript
{
  success: true,
  issue: {
    id: "issue_...",
    shortId: "PROJ-1",
    title: "Implement user authentication",
    description: "Add JWT-based auth with refresh tokens",
    status: "closed",
    updatedAt: 1730577600000,
    closedAt: 1730577600000
  },
  message: "Updated issue"
}
```

**context_issue_list**
```javascript
{
  status?: 'open'|'in_progress'|'blocked'|'closed'|'deferred',  // Optional: filter by status
  priority?: number,                        // Optional: filter by exact priority (0-4)
  priority_min?: number,                    // Optional: minimum priority
  priority_max?: number,                    // Optional: maximum priority
  issueType?: 'task'|'bug'|'feature'|'epic'|'chore',  // Optional: filter by type
  parentId?: string,                        // Optional: filter by parent issue
  planId?: string,                          // Optional: filter by plan (issues linked to a plan)
  labels?: string[],                        // Optional: filter by labels (all must match)
  labels_any?: string[],                    // Optional: filter by labels (any must match)
  has_subtasks?: boolean,                   // Optional: filter by has subtasks
  has_dependencies?: boolean,               // Optional: filter by has dependencies
  all_projects?: boolean,                   // Optional: search all projects (default: false)
  sortBy?: 'priority'|'createdAt'|'updatedAt',  // Default: 'createdAt'
  sortOrder?: 'asc'|'desc',                 // Default: 'desc'
  limit?: number                            // Optional: max results
}
```
Lists issues for the current project with filtering and sorting. Use `planId` to find issues linked to a specific plan. Use `all_projects: true` to search across all projects. Returns issues ordered by creation date (newest first) by default.

Returns:
```javascript
{
  success: true,
  issues: [
    {
      id: "issue_...",
      shortId: "PROJ-2",
      title: "Fix login bug",
      description: "Users can't login with special characters in password",
      status: "open",
      priority: 3,
      issueType: "bug",
      createdAt: 1730577600000,
      updatedAt: 1730577600000
    },
    {
      id: "issue_...",
      shortId: "PROJ-1",
      title: "Add password reset",
      status: "closed",
      priority: 2,
      issueType: "feature",
      createdAt: 1730577500000,
      closedAt: 1730577800000
    }
  ],
  count: 2,
  projectPath: "/Users/you/project"
}
```

**context_issue_complete**
```javascript
{
  id: string,          // Required: ID of issue to mark as closed
  issue_title: string  // Required: issue title for verification
}
```
Quick convenience method to mark an issue as closed. Equivalent to `context_issue_update` with `status: 'closed'`, but more concise. Automatically sets the `closed_at` timestamp and unblocks dependent issues.

Returns:
```javascript
{
  success: true,
  issue: {
    id: "issue_...",
    shortId: "PROJ-1",
    title: "Implement user authentication",
    status: "closed",
    closedAt: 1730577600000
  },
  message: "Issue marked as closed"
}
```

**context_issue_claim**
```javascript
{
  issue_ids: string[]  // Required: IDs of issues to claim
}
```
Claim issues for the current agent. Marks them as in_progress and assigns to the current agent. Use for coordinating work across multiple agents.

**context_issue_release**
```javascript
{
  issue_ids: string[]  // Required: IDs of issues to release
}
```
Release claimed issues back to the pool. Unassigns and sets status back to open.

**context_issue_get_ready**
```javascript
{
  limit?: number,                           // Optional: max results (default: 10)
  sortBy?: 'priority'|'createdAt'           // Optional: sort field (default: 'priority')
}
```
Get issues that are ready to work on (open, no blocking dependencies, not assigned to another agent).

**context_issue_get_next_block**
```javascript
{
  count?: number,                           // Optional: number to claim (default: 3)
  priority_min?: number,                    // Optional: minimum priority
  labels?: string[]                         // Optional: filter by labels
}
```
Get next block of ready issues and claim them. Smart issue assignment for agents working through a backlog.

**context_issue_create_batch**
```javascript
{
  issues: [                                 // Required: array of issues to create
    {
      title: string,
      description?: string,
      details?: string,
      priority?: number,
      issueType?: string,
      labels?: string[],
      parentId?: string,                    // Can use "$N" to reference by array index
      planId?: string
    }
  ],
  dependencies?: [                          // Optional: dependencies between issues
    {
      issueIndex: number,                   // Index of issue in array
      dependsOnIndex: number,               // Index of dependency in array
      dependencyType?: 'blocks'|'related'|'parent-child'|'discovered-from'
    }
  ],
  planId?: string                           // Optional: link all issues to a plan
}
```
Create multiple issues at once with dependencies. Useful for breaking down plans into issue hierarchies. Supports referencing other issues in the batch by index.

**context_issue_add_dependency**
```javascript
{
  issueId: string,                          // Required: issue that will have the dependency
  dependsOnId: string,                      // Required: issue it depends on
  dependencyType?: 'blocks'|'related'|'parent-child'|'discovered-from'  // Default: 'blocks'
}
```
Add a dependency between issues. The issue will depend on another issue.

**context_issue_remove_dependency**
```javascript
{
  issueId: string,                          // Required: issue with the dependency
  dependsOnId: string                       // Required: issue it depends on
}
```
Remove a dependency between issues.

**context_issue_add_labels**
```javascript
{
  id: string,                               // Required: issue ID
  labels: string[]                          // Required: labels to add
}
```
Add labels to an issue for categorization.

**context_issue_remove_labels**
```javascript
{
  id: string,                               // Required: issue ID
  labels: string[]                          // Required: labels to remove
}
```
Remove labels from an issue.

**context_issue_delete**
```javascript
{
  id: string,          // Required: ID of issue to delete
  issue_title: string  // Required: issue title for verification
}
```
Delete an issue permanently. Also removes all dependencies. Cannot be undone.

Returns:
```javascript
{
  success: true,
  deleted: true,
  id: "issue_...",
  shortId: "PROJ-1",
  title: "Old issue title"
}
```

### Plan Management

**context_plan_create**
```javascript
{
  title: string,             // Required: plan title
  content: string,           // Required: plan content in markdown
  status?: 'draft'|'active'|'completed',  // Default: 'draft'
  successCriteria?: string,  // Optional: success criteria
  project_path?: string      // Optional: defaults to current directory
}
```
Create a new plan (PRD/specification) for the current project. Plans organize work into epics and tasks.

Returns:
```javascript
{
  success: true,
  plan: {
    id: "plan_...",
    shortId: "PLAN-1",
    title: "User Authentication System",
    status: "draft",
    projectPath: "/Users/you/project",
    createdAt: 1730577600000
  }
}
```

**context_plan_list**
```javascript
{
  status?: 'draft'|'active'|'completed'|'all',  // Default: 'active'
  project_path?: string,     // Optional: filter by project
  limit?: number             // Default: 50
}
```
List plans for the current project with filtering.

**context_plan_get**
```javascript
{
  plan_id: string  // Required: ID of plan to retrieve
}
```
Get details of a specific plan including linked epics and issues.

**context_plan_update**
```javascript
{
  id: string,                // Required: ID of plan to update
  title?: string,            // Optional: new title
  content?: string,          // Optional: new content
  status?: 'draft'|'active'|'completed',  // Optional: new status
  successCriteria?: string   // Optional: new success criteria
}
```
Update a plan's title, content, status, or success criteria.

### Project Management

**context_project_create**
```javascript
{
  project_path: string,      // Required: absolute path to project
  name?: string,             // Optional: display name (defaults to folder name)
  description?: string,      // Optional: project description
  issue_prefix?: string      // Optional: prefix for issue IDs (e.g., "SC" creates SC-1)
}
```
Create a new project. Projects must be created before starting sessions.

**context_project_list**
```javascript
{
  include_session_count?: boolean,  // Default: false
  limit?: number                    // Default: 50
}
```
List all projects with optional session counts.

**context_project_get**
```javascript
{
  project_path: string  // Required: absolute path to project
}
```
Get details of a specific project by path.

**context_project_update**
```javascript
{
  project_path: string,      // Required: absolute path to project
  name?: string,             // Optional: new project name
  description?: string,      // Optional: new description
  issue_prefix?: string      // Optional: new issue prefix
}
```
Update project settings (name, description, issue prefix).

**context_project_delete**
```javascript
{
  project_path: string,      // Required: absolute path to project
  confirm: boolean           // Required: must be true to confirm deletion
}
```
Delete a project and all associated data (issues, plans, memory). Sessions are unlinked but not deleted.

### Checkpoint Management

**context_checkpoint**
```javascript
{
  name: string,                    // Required: checkpoint name
  description?: string,            // Optional: checkpoint description
  include_git?: boolean,           // Default: false
  // Filtering options for selective checkpoints:
  include_tags?: string[],         // Only include items with these tags
  include_keys?: string[],         // Only include keys matching patterns (e.g., ["feature_*"])
  include_categories?: string[],   // Only include these categories
  exclude_tags?: string[]          // Exclude items with these tags
}
```
Creates a named checkpoint of the current session state. Supports selective checkpoints via filters. If `include_git` is true, captures git branch and working tree status.

**context_restore**
```javascript
{
  checkpoint_id: string,           // Required: checkpoint ID to restore
  checkpoint_name: string,         // Required: checkpoint name (for verification)
  // Filtering options for selective restoration:
  restore_tags?: string[],         // Only restore items with these tags
  restore_categories?: string[]    // Only restore items in these categories
}
```
Restores context items from a checkpoint into the current session. Requires both `checkpoint_id` and `checkpoint_name` for verification. Supports selective restoration via filters.

**context_tag**
```javascript
{
  keys?: string[],          // Specific item keys to tag
  key_pattern?: string,     // Wildcard pattern (e.g., "feature_*")
  tags: string[],           // Required: tags to add/remove
  action: 'add' | 'remove'  // Required: add or remove tags
}
```
Tag context items for organization and filtering. Supports tagging by specific keys or wildcard patterns. Use to organize work streams and enable selective checkpoint creation.

**context_checkpoint_add_items**
```javascript
{
  checkpoint_id: string,   // Required: checkpoint to modify
  checkpoint_name: string, // Required: checkpoint name (for verification)
  item_keys: string[]      // Required: keys of items to add
}
```
Add items to an existing checkpoint. Requires both ID and name for verification. Use to incrementally build up checkpoints or add items you forgot to include.

**context_checkpoint_remove_items**
```javascript
{
  checkpoint_id: string,   // Required: checkpoint to modify
  checkpoint_name: string, // Required: checkpoint name (for verification)
  item_keys: string[]      // Required: keys of items to remove
}
```
Remove items from an existing checkpoint. Requires both ID and name for verification. Use to fix checkpoints that contain unwanted items or to clean up mixed work streams.

**context_checkpoint_split**
```javascript
{
  source_checkpoint_id: string,  // Required: checkpoint to split
  source_checkpoint_name: string,  // Required: checkpoint name (for verification)
  splits: [                      // Required: split configurations
    {
      name: string,              // Required: name for new checkpoint
      description?: string,      // Optional: description
      include_tags?: string[],   // Filter by tags
      include_categories?: string[]  // Filter by categories
    }
  ]
}
```
Split a checkpoint into multiple checkpoints based on tags or categories. Requires both ID and name for verification. Use to separate mixed work streams into organized checkpoints.

**Workflow Example: Splitting a Mixed Checkpoint**
```javascript
// Step 1: Get checkpoint details to see all items
context_get_checkpoint({ checkpoint_id: "ckpt_abc123" })
// Returns: { items_preview: [
//   { key: "auth_decision", ... },
//   { key: "ui_component", ... },
//   { key: "auth_impl", ... }
// ]}

// Step 2: Tag items by work stream (use specific keys, not patterns)
context_tag({
  keys: ["auth_decision", "auth_impl"],
  tags: ["auth"],
  action: "add"
})

context_tag({
  keys: ["ui_component"],
  tags: ["ui"],
  action: "add"
})

// Step 3: Split checkpoint using tags
context_checkpoint_split({
  source_checkpoint_id: "ckpt_abc123",
  source_checkpoint_name: "mixed-work-checkpoint",
  splits: [
    {
      name: "auth-work",
      include_tags: ["auth"]  // REQUIRED: must have filters
    },
    {
      name: "ui-work",
      include_tags: ["ui"]    // REQUIRED: must have filters
    }
  ]
})
// Returns warnings if item counts look wrong (0 items or all items)

// Step 4: Delete original mixed checkpoint
context_checkpoint_delete({
  checkpoint_id: "ckpt_abc123",
  checkpoint_name: "mixed-work-checkpoint"
})
```

**context_checkpoint_delete**
```javascript
{
  checkpoint_id: string,    // Required: checkpoint to delete
  checkpoint_name: string   // Required: checkpoint name (for verification)
}
```
Delete a checkpoint permanently. Requires both ID and name for verification. Use to clean up failed, duplicate, or unwanted checkpoints. Cannot be undone.

**context_list_checkpoints**
```javascript
{
  search?: string,              // Keyword search: name, description, session name
  session_id?: string,          // Filter to specific session
  project_path?: string,        // Filter to specific project (default: current)
  include_all_projects?: boolean,  // Show all projects (default: false)
  limit?: number,               // Max results (default: 20)
  offset?: number               // Pagination (default: 0)
}
```
Lightweight checkpoint search with keyword filtering. Returns minimal data to avoid context bloat. Defaults to current project. Use `context_get_checkpoint` to get full details for specific checkpoints.

Returns:
```javascript
{
  checkpoints: [
    {
      id: "ckpt_...",
      name: "before-auth-refactor",
      session_id: "sess_...",
      session_name: "OAuth2 Implementation",
      project_path: "/path/to/project",
      item_count: 23,
      created_at: 1730577600000
    }
  ],
  count: 3,
  total_matches: 15,
  scope: "project",  // "session" | "project" | "all"
  has_more: true
}
```

**context_get_checkpoint**
```javascript
{
  checkpoint_id: string  // Required: checkpoint ID
}
```
Get full details for a specific checkpoint. Returns complete data including description, git status/branch, and preview of top 5 high-priority items. Use after `context_list_checkpoints` to drill down.

Returns:
```javascript
{
  id: "ckpt_...",
  name: "before-auth-refactor",
  description: "Before switching from sessions to JWT",
  session_id: "sess_...",
  session_name: "OAuth2 Implementation",
  project_path: "/path/to/project",
  item_count: 23,
  total_size: 5678,
  git_status: "M auth.ts\nA jwt.ts",
  git_branch: "feature/auth",
  created_at: 1730577600000,
  items_preview: [
    { key: "auth_decision", value: "Use JWT instead of sessions", category: "decision", priority: "high" }
  ]
}
```

**context_prepare_compaction**

Creates an automatic checkpoint and analyzes the session to generate a restoration summary.

Returns:
```javascript
{
  checkpoint: {
    id: "ckpt_...",
    name: "pre-compact-2025-11-02T15-30-00",
    session_id: "sess_...",
    created_at: 1730577600000  // Unix timestamp in milliseconds
  },
  stats: {
    total_items_saved: 47,
    critical_items: 8,
    pending_tasks: 3,
    decisions_made: 12,
    total_size_bytes: 12456
  },
  critical_context: {
    high_priority_items: [
      { key: "auth_method", value: "OAuth2", category: "decision", priority: "high" }
    ],
    next_steps: [
      { key: "task_1", value: "Implement JWT refresh", priority: "high" }
    ],
    key_decisions: [
      { key: "db_choice", value: "PostgreSQL", created_at: 1730577600000 }
    ],
    recent_progress: [
      { key: "progress_1", value: "Completed login flow", created_at: 1730577600000 }
    ]
  },
  restore_instructions: {
    tool: "context_restore",
    checkpoint_id: "ckpt_...",
    message: "To continue this session, restore from checkpoint: pre-compact-2025-11-02T15-30-00",
    summary: "Session has 3 pending tasks and 12 key decisions recorded."
  }
}
```

This tool is designed for AI agents to call proactively when `context_status` indicates high item counts.

## Storage

All data is stored locally at `~/.savecontext/data/savecontext.db`. The database uses WAL mode for better concurrency and reliability.

## Development

```bash
cd server
pnpm install
pnpm build    # Compile TypeScript and copy schema.sql
pnpm dev      # Run with tsx watch for development
pnpm start    # Run compiled version
```

## Contributing

See [CONTRIBUTING.md](https://github.com/greenfieldlabs-inc/savecontext/blob/main/CONTRIBUTING.md) for development guidelines.

## License

AGPL-3.0 - see [LICENSE](https://github.com/greenfieldlabs-inc/savecontext/blob/main/LICENSE). Commercial license available for proprietary use.
