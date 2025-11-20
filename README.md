# SaveContext

MCP server for persistent context management across AI coding sessions.

## Overview

SaveContext is a Model Context Protocol (MCP) server that provides stateful session management for AI coding assistants. It solves the problem of context loss when switching between AI tools or when conversations exceed token limits by maintaining persistent storage of decisions, tasks, and session state with checkpoint/restore capabilities.

## Features

- **Multi-Agent Support**: Run multiple CLI/IDE instances simultaneously with agent-scoped session tracking
- **Automatic Provider Detection**: Detects MCP client via protocol handshake (Claude Code, Cursor, Cline, Factory.ai, Codex CLI, etc.)
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

## Configuration

Add to your MCP client configuration file (Claude Code, Cursor, Cline, etc.):

**Local Mode (Default - Free)**

Uses local SQLite database at `~/.savecontext/data/savecontext.db`:

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

> **Note**: Compaction settings are experimental. See [Compaction Settings](#compaction-settings) for configuration options.

**Cloud Mode (SaveContext Cloud)**

Uses cloud API with your account at [savecontext.dev](https://savecontext.dev):

```json
{
  "mcpServers": {
    "savecontext": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"],
      "env": {
        "SAVECONTEXT_API_KEY": "sk_your_api_key_here"
      }
    }
  }
}
```

**From Source (Development)**

If running from a local clone with a local cloud API:

```json
{
  "mcpServers": {
    "savecontext": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/savecontext/server/dist/index.js"],
      "env": {
        "SAVECONTEXT_API_KEY": "sk_your_api_key_here",
        "SAVECONTEXT_BASE_URL": "http://localhost:3001"
      }
    }
  }
}
```

For local-only development (no cloud API), omit both `SAVECONTEXT_API_KEY` and `SAVECONTEXT_BASE_URL`.

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

#### Cloud Mode (SaveContext Cloud)

SaveContext supports two modes of operation:

**Local Mode (Default - Free)**
- Uses local SQLite database (`~/.savecontext/data/savecontext.db`)
- All data stored on your machine
- No rate limits or usage restrictions
- No account required
- Open source and self-hosted

**Cloud Mode (SaveContext Cloud - Paid Plans)**
- Uses PostgreSQL-backed cloud API at [savecontext.dev](https://savecontext.dev)
- Session data synced to cloud storage
- Access sessions from multiple devices
- Automatic backups and disaster recovery
- Advanced analytics dashboard (coming soon)
- Team collaboration features (coming soon)
- Requires API key from SaveContext Cloud account

**Configuring Cloud Mode:**

After signing up at [savecontext.dev](https://savecontext.dev) and obtaining your API key:

```json
{
  "mcpServers": {
    "savecontext": {
      "command": "npx",
      "args": ["-y", "@savecontext/mcp"],
      "env": {
        "SAVECONTEXT_API_KEY": "sk_your_api_key_here",
        "SAVECONTEXT_BASE_URL": "https://mcp.savecontext.dev",
        "SAVECONTEXT_COMPACTION_THRESHOLD": "85",
        "SAVECONTEXT_COMPACTION_MODE": "remind"
      }
    }
  }
}
```

**Environment Variables:**

- `SAVECONTEXT_API_KEY` - Your API key from SaveContext Cloud (format: `sk_*`)
  - If present: enables cloud mode
  - If absent: uses local SQLite mode
- `SAVECONTEXT_BASE_URL` - Cloud API endpoint (default: `https://mcp.savecontext.dev`)
  - For development: `http://localhost:3001`
  - For production: `https://mcp.savecontext.dev`

**How Cloud Mode Works:**

When an API key is provided, the MCP server acts as a lightweight proxy:

```
MCP Client (Claude Desktop, etc.)
    ↓ stdio
Local MCP Server Process
    ↓ HTTPS (if API key present)
SaveContext Cloud API (PostgreSQL)
```

The server detects the mode at startup and routes all operations accordingly. All tool calls work identically in both modes - the only difference is where data is stored.

**Migrating Local Data to Cloud:**

If you have existing local data and want to migrate it to SaveContext Cloud, use the migration CLI:

```bash
# Using npx (recommended)
npx -y @savecontext/mcp migrate <api-key>

# Or with environment variable
SAVECONTEXT_API_KEY=sk_your_key npx -y @savecontext/mcp migrate

# If installed globally
savecontext-migrate <api-key>
```

The migration tool will:
1. Check if your cloud account is empty (migration only works for new accounts)
2. Read your local SQLite database
3. Upload all sessions, context items, checkpoints, project memory, and tasks
4. Validate against your tier limits before migrating

**Important Notes:**
- Migration is one-time only - it requires an empty cloud account
- Your local data is preserved after migration
- Tier limits are enforced server-side (Free: 150 items/5 projects, Pro: 10k items/10 projects)

**New Files Added for Cloud Support:**

- `src/cloud-client.ts` - HTTP client for cloud API communication with Bearer token authentication
- `src/cli/migrate.ts` - Migration CLI for local to cloud data transfer
- `src/types/index.ts` - Complete type definitions shared between local and cloud modes

All validation, type safety, and MCP protocol handling remains consistent across both modes.

## Architecture

### Server Implementation

The MCP server is built on `@modelcontextprotocol/sdk` and provides 32 tools for context management, including session lifecycle, memory storage, task management, and checkpoints. The server maintains a single active session per connection and stores data either in a local SQLite database (local mode) or via cloud API (cloud mode).

```
server/
├── src/
│   ├── index.ts              # MCP server with tool handlers
│   ├── cloud-client.ts       # HTTP client for cloud API
│   ├── cli/
│   │   └── migrate.ts        # Migration CLI for local to cloud
│   ├── database/
│   │   ├── index.ts          # DatabaseManager class
│   │   └── schema.sql        # SQLite schema
│   ├── utils/
│   │   ├── channels.ts       # Channel derivation and normalization
│   │   ├── git.ts            # Git branch and status integration
│   │   ├── project.ts        # Project path utilities
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

**agent_sessions** - Tracks which agent is currently working on each session
- `agent_id` (TEXT PRIMARY KEY) - Format: `{projectName}-{branch}-{provider}` (e.g., `savecontext-main-claude-code`)
- `session_id` (TEXT) - Foreign key to sessions
- `project_path` (TEXT) - Full project path
- `git_branch` (TEXT) - Git branch name
- `provider` (TEXT) - MCP client provider (claude-code, factory-ai, cursor, cline, etc.)
- `last_active_at` (INTEGER) - Timestamp of last activity

This enables multi-agent support: multiple tools can work on the same session simultaneously (e.g., Claude Code and Factory.ai), each tracked as a separate agent.

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

**tasks** - Simple task management for tracking work across sessions
- `id` (TEXT PRIMARY KEY)
- `project_path` (TEXT) - Project directory path
- `title` (TEXT) - Task title
- `description` (TEXT) - Optional task description
- `status` (TEXT) - todo or done
- `created_at` (INTEGER)
- `updated_at` (INTEGER)
- `completed_at` (INTEGER) - Timestamp when marked done

Tasks are project-scoped and persist across all sessions for that project.

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
  category?: 'task'|'decision'|'progress'|'note',  // Optional: new category
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

### Project Memory & Tasks

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

**context_task_create**
```javascript
{
  title: string,         // Required: task title
  description?: string   // Optional: task description
}
```
Creates a new task for the current project. Tasks persist across all sessions and are accessible by all agents working on this project. Simple todo/done status tracking.

Returns:
```javascript
{
  success: true,
  task: {
    id: "task_...",
    title: "Implement user authentication",
    description: "Add JWT-based auth with refresh tokens",
    status: "todo",
    project_path: "/Users/you/project",
    created_at: 1730577600000
  },
  message: "Created task: Implement user authentication"
}
```

**context_task_update**
```javascript
{
  task_id: string,       // Required: ID of task to update
  title?: string,        // Optional: new title
  description?: string,  // Optional: new description
  status?: 'todo'|'done' // Optional: new status
}
```
Updates an existing task. Can modify title, description, or status. At least one field to update is required. When marking a task as 'done', automatically sets the `completed_at` timestamp.

Returns:
```javascript
{
  success: true,
  task: {
    id: "task_...",
    title: "Implement user authentication",
    description: "Add JWT-based auth with refresh tokens",
    status: "done",
    updated_at: 1730577600000,
    completed_at: 1730577600000
  },
  message: "Updated task"
}
```

**context_task_list**
```javascript
{
  status?: 'todo'|'done'|'all'  // Optional: filter by status (default: 'all')
}
```
Lists tasks for the current project with optional status filtering. Returns tasks ordered by creation date (newest first).

Returns:
```javascript
{
  success: true,
  tasks: [
    {
      id: "task_...",
      title: "Fix login bug",
      description: "Users can't login with special characters in password",
      status: "todo",
      created_at: 1730577600000,
      updated_at: 1730577600000
    },
    {
      id: "task_...",
      title: "Add password reset",
      status: "done",
      created_at: 1730577500000,
      completed_at: 1730577800000
    }
  ],
  count: 2,
  project_path: "/Users/you/project"
}
```

**context_task_complete**
```javascript
{
  task_id: string  // Required: ID of task to mark as done
}
```
Quick convenience method to mark a task as done. Equivalent to `context_task_update` with `status: 'done'`, but more concise. Automatically sets the `completed_at` timestamp.

Returns:
```javascript
{
  success: true,
  task: {
    id: "task_...",
    title: "Implement user authentication",
    status: "done",
    completed_at: 1730577600000
  },
  message: "Task marked as done"
}
```

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
  // Filtering options for selective restoration:
  restore_tags?: string[],         // Only restore items with these tags
  restore_categories?: string[]    // Only restore items in these categories
}
```
Restores context items from a checkpoint into the current session. Supports selective restoration via filters.

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
  item_keys: string[]      // Required: keys of items to add
}
```
Add items to an existing checkpoint. Use to incrementally build up checkpoints or add items you forgot to include.

**context_checkpoint_remove_items**
```javascript
{
  checkpoint_id: string,   // Required: checkpoint to modify
  item_keys: string[]      // Required: keys of items to remove
}
```
Remove items from an existing checkpoint. Use to fix checkpoints that contain unwanted items or to clean up mixed work streams.

**context_checkpoint_split**
```javascript
{
  source_checkpoint_id: string,  // Required: checkpoint to split
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
Split a checkpoint into multiple checkpoints based on tags or categories. Use to separate mixed work streams into organized checkpoints.

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
context_checkpoint_delete({ checkpoint_id: "ckpt_abc123" })
```

**context_checkpoint_delete**
```javascript
{
  checkpoint_id: string  // Required: checkpoint to delete
}
```
Delete a checkpoint permanently. Use to clean up failed, duplicate, or unwanted checkpoints. Cannot be undone.

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
