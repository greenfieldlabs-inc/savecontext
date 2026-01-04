# SaveContext

## Overview

MCP server providing persistent memory for AI coding agents.

## Development

```bash
cd server
pnpm install
pnpm build    # Compile TypeScript
pnpm dev      # Run with tsx watch
pnpm test     # Run tests
```

Dashboard:
```bash
cd dashboard
bun install
bun dev       # Runs on port 3333
```

## Database

Local SQLite at `~/.savecontext/data/savecontext.db`

## SaveContext Usage

Use SaveContext MCP tools to track work in this codebase.

### Session Management

```javascript
// Start or resume a session
context_session_start({
  name: "Feature or task description",
  description: "What you're working on"
})

// Check current status
context_status()

// Find previous sessions
context_list_sessions({ search: "auth" })
context_list_sessions({ status: "all" })  // include completed

// Resume a specific session
context_session_resume({
  session_id: "sess_...",
  session_name: "Previous session name"
})

// Rename current session
context_session_rename({
  current_name: "Old name",
  new_name: "Better descriptive name"
})

// Pause (can resume later)
context_session_pause()

// End completely
context_session_end()
```

### Task Tracking

**Create issues for all work items:**

```javascript
// Single issue
context_issue_create({
  title: "Implement feature X",
  description: "Details about the work",
  issueType: "feature",  // task, bug, feature, epic, chore
  priority: 2            // 0=lowest to 4=critical
})

// Epic with subtasks
context_issue_create_batch({
  issues: [
    { title: "Epic: Payment System", issueType: "epic" },
    { title: "Add Stripe integration", parentId: "$0" },
    { title: "Implement checkout flow", parentId: "$0" }
  ]
})

// List issues
context_issue_list({ status: "open" })
context_issue_list({ issueType: "bug", priority_min: 3 })
```

**Workflow:**
1. Create issue for new work
2. `context_issue_claim` to start
3. Implement changes
4. `context_issue_complete` when done

### Saving Context

```javascript
// Decisions - architectural choices
context_save({
  key: "auth-decision",
  value: "Using JWT over sessions - stateless scales better",
  category: "decision",
  priority: "high"
})

// Progress - completed work
context_save({
  key: "login-complete",
  value: "Login flow done with rate limiting",
  category: "progress"
})

// Reminders - TODOs
context_save({
  key: "todo-tests",
  value: "Add integration tests before release",
  category: "reminder"
})

// Notes - gotchas, tips
context_save({
  key: "api-gotcha",
  value: "Webhook endpoint needs raw body, not JSON parsed",
  category: "note"
})
```

### Retrieving Context

```javascript
// Semantic search - find by meaning
context_get({ query: "how did we handle authentication" })

// Search across ALL sessions
context_get({ query: "payment integration", search_all_sessions: true })

// Adjust threshold (lower = more results)
context_get({ query: "database", threshold: 0.3 })

// Filter by category or priority
context_get({ category: "decision" })
context_get({ priority: "high" })

// Get specific item by key
context_get({ key: "auth-decision" })
```

### Checkpoints

```javascript
// Before risky changes
context_checkpoint({
  name: "pre-refactor",
  include_git: true
})

// Find checkpoints
context_list_checkpoints({ search: "refactor" })

// Get full details
context_get_checkpoint({ checkpoint_id: "ckpt_..." })

// Restore
context_restore({
  checkpoint_id: "ckpt_...",
  checkpoint_name: "pre-refactor"
})
```

### Project Memory

Persistent across all sessions:

```javascript
// Save commands, configs, notes
context_memory_save({
  key: "test-cmd",
  value: "npm test -- --coverage",
  category: "command"
})

context_memory_save({
  key: "api-url",
  value: "https://api.example.com",
  category: "config"
})

// Retrieve
context_memory_get({ key: "test-cmd" })
context_memory_list({ category: "command" })
```

### Compaction

When context gets large (40+ items):

```javascript
// Check if compaction needed
context_status()
// Returns: { should_compact: true, ... }

// Prepare for compaction
context_prepare_compaction()
```
