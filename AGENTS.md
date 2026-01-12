# Agent Guidelines

Template for AI coding agents. Copy this to your project.

## Conversation Start Protocol

**ALWAYS start with session management before any work:**

```javascript
// 1. Start or resume session (required for all work)
context_session_start({
  name: "descriptive-task-name",
  description: "What you're working on"
})

// 2. Check current status
context_status()

// 3. Review high-priority context
context_get({ priority: "high" })

// 4. Check for existing issues/tasks
context_issue_list({ status: "open" })
```

## Operating Standards

### When to Create Issues vs Context Saves

| Use Case | Tool |
|----------|------|
| Bug fixes, features, tasks with status tracking | `context_issue_create` |
| Multi-step work (even 2-3 steps) | `context_issue_create` |
| Work another agent should pick up | `context_issue_create` |
| Tasks with dependencies | `context_issue_create` |
| Architectural decisions | `context_save category="decision"` |
| Quick notes for current session | `context_save category="note"` |
| Inline TODOs (current session only) | `context_save category="reminder"` |
| Progress updates | `context_save category="progress"` |

**Rule:** If it needs status tracking or could be picked up by another agent, use `context_issue_create`. If it's context for the current session, use `context_save`.

### Status Update Cadence

- **After completing a task:** Mark issue complete, save progress
- **Every 10-15 messages:** Check `context_status()` for compaction needs
- **Before risky operations:** Create checkpoint
- **Before ending session:** Save current state and next steps

### Claim Before Work

**Never implement without claiming first:**
```javascript
// Wrong - working without tracking
// ... start coding ...

// Right - claim then work
context_issue_claim({ issue_ids: ["ISSUE-ID"] })
// ... now implement ...
context_issue_complete({ id: "ISSUE-ID", issue_title: "..." })
```

### Update Issues with Implementation Details

**Always update issues with verified implementation details after completing work:**

```javascript
context_issue_update({
  id: "ISSUE-ID",
  issue_title: "Add date filtering to user list",
  details: `## Summary
Added relative time filters to user list API.

## Implementation
- Added created_in_last_days, created_in_last_hours params
- Created src/utils/time.ts with relativeToAbsoluteTime()
- Updated database query to filter by timestamp

## Files Modified
- src/api/users.ts
- src/utils/time.ts (new)
- src/db/queries.ts`
})
```

**Requirements:**
- Update issues when implementation approach changes from original plan
- Include verified details (what you actually did, not what you planned)
- Add short summary at top of details
- List files modified with brief description of changes

---

## Planning Before Implementation

**When to create a Plan:** Multi-task features, releases, or work spanning 5+ issues. Not needed for single bugs, simple tasks, or quick fixes.

**For single tasks:** Just create an issue and claim it.

**For multi-task work:** Create a Plan first.

When asked to implement a new feature, release, or multi-task work:

1. **Create a Plan** - Use `context_plan_create` before any code changes
2. **Create Epics** - Break work into epics with `context_issue_create_batch`
3. **Link to Plan** - All issues must have `planId` linking to the plan
4. **Present Plan** - Show the user the structured plan before implementing
5. **Work Issues** - Claim and complete issues systematically

### Plan-First Workflow

```javascript
// 1. Create the plan
context_plan_create({
  title: "v0.1.25 Features",
  content: `## Overview
Features for this release...

## Priority Order
1. Feature A (highest)
2. Feature B
3. Feature C (backlog)

## Success Criteria
- All tests pass
- No regressions`,
  status: "active"
})

// 2. Create epics with tasks linked to plan
context_issue_create_batch({
  planId: "plan_...",  // Links all issues to plan
  issues: [
    {
      title: "Epic: Feature A",
      issueType: "epic",
      description: "User-facing summary",
      details: "## Files to Modify\n- file1.ts\n- file2.ts\n\n## Implementation\n1. Step one\n2. Step two"
    },
    { title: "Add X to types", parentId: "$0", issueType: "task" },
    { title: "Update database for X", parentId: "$0", issueType: "task" },
    { title: "Add MCP tool for X", parentId: "$0", issueType: "task" }
  ],
  dependencies: [
    { issueIndex: 2, dependsOnIndex: 1, dependencyType: "blocks" },
    { issueIndex: 3, dependsOnIndex: 2, dependencyType: "blocks" }
  ]
})

// 3. Present plan to user for approval before implementing
```

### Epic Execution Workflow

When starting work on an epic:

```javascript
// 1. Mark epic as in_progress FIRST
context_issue_update({
  id: "epic-id",
  issue_title: "Epic: Feature A",
  status: "in_progress"
})

// 2. Then claim the first task
context_issue_claim({ issue_ids: ["task-id"] })

// 3. Implement the task
// ... do the work ...

// 4. Complete the task
context_issue_complete({ id: "task-id", issue_title: "Add X to types" })

// 5. Claim next task, repeat until epic is done

// 6. Mark epic as closed when all tasks complete
context_issue_complete({ id: "epic-id", issue_title: "Epic: Feature A" })
```

### What NOT to Do

**Session Management:**
- Do NOT start work without calling `context_session_start`
- Do NOT ignore `context_status()` - check periodically for compaction needs

**Issue Tracking:**
- Do NOT implement without claiming issues first
- Do NOT skip creating issues for trackable work
- Do NOT claim tasks without marking the parent epic as in_progress first
- Do NOT complete issues without updating details with verified implementation
- Do NOT leave stale details when implementation changes from plan

**Planning (for multi-task work):**
- Do NOT start multi-task features without a Plan in SaveContext
- Do NOT use markdown files in .claude/plans as the primary plan source
- Do NOT create issues for features/releases without linking to a plan
- Do NOT skip the epic structure for 5+ issue work

**Context Saves:**
- Do NOT save code snippets (they're in the codebase)
- Do NOT save temporary debugging info
- Do NOT use vague keys like "note1" or "decision"

---

## SaveContext

Use SaveContext MCP tools to maintain context across sessions.

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
