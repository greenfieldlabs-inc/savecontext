# SaveContext

MCP server for persistent context management across AI coding sessions.

## Overview

SaveContext is a Model Context Protocol (MCP) server that provides stateful session management for AI coding assistants. It solves the problem of context loss when switching between AI tools or when conversations exceed token limits by maintaining persistent storage of decisions, tasks, and session state with checkpoint/restore capabilities.

## Features

- **Session Lifecycle Management**: Full session state management with pause, resume, end, switch, and delete operations
- **Project Isolation**: Automatically filters sessions by project path - only see sessions from your current repository
- **Auto-Resume**: If an active session exists for your project, automatically resume it instead of creating duplicates
- **Session Management**: Organize work by sessions with automatic channel detection from git branches
- **Checkpoints**: Create named snapshots of session state with optional git status capture
- **Checkpoint Search**: Lightweight keyword search across all checkpoints with project/session filtering to find historical decisions
- **Smart Compaction**: Analyze priority items and generate restoration summaries when approaching context limits
- **Channel System**: Automatically derive channels from git branches (e.g., `feature/auth` → `feature-auth`)
- **Local Storage**: SQLite database with WAL mode for fast, reliable persistence
- **Cross-Tool Compatible**: Works with any MCP-compatible client (Claude Code, Cursor, Factory, Codex, Cline, etc.)

## Installation

```bash
git clone https://github.com/greenfieldlabs-inc/savecontext.git
cd savecontext/server
pnpm install
pnpm build
```

## Configuration

Add to your MCP client configuration file:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "node",
      "args": ["/absolute/path/to/savecontext/server/dist/index.js"]
    }
  }
}
```

The server communicates via stdio using the MCP protocol.

## Architecture

### Server Implementation

The MCP server is built on `@modelcontextprotocol/sdk` and provides 16 tools for context management. The server maintains a single active session per connection and stores all data in a local SQLite database.

```
server/
├── src/
│   ├── index.ts              # MCP server with tool handlers
│   ├── database/
│   │   ├── index.ts          # DatabaseManager class
│   │   └── schema.sql        # SQLite schema
│   ├── utils/
│   │   ├── channels.ts       # Channel derivation and normalization
│   │   ├── git.ts            # Git branch and status integration
│   │   └── validation.ts     # Input validation
│   └── types/
│       └── index.ts          # TypeScript type definitions
└── dist/                      # Compiled JavaScript
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
- `category` (TEXT) - One of: task, decision, progress, note
- `priority` (TEXT) - One of: high, normal, low
- `channel` (TEXT) - Channel for filtering
- `size` (INTEGER) - Character count
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
  project_path?: string   // Optional: override auto-detected project path
}
```
Creates a new session and sets it as active. Auto-derives channel from git branch and detects project path from current working directory. If an active session already exists for the current project, automatically resumes it instead of creating a duplicate.

**context_save**
```javascript
{
  key: string,                              // Required: unique identifier
  value: string,                            // Required: context content
  category?: 'task'|'decision'|'progress'|'note',  // Default: 'note'
  priority?: 'high'|'normal'|'low',        // Default: 'normal'
  channel?: string                          // Default: session channel
}
```
Saves a context item to the active session.

**context_get**
```javascript
{
  key?: string,          // Optional: retrieve specific item
  category?: string,     // Optional: filter by category
  priority?: string,     // Optional: filter by priority
  channel?: string,      // Optional: filter by channel
  limit?: number,        // Default: 100
  offset?: number        // Default: 0
}
```
Retrieves context items with optional filtering.

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
  new_name: string  // Required: new session name
}
```
Renames the current active session.

**context_list_sessions**
```javascript
{
  limit?: number,              // Default: 10
  project_path?: string,       // Optional: filter by project path (defaults to current directory)
  status?: string,             // Optional: 'active', 'paused', 'completed', or 'all'
  include_completed?: boolean  // Default: false
}
```
Lists recent sessions ordered by most recently updated. By default, filters to show only sessions from the current project path and excludes completed sessions.

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

### Checkpoint Management

**context_checkpoint**
```javascript
{
  name: string,           // Required: checkpoint name
  description?: string,   // Optional: checkpoint description
  include_git?: boolean   // Default: false
}
```
Creates a named checkpoint of the current session state. If `include_git` is true, captures git branch and working tree status.

**context_restore**
```javascript
{
  checkpoint_id: string  // Required: checkpoint ID to restore
}
```
Restores all context items from a checkpoint into the current session.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT - see [LICENSE](LICENSE)
