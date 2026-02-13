# MCP Tool Reference

Complete reference for all SaveContext MCP tools. The MCP server delegates all operations to the Rust CLI (`sc`) via a bridge pattern.

For CLI usage, see [`cli/README.md`](../cli/README.md). For agent integration patterns, see [`cli/AGENTS.md`](../cli/AGENTS.md).

## Session Management

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
Deletes a context item from the current session.

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
Updates an existing context item. At least one field to update is required.

**context_status**

Returns session statistics including item count, size, checkpoint count, status, and compaction recommendations.

```javascript
// Returns:
{
  current_session_id: "sess_...",
  session_name: "Implementing Auth",
  channel: "feature-auth",
  project_path: "/Users/you/project",
  status: "active",
  item_count: 47,
  total_size: 12456,
  checkpoint_count: 3,
  last_updated: 1730577600000,
  session_duration_ms: 3600000,
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
Lists recent sessions ordered by most recently updated. Use `search` to find sessions by name or description.

**context_session_end**

Ends (completes) the current session. Marks the session as completed with a timestamp.

**context_session_pause**

Pauses the current session to resume later. Preserves all session state.

**context_session_resume**
```javascript
{
  session_id: string  // Required: ID of the session to resume
}
```
Resumes a previously paused session. Cannot resume completed sessions.

**context_session_switch**
```javascript
{
  session_id: string  // Required: ID of the session to switch to
}
```
Switches between sessions atomically. Pauses the current session (if any) and resumes the specified session.

**context_session_delete**
```javascript
{
  session_id: string  // Required: ID of the session to delete
}
```
Deletes a session permanently. Cannot delete active sessions (must pause or end first). Cascade deletes all context items and checkpoints.

**context_session_add_path**
```javascript
{
  project_path?: string  // Optional: defaults to current working directory
}
```
Adds a project path to the current session, enabling sessions to span multiple related directories (monorepos, frontend/backend).

**context_session_remove_path**
```javascript
{
  project_path: string  // Required: path to remove from session
}
```
Removes a project path from the current session. Cannot remove the last path.

## Project Memory

**context_memory_save**
```javascript
{
  key: string,                        // Required: unique identifier within project
  value: string,                      // Required: the value to remember
  category?: 'command'|'config'|'note'  // Default: 'command'
}
```
Saves project memory (command, config, or note). Memory persists across all sessions.

**context_memory_get**
```javascript
{
  key: string  // Required: key of the memory item to retrieve
}
```

**context_memory_list**
```javascript
{
  category?: 'command'|'config'|'note'  // Optional: filter by category
}
```

**context_memory_delete**
```javascript
{
  key: string  // Required: key of the memory item to delete
}
```

## Issue Tracking

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
  status?: 'backlog'|'open'|'in_progress'|'blocked'|'closed'|'deferred'  // Default: 'open'
}
```
Creates a new issue for the current project. Supports hierarchies (Epic > Task > Subtask), priority levels, labels, and dependencies.

**context_issue_update**
```javascript
{
  id: string,                               // Required: ID of issue to update
  issue_title: string,                      // Required: current title for verification
  title?: string,                           // Optional: new title
  description?: string,                     // Optional: new description
  details?: string,                         // Optional: new implementation details
  status?: 'backlog'|'open'|'in_progress'|'blocked'|'closed'|'deferred',
  priority?: number,                        // Optional: new priority (0-4)
  issueType?: 'task'|'bug'|'feature'|'epic'|'chore',
  parentId?: string | null,                 // Optional: new parent (null to remove)
  planId?: string | null,                   // Optional: link to plan (null to remove)
  add_project_path?: string,                // Optional: add issue to additional project
  remove_project_path?: string              // Optional: remove issue from project
}
```
Updates an existing issue. When changing status to 'closed', automatically sets the `closed_at` timestamp.

**context_issue_list**
```javascript
{
  status?: string,                          // Optional: filter by status
  priority?: number,                        // Optional: filter by exact priority (0-4)
  priority_min?: number,                    // Optional: minimum priority
  priority_max?: number,                    // Optional: maximum priority
  issueType?: string,                       // Optional: filter by type
  parentId?: string,                        // Optional: filter by parent issue
  planId?: string,                          // Optional: filter by plan
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
Lists issues for the current project with filtering and sorting.

**context_issue_complete**
```javascript
{
  id: string,          // Required: ID of issue to mark as closed
  issue_title: string  // Required: issue title for verification
}
```
Marks an issue as closed. Automatically sets `closed_at` and unblocks dependent issues.

**context_issue_claim**
```javascript
{
  issue_ids: string[]  // Required: IDs of issues to claim
}
```
Claim issues for the current agent. Sets status to `in_progress` and assigns to the current agent.

**context_issue_release**
```javascript
{
  issue_ids: string[]  // Required: IDs of issues to release
}
```
Release claimed issues back to the pool. Unassigns and sets status back to `open`.

**context_issue_get_ready**
```javascript
{
  limit?: number,                           // Optional: max results (default: 10)
  sortBy?: 'priority'|'createdAt'           // Optional: sort field (default: 'priority')
}
```
Get issues ready to work on (open, no blocking dependencies, not assigned).

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
  issues: [
    {
      title: string,
      description?: string,
      details?: string,
      priority?: number,
      issueType?: string,
      labels?: string[],
      parentId?: string,     // Can use "$N" to reference by array index
      planId?: string
    }
  ],
  dependencies?: [
    {
      issueIndex: number,
      dependsOnIndex: number,
      dependencyType?: 'blocks'|'related'|'parent-child'|'discovered-from'
    }
  ],
  planId?: string            // Optional: link all issues to a plan
}
```
Create multiple issues at once with dependencies. Use `$N` to reference other issues in the batch by index.

**context_issue_add_dependency**
```javascript
{
  issueId: string,
  dependsOnId: string,
  dependencyType?: 'blocks'|'related'|'parent-child'|'discovered-from'  // Default: 'blocks'
}
```

**context_issue_remove_dependency**
```javascript
{
  issueId: string,
  dependsOnId: string
}
```

**context_issue_add_labels**
```javascript
{
  id: string,
  labels: string[]
}
```

**context_issue_remove_labels**
```javascript
{
  id: string,
  labels: string[]
}
```

**context_issue_delete**
```javascript
{
  id: string,          // Required: ID of issue to delete
  issue_title: string  // Required: issue title for verification
}
```
Delete an issue permanently. Also removes all dependencies.

**context_issue_clone**

Clone an existing issue with all its properties.

**context_issue_mark_duplicate**

Mark an issue as a duplicate of another.

## Plan Management

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
Create a new plan (PRD/specification) for the current project.

**context_plan_list**
```javascript
{
  status?: 'draft'|'active'|'completed'|'all',  // Default: 'active'
  project_path?: string,
  limit?: number             // Default: 50
}
```

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
  id: string,
  title?: string,
  content?: string,
  status?: 'draft'|'active'|'completed',
  successCriteria?: string
}
```

## Project Management

**context_project_create**
```javascript
{
  project_path: string,      // Required: absolute path to project
  name?: string,             // Optional: display name (defaults to folder name)
  description?: string,      // Optional: project description
  issue_prefix?: string      // Optional: prefix for issue IDs (e.g., "SC" creates SC-1)
}
```

**context_project_list**
```javascript
{
  include_session_count?: boolean,  // Default: false
  limit?: number                    // Default: 50
}
```

**context_project_get**
```javascript
{
  project_path: string
}
```

**context_project_update**
```javascript
{
  project_path: string,
  name?: string,
  description?: string,
  issue_prefix?: string
}
```

**context_project_delete**
```javascript
{
  project_path: string,
  confirm: boolean           // Required: must be true to confirm
}
```

## Checkpoint Management

**context_checkpoint**
```javascript
{
  name: string,                    // Required: checkpoint name
  description?: string,
  include_git?: boolean,           // Default: false
  include_tags?: string[],         // Only include items with these tags
  include_keys?: string[],         // Only include keys matching patterns
  include_categories?: string[],
  exclude_tags?: string[]
}
```
Creates a named checkpoint of the current session state. Supports selective checkpoints via filters.

**context_restore**
```javascript
{
  checkpoint_id: string,
  checkpoint_name: string,         // For verification
  restore_tags?: string[],
  restore_categories?: string[]
}
```
Restores context items from a checkpoint into the current session.

**context_tag**
```javascript
{
  keys?: string[],          // Specific item keys to tag
  key_pattern?: string,     // Wildcard pattern (e.g., "feature_*")
  tags: string[],
  action: 'add' | 'remove'
}
```
Tag context items for organization and filtering.

**context_checkpoint_add_items**
```javascript
{
  checkpoint_id: string,
  checkpoint_name: string,
  item_keys: string[]
}
```

**context_checkpoint_remove_items**
```javascript
{
  checkpoint_id: string,
  checkpoint_name: string,
  item_keys: string[]
}
```

**context_checkpoint_split**
```javascript
{
  source_checkpoint_id: string,
  source_checkpoint_name: string,
  splits: [
    {
      name: string,
      description?: string,
      include_tags?: string[],
      include_categories?: string[]
    }
  ]
}
```
Split a checkpoint into multiple checkpoints based on tags or categories.

**context_checkpoint_delete**
```javascript
{
  checkpoint_id: string,
  checkpoint_name: string    // For verification
}
```

**context_list_checkpoints**
```javascript
{
  search?: string,
  session_id?: string,
  project_path?: string,
  include_all_projects?: boolean,
  limit?: number,            // Default: 20
  offset?: number
}
```
Lightweight checkpoint search with keyword filtering.

**context_get_checkpoint**
```javascript
{
  checkpoint_id: string
}
```
Get full checkpoint details including item previews and git status.

**context_prepare_compaction**

Creates an automatic checkpoint and analyzes the session to generate a restoration summary. Designed for AI agents to call proactively when `context_status` indicates high item counts.

Returns critical context (high-priority items, pending tasks, key decisions, recent progress) and restore instructions.
