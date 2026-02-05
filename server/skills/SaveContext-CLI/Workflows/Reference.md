# SaveContext CLI Reference

Complete command reference for the `sc` CLI tool.

All commands support `--json` for structured JSON output and `--db <path>` for custom database path.

> **ALWAYS USE MARKDOWN:** When saving context, creating issues, or adding descriptions — use proper markdown formatting (headers, bullets, bold, code blocks). Well-structured content is essential for useful restoration.

## When to Use SaveContext

Use SaveContext when:
- Work spans multiple sessions or days
- Making architectural decisions worth remembering
- Approaching context limits (40+ messages)
- Switching between tasks or branches
- Collaborating with multiple agents on the same project

Do NOT use for:
- Single-session quick fixes
- Information already in the codebase
- Temporary debugging notes

## Session Naming

**Good:** `"v0.1.26-features"`, `"implementing-oauth2-auth"`, `"fixing-payment-bug"`
**Bad:** `"session 1"`, `"work"`, `"stuff"`

## Compound Workflows

When user requests compound actions, execute these sequences automatically.

### Wrap Up Session
**Triggers:** "wrap up", "end of day", "checkpoint everything"

```bash
# 1. Save progress
sc save "wrapup-$(date +%Y%m%d)" "## Session Summary
**Completed:** [list items]
**Next:** [next steps]" -c progress

# 2. Tag recent items (optional)
sc tag add "feature-name" --keys "item1,item2"

# 3. Checkpoint
sc checkpoint create "wrapup-$(date +%Y-%m-%d)" --include-git

# 4. Pause
sc session pause
```

### Resume Fully
**Triggers:** "resume fully", "pick up where I left off and show status"

```bash
# 1. Find and resume session
sc session list --search "topic"
sc session resume <session_id>

# 2. Load full context
sc status
sc get -P high --json
sc get -c reminder --json
```

### Checkpoint with Tags
**Triggers:** "checkpoint with tags", "tag and checkpoint"

```bash
# 1. Review items
sc get --json

# 2. Tag items
sc tag add "feature-name" --keys "item1,item2"

# 3. Create checkpoint FILTERED to those tags
sc checkpoint create "feature-complete" --tags "feature-name"
```

**Important:** Without `--tags`, the checkpoint captures ALL session items. Always filter when checkpointing after tagging.

### Prepare for Handoff
**Triggers:** "prepare for handoff", "hand off to another agent"

```bash
# 1. Save final progress
sc save "handoff-summary" "## Handoff Notes
**State:** [current state]
**Next:** [what receiving agent should do]
**Watch out:** [gotchas]" -c progress -p high

# 2. Tag and checkpoint
sc tag add "handoff" --pattern "*"
sc checkpoint create "handoff-ready" --include-git

# 3. Report: session name, checkpoint ID, key context
```

## What to Save

### Categories

| Category | Use For | Example |
|----------|---------|---------|
| `decision` | Architectural choices, library selections | "Chose JWT over sessions for stateless scaling" |
| `progress` | What was completed, current state | "Auth login flow complete. Refresh tokens next." |
| `reminder` | Current work items, next steps | "TODO: Add rate limiting to token endpoint" |
| `note` | Reference info, gotchas, discoveries | "Stripe webhooks fail if body parsed as JSON first" |

### Issues vs Context Reminders

| Use Case | Command |
|----------|---------|
| Quick inline TODOs for current session | `sc save -c reminder` |
| Feature requests, bugs, enhancements | `sc issue create` |
| Work needing status tracking | `sc issue create` |
| Tasks with dependencies | `sc issue create` |
| Trackable across sessions | `sc issue create` |

**Rule:** If another agent or future session should track it to completion, use `sc issue create`. If it's a quick reminder for the current session only, use `sc save -c reminder`.

### Priorities

| Priority | Use For |
|----------|---------|
| `high` | Critical decisions, blockers, must-remember info |
| `normal` | Standard progress and notes (default) |
| `low` | Nice-to-have context, minor details |

### Formatting Templates

**Decisions:**
```
## [Decision Title]

**Choice:** [What was decided]
**Rationale:** [Why]
**Trade-offs:** [What we gave up]
**Impact:** [Files/components affected]
```

**Progress:**
```
## [Task] - [Status]

**Completed:**
- Item 1
- Item 2

**Current state:** [Where things stand]
**Next:** [Immediate next action]
**Files touched:** [List]
```

**Notes/Gotchas:**
```
## [Topic] Gotcha

**Problem:** [What goes wrong]
**Solution:** [How to fix]
**File:** [Where the fix lives]
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON (recommended for parsing) |
| `--format <fmt>` | Output format: json, csv, table |
| `--db <path>` | Custom database path |
| `--actor <name>` | Set actor/agent name |
| `--session <id>` | Use specific session ID |
| `--silent` | Minimal output (IDs only for create/mutate) |
| `--dry-run` | Preview mutations without writing |
| `--no-color` | Disable colored output |
| `-v, -vv, -vvv` | Verbosity: info, debug, trace |
| `-q, --quiet` | Suppress non-error output |

---

## Session Management

### `sc session start <name>`
Start a new session.

```bash
sc session start "auth-feature" -d "Implementing JWT authentication"
sc session start "v0.1.26" -d "Release planning" -p /path/to/project
```

| Flag | Description |
|------|-------------|
| `-d, --description <text>` | Session description |
| `-p, --project <path>` | Project path |

### `sc session list`
List sessions.

```bash
sc session list                          # Active sessions
sc session list --search "auth"          # Search by name/description
sc session list -s all                   # Include completed
sc session list -l 5                     # Limit results
sc session list --all-projects           # All projects
```

| Flag | Description |
|------|-------------|
| `-s, --status <status>` | Filter: active, paused, completed, all |
| `-l, --limit <n>` | Max results |
| `--search <query>` | Search name and description |
| `--project <path>` | Filter by project |
| `--all-projects` | Show all projects |

### `sc session resume <id>`
Resume a paused session.

```bash
sc session resume sess_abc123
```

### `sc session pause`
Pause the current session.

```bash
sc session pause
```

### `sc session end`
End the current session (marks as completed).

```bash
sc session end
```

### `sc session switch <id>`
Switch to a different session (pauses current).

```bash
sc session switch sess_def456
```

### `sc session rename <new-name>`
Rename the current session.

```bash
sc session rename "better-description"
```

### `sc session delete <id>`
Delete a session permanently.

```bash
sc session delete sess_abc123 --force
```

### `sc session add-path`
Add a project path to a session.

```bash
sc session add-path -i sess_abc123 /path/to/add
```

### `sc session remove-path`
Remove a project path from a session.

```bash
sc session remove-path -i sess_abc123 /path/to/remove
```

---

## Context Items

### `sc save <key> <value>`
Save a context item.

```bash
sc save "auth-decision" "Using JWT for stateless auth" -c decision -p high
sc save "todo-tests" "Add integration tests before release" -c reminder
sc save "api-gotcha" "Webhook endpoint needs raw body" -c note
```

| Flag | Description |
|------|-------------|
| `-c, --category <cat>` | decision, progress, reminder, note |
| `-p, --priority <pri>` | high, normal, low |

### `sc get`
Retrieve context items.

```bash
sc get -s "how did we handle auth"        # Semantic search
sc get -k "auth-decision"                  # Exact key lookup
sc get -c decision -P high                 # Filter by category + priority
sc get -l 5                                # Limit results
```

| Flag | Description |
|------|-------------|
| `-s, --search <query>` | Semantic search query |
| `-k, --key <key>` | Exact key lookup |
| `-c, --category <cat>` | Filter by category |
| `-P, --priority <pri>` | Filter by priority (capital P) |
| `-l, --limit <n>` | Max results |

### `sc update <key>`
Update an existing context item.

```bash
sc update "auth-decision" --value "Switched to OAuth2" -c decision -p high
```

| Flag | Description |
|------|-------------|
| `--value <text>` | New value |
| `-c, --category <cat>` | New category |
| `-p, --priority <pri>` | New priority |
| `--channel <chan>` | New channel |

### `sc delete <key>`
Delete a context item.

```bash
sc delete "outdated-note"
```

### `sc tag <add|remove> <tags...>`
Tag context items.

```bash
sc tag add "auth-feature" --keys "decision-jwt,progress-login"
sc tag remove "old-tag" --pattern "prefix_*"
```

| Flag | Description |
|------|-------------|
| `--keys <k1,k2,...>` | Specific item keys |
| `--pattern <glob>` | Key pattern with wildcards |

---

## Status

### `sc status`
Get current session and project status.

```bash
sc status
sc status --json
```

Returns: session info, project path, git branch, item count, high-priority count.

---

## Checkpoints

### `sc checkpoint create <name>`
Create a checkpoint snapshot.

```bash
sc checkpoint create "pre-refactor" --include-git
sc checkpoint create "auth-checkpoint" -d "Auth decisions" --tags "auth"
sc checkpoint create "selective" --categories "decision,progress"
```

| Flag | Description |
|------|-------------|
| `-d, --description <text>` | Checkpoint description |
| `--include-git` | Include git status |
| `--categories <c1,c2>` | Only include these categories |
| `--tags <t1,t2>` | Only include items with these tags |
| `--exclude-tags <t1,t2>` | Exclude items with these tags |
| `--keys <k1,k2>` | Only include specific keys |

### `sc checkpoint list`
List checkpoints.

```bash
sc checkpoint list
sc checkpoint list -s "refactor"
sc checkpoint list --all-projects
```

| Flag | Description |
|------|-------------|
| `-s, --search <query>` | Search checkpoints |
| `-l, --limit <n>` | Max results |
| `--offset <n>` | Pagination offset |
| `--session <id>` | Filter by session |
| `--project <path>` | Filter by project |
| `--all-projects` | Include all projects |

### `sc checkpoint show <id>`
Get checkpoint details.

```bash
sc checkpoint show ckpt_abc123 --json
```

### `sc checkpoint restore <id>`
Restore from a checkpoint.

```bash
sc checkpoint restore ckpt_abc123
sc checkpoint restore ckpt_abc123 --categories "decision"
sc checkpoint restore ckpt_abc123 --tags "auth"
```

| Flag | Description |
|------|-------------|
| `--categories <c1,c2>` | Only restore these categories |
| `--tags <t1,t2>` | Only restore items with these tags |

### `sc checkpoint delete <id>`
Delete a checkpoint.

```bash
sc checkpoint delete ckpt_abc123
```

### `sc checkpoint add-items <id> <keys...>`
Add items to a checkpoint.

```bash
sc checkpoint add-items ckpt_abc123 key1 key2
```

### `sc checkpoint remove-items <id> <keys...>`
Remove items from a checkpoint.

```bash
sc checkpoint remove-items ckpt_abc123 key1 key2
```

### `sc checkpoint split <id>`
Split a checkpoint by tags/categories.

```bash
sc checkpoint split ckpt_abc123 --json-input '[
  { "name": "auth-items", "includeTags": ["auth"] },
  { "name": "ui-items", "includeTags": ["ui"] }
]'
```

---

## Memory (Persistent Across Sessions)

### `sc memory save <key> <value>`
Save persistent memory.

```bash
sc memory save "test-cmd" "npm test -- --coverage" -c command
sc memory save "api-url" "https://api.example.com" -c config
sc memory save "deploy-note" "Always run migrations first" -c note
```

| Flag | Description |
|------|-------------|
| `-c, --category <cat>` | command, config, note |

### `sc memory get <key>`
Get a memory item.

```bash
sc memory get "test-cmd"
```

### `sc memory list`
List all memory items.

```bash
sc memory list
sc memory list -c command
```

### `sc memory delete <key>`
Delete a memory item.

```bash
sc memory delete "old-config"
```

---

## Issues

### `sc issue create <title>`
Create an issue.

```bash
sc issue create "Add rate limiting" -t feature -p 3 -d "Prevent abuse"
sc issue create "Fix Safari bug" -t bug -p 4 --parent SC-epic1 -l "frontend,urgent"
```

| Flag | Description |
|------|-------------|
| `-d, --description <text>` | Issue description |
| `--details <text>` | Implementation details |
| `-t, --type <type>` | bug, feature, task, epic, chore |
| `-p, --priority <0-4>` | 0=lowest, 4=critical |
| `--parent <id>` | Parent issue ID |
| `--plan-id <id>` | Link to a plan |
| `-l, --labels <l1,l2>` | Comma-separated labels |

### `sc issue list`
List issues with filtering.

```bash
sc issue list                              # Open issues
sc issue list -s all                       # All including closed
sc issue list -t bug --priority-min 3      # High-priority bugs
sc issue list --search "authentication"    # Search
sc issue list --created-days 7             # Created this week
sc issue list --plan <plan_id>             # Linked to plan
sc issue list --all-projects               # All projects
```

| Flag | Description |
|------|-------------|
| `--id <id>` | Get specific issue |
| `-s, --status <status>` | backlog, open, in_progress, blocked, closed, deferred, all |
| `-p, --priority <n>` | Exact priority |
| `--priority-min <n>` | Minimum priority |
| `--priority-max <n>` | Maximum priority |
| `-t, --type <type>` | Issue type |
| `--labels <l1,l2>` | All labels must match |
| `--labels-any <l1,l2>` | Any label must match |
| `--parent <id>` | Filter by parent |
| `--plan <id>` | Filter by plan |
| `--search <query>` | Search title/description |
| `--assignee <name>` | Filter by assignee |
| `--sort <field>` | priority, createdAt, updatedAt |
| `--order <dir>` | asc, desc |
| `-l, --limit <n>` | Max results |
| `--created-days <n>` | Created in last N days |
| `--created-hours <n>` | Created in last N hours |
| `--updated-days <n>` | Updated in last N days |
| `--updated-hours <n>` | Updated in last N hours |
| `--has-subtasks` | Issues with subtasks |
| `--no-subtasks` | Issues without subtasks |
| `--has-deps` | Issues with dependencies |
| `--no-deps` | Issues without dependencies |
| `--all-projects` | Search all projects |

### `sc issue show <id>`
Get issue details.

```bash
sc issue show SC-a1b2 --json
```

### `sc issue update <id>`
Update an issue.

```bash
sc issue update SC-a1b2 -s in_progress
sc issue update SC-a1b2 --title "New title" -p 4
sc issue update SC-a1b2 --details "Implementation notes..."
```

| Flag | Description |
|------|-------------|
| `--title <text>` | New title |
| `-d, --description <text>` | New description |
| `--details <text>` | New details |
| `-s, --status <status>` | New status |
| `-t, --type <type>` | New type |
| `-p, --priority <n>` | New priority |
| `--parent <id>` | New parent |
| `--plan <id>` | Link to plan |

### `sc issue complete <id>`
Mark issue as complete.

```bash
sc issue complete SC-a1b2
```

### `sc issue claim <id>`
Claim an issue (sets in_progress + assigns to you).

```bash
sc issue claim SC-a1b2
```

### `sc issue release <id>`
Release an issue back to the pool.

```bash
sc issue release SC-a1b2
```

### `sc issue delete <id>`
Delete an issue permanently.

```bash
sc issue delete SC-a1b2
```

### `sc issue duplicate <id> --of <canonical_id>`
Mark an issue as duplicate.

```bash
sc issue duplicate SC-a1b2 --of SC-c3d4
```

### `sc issue clone <id>`
Clone an issue.

```bash
sc issue clone SC-a1b2
sc issue clone SC-a1b2 --title "Cloned task" -s open
```

### `sc issue batch`
Create multiple issues with dependencies.

```bash
sc issue batch --json-input '{
  "planId": "plan_abc",
  "issues": [
    { "title": "Epic: Auth", "issueType": "epic" },
    { "title": "Add JWT types", "parentId": "$0" },
    { "title": "Add middleware", "parentId": "$0" }
  ],
  "dependencies": [
    { "issueIndex": 2, "dependsOnIndex": 1, "dependencyType": "blocks" }
  ]
}'
```

### `sc issue ready`
Get issues ready to work on (open, no blockers, unassigned).

```bash
sc issue ready
sc issue ready -l 5
```

### `sc issue next-block`
Get and claim next block of ready issues.

```bash
sc issue next-block
sc issue next-block -c 3 --priority-min 2
```

### `sc issue dep add <id> --depends-on <dep_id>`
Add a dependency.

```bash
sc issue dep add SC-a1b2 --depends-on SC-c3d4 -t blocks
```

### `sc issue dep remove <id> --depends-on <dep_id>`
Remove a dependency.

```bash
sc issue dep remove SC-a1b2 --depends-on SC-c3d4
```

### `sc issue label add <id> -l <labels>`
Add labels.

```bash
sc issue label add SC-a1b2 -l "frontend,urgent"
```

### `sc issue label remove <id> -l <labels>`
Remove labels.

```bash
sc issue label remove SC-a1b2 -l "urgent"
```

---

## Plans

### `sc plan create <title>`
Create a plan (PRD/spec).

```bash
sc plan create "User Notifications" --content "## Overview
Real-time notification system..." -s active --criteria "All tests pass"
```

| Flag | Description |
|------|-------------|
| `--content <markdown>` | Plan content |
| `-s, --status <status>` | draft, active, completed |
| `--criteria <text>` | Success criteria |
| `--project <path>` | Project path |

### `sc plan list`
List plans.

```bash
sc plan list
sc plan list -s all
```

### `sc plan show <id>`
Get plan details with linked epics.

```bash
sc plan show plan_abc123 --json
```

### `sc plan update <id>`
Update a plan.

```bash
sc plan update plan_abc123 -s completed
sc plan update plan_abc123 --title "Updated Title" --content "New content"
```

---

## Projects

### `sc project create <path>`
Create a project.

```bash
sc project create /path/to/project -n "My Project" -d "Description" --prefix "MP"
```

### `sc project show <path>`
Get project details.

```bash
sc project show /path/to/project --json
```

### `sc project list`
List all projects.

```bash
sc project list
sc project list --session-count
```

### `sc project update <path>`
Update project settings.

```bash
sc project update /path -n "New Name" -d "New description"
```

### `sc project delete <path>`
Delete a project (requires confirmation).

```bash
sc project delete /path --confirm
```

---

## Embeddings

### `sc embeddings status`
Check embedding configuration.

```bash
sc embeddings status --json
```

### `sc embeddings test <text>`
Test embedding generation.

```bash
sc embeddings test "hello world" --json
```

### `sc embeddings configure`
Configure embedding provider.

```bash
sc embeddings configure -p ollama --enable
sc embeddings configure -p huggingface -m "nomic-embed-text" --token <token>
```

---

## Compaction

### `sc compaction`
Auto-prepare context for compaction.

```bash
sc compaction --json
```

Returns: checkpoint ID, summary, high-priority items, next steps, restoration prompt.

---

## Prime (Context Aggregation)

### `sc prime`
Read-only aggregation of all project context into a single payload. Use at conversation start or for full project awareness.

```bash
sc prime                                    # Colored terminal output
sc prime --json                             # JSON for programmatic use
sc prime --compact                          # Markdown for agent injection
sc prime --transcript                       # Include Claude Code transcripts
sc prime --transcript --transcript-limit 10 # More transcript entries
```

| Flag | Description |
|------|-------------|
| `--compact` | Markdown output for agent system prompts |
| `--transcript` | Parse Claude Code session transcripts |
| `--transcript-limit <n>` | Max transcript entries (default: 5) |

Returns: session state, git info, high-priority items, decisions, reminders, active issues, project memory, command reference, and optionally parsed transcripts.

**Default output** is colored terminal (human-readable).
**`--compact`** outputs markdown suitable for injecting into agent prompts.
**`--json`** outputs structured JSON with all fields for programmatic use.
