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
  priority: 2,           // 0=lowest to 4=critical
  status: "backlog"      // backlog, open, in_progress, blocked, closed, deferred
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
context_issue_list({ status: "all" })  // Include closed issues

// Date filtering (server computes timestamps)
context_issue_list({ created_in_last_days: 7 })   // Created this week
context_issue_list({ created_in_last_hours: 24 }) // Created today
context_issue_list({ updated_in_last_days: 7 })   // Updated this week
context_issue_list({ updated_in_last_hours: 1 })  // Updated in last hour

// Search and lookup
context_issue_list({ search: "authentication" })  // Search title/description
context_issue_list({ id: "SC-a1b2" })             // Get single issue by ID
```

**Short IDs:** All issue ID parameters accept short IDs like `"SC-a1b2"` or full UUIDs:
```javascript
context_issue_complete({ id: "SC-a1b2", issue_title: "..." })
context_issue_claim({ issue_ids: ["SC-a1b2", "SC-c3d4"] })
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

### Feature Planning with Plans & Issues

**For new features or releases, always create a Plan first:**

```javascript
// Create a plan (PRD/spec)
context_plan_create({
  title: "v0.1.25 Features",
  content: `## Overview
Features for this release...

## Goals
- Feature 1
- Feature 2

## Success Criteria
- All tests pass
- No regressions`,
  status: "active"
})

// List plans
context_plan_list()
context_plan_list({ status: "all" })

// Get plan details with linked epics
context_plan_get({ plan_id: "plan_..." })
```

**Then create epics and issues linked to the plan:**

```javascript
// Create epic with subtasks, all linked to plan
context_issue_create_batch({
  planId: "plan_...",  // Links all issues to plan
  issues: [
    {
      title: "Epic: Duplicate Issues Feature",
      issueType: "epic",
      description: "Allow marking issues as duplicates",
      details: "## Implementation\n- Add duplicate status\n- Add duplicate-of dependency type"
    },
    { title: "Add duplicate status to types", parentId: "$0", issueType: "task" },
    { title: "Update database for duplicate handling", parentId: "$0", issueType: "task" },
    { title: "Add MCP tool for marking duplicates", parentId: "$0", issueType: "task" }
  ],
  dependencies: [
    { issueIndex: 2, dependsOnIndex: 1, dependencyType: "blocks" }
  ]
})
```

**Workflow for feature development:**
1. `context_plan_create` - Create plan with requirements
2. `context_issue_create_batch` - Create epics with subtasks linked to plan
3. `context_issue_update` - Mark epic as `in_progress` before starting work
4. `context_issue_claim` - Claim first task
5. Implement the task
6. `context_issue_complete` - Mark task done
7. Repeat 4-6 for remaining tasks
8. `context_issue_complete` - Mark epic done when all tasks complete
9. `context_plan_update` - Mark plan complete when all epics done
