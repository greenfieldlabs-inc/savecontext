# SaveContext CLI Agent Reference

Machine-readable reference for AI coding agents using the `sc` CLI.

## Quick Start

```bash
sc init                        # Initialize database
sc session start "task name"   # Start a session
sc save key "value"            # Save context item
sc issue create "Fix bug"      # Create an issue
sc status                      # Check current state
```

## Error Handling

### Structured JSON Errors

When piped (non-TTY) or with `--json`, errors are structured:

```json
{
  "error": {
    "code": "ISSUE_NOT_FOUND",
    "message": "Issue not found: SC-xxxx (did you mean: SC-a1b2, SC-a1b3?)",
    "retryable": false,
    "exit_code": 3,
    "hint": "Did you mean: SC-a1b2, SC-a1b3?"
  }
}
```

### Error Codes

| Code | Exit | Retryable | Description |
|------|------|-----------|-------------|
| `NOT_INITIALIZED` | 2 | No | Run `sc init` first |
| `ALREADY_INITIALIZED` | 2 | No | Database already exists |
| `DATABASE_ERROR` | 2 | Yes | SQLite error (retry may help) |
| `SESSION_NOT_FOUND` | 3 | No | Session ID not found |
| `ISSUE_NOT_FOUND` | 3 | No | Issue ID not found |
| `CHECKPOINT_NOT_FOUND` | 3 | No | Checkpoint ID not found |
| `PROJECT_NOT_FOUND` | 3 | No | Project ID not found |
| `NO_ACTIVE_SESSION` | 3 | No | No session bound to terminal |
| `AMBIGUOUS_ID` | 3 | Yes | Multiple matches for short ID |
| `INVALID_STATUS` | 4 | Yes | Bad status value |
| `INVALID_TYPE` | 4 | Yes | Bad issue type value |
| `INVALID_PRIORITY` | 4 | Yes | Bad priority value |
| `INVALID_ARGUMENT` | 4 | Yes | Other invalid argument |
| `INVALID_SESSION_STATUS` | 4 | Yes | Wrong session lifecycle state |
| `REQUIRED_FIELD` | 4 | Yes | Missing required field |
| `CYCLE_DETECTED` | 5 | No | Dependency cycle |
| `HAS_DEPENDENTS` | 5 | No | Cannot delete: has dependents |
| `SYNC_ERROR` | 6 | No | JSONL sync failure |
| `CONFIG_ERROR` | 7 | No | Configuration issue |
| `IO_ERROR` | 8 | No | File system error |
| `JSON_ERROR` | 8 | No | JSON parse error |
| `EMBEDDING_ERROR` | 9 | No | Embedding provider error |
| `INTERNAL_ERROR` | 1 | No | Unexpected error |

### Exit Code Categories

| Exit | Category | Action |
|------|----------|--------|
| 0 | Success | Continue |
| 1 | Internal | Report bug |
| 2 | Database | Check init/permissions |
| 3 | Not Found | Verify ID, check suggestions |
| 4 | Validation | Fix input, retry |
| 5 | Dependency | Resolve dependency first |
| 6 | Sync | Check JSONL files |
| 7 | Config | Check configuration |
| 8 | I/O | Check file system |
| 9 | Embedding | Check embedding provider |

## Intent Detection (Synonym Resolution)

The CLI auto-normalizes common synonyms. Agents don't need to memorize canonical values.

### Status Synonyms

| Input | Resolves To |
|-------|-------------|
| `done`, `complete`, `completed`, `finished`, `resolved`, `wontfix` | `closed` |
| `wip`, `working`, `active`, `started` | `in_progress` |
| `new`, `todo`, `pending` | `open` |
| `waiting` | `blocked` |
| `hold`, `later`, `postponed` | `deferred` |

**Valid statuses:** `backlog`, `open`, `in_progress`, `blocked`, `closed`, `deferred`

### Type Synonyms

| Input | Resolves To |
|-------|-------------|
| `story`, `enhancement`, `improvement` | `feature` |
| `issue`, `defect`, `problem` | `bug` |
| `ticket`, `item`, `work` | `task` |
| `cleanup`, `refactor`, `maintenance` | `chore` |
| `parent`, `initiative` | `epic` |

**Valid types:** `task`, `bug`, `feature`, `epic`, `chore`

### Priority Synonyms

| Input | Value |
|-------|-------|
| `critical`, `crit`, `urgent`, `highest` | 4 |
| `high`, `important` | 3 |
| `medium`, `normal`, `default` | 2 |
| `low`, `minor` | 1 |
| `backlog`, `lowest`, `trivial` | 0 |

Also accepts: `0`-`4`, `P0`-`P4`

**Scale:** 0 = lowest, 4 = critical

## Output Modes

### Auto-JSON (Non-TTY)

When stdout is piped (non-TTY), output is automatically JSON. No flag needed:

```bash
sc issue list | jq '.issues[].title'    # Auto-JSON
sc issue list                            # Human-readable (TTY)
sc issue list --json                     # Force JSON in TTY
```

### Output Format Flag

```bash
sc issue list --format json   # JSON output
sc issue list --format csv    # CSV output
sc issue list --format table  # Human-readable (default)
```

### Silent Mode

For scripting — create/mutate commands print only the ID:

```bash
ID=$(sc issue create "Bug fix" --silent)
sc save my-key "value" --silent          # Prints: my-key
sc session start "work" --silent         # Prints: sess_xxxx
```

### CSV Output

```bash
sc issue list --format csv
# id,title,status,priority,type,assigned_to
# SC-a1b2,Fix login bug,open,3,bug,
```

### Dry Run

Preview mutations without writing:

```bash
sc issue create "Test" --dry-run
# Would create issue: Test [task, priority=2]

sc issue create "Test" --dry-run --json
# {"dry_run":true,"action":"create_issue","title":"Test",...}
```

## Multi-ID Operations

Batch commands accept multiple IDs:

```bash
sc issue complete SC-a1b2 SC-c3d4 SC-e5f6
sc issue claim SC-a1b2 SC-c3d4
sc issue release SC-a1b2 SC-c3d4
sc issue delete SC-a1b2 SC-c3d4
```

## File-Based Bulk Import

```bash
sc issue create --file issues.jsonl
```

JSONL format (one JSON object per line):
```json
{"title":"Fix auth","issue_type":"bug","priority":3}
{"title":"Add tests","issue_type":"task","labels":["testing"]}
```

## Multi-Agent Coordination

### Session Binding

Sessions are bound to the terminal (TTY). Each terminal gets one active session:

```bash
sc session start "agent-1 work"   # Binds to this terminal
sc save progress "step 1 done"    # Auto-scoped to bound session
```

### Agent Identification

```bash
sc --actor "claude-code-agent-1" issue claim SC-a1b2
sc --actor "codex-agent-2" issue claim SC-c3d4
```

### Issue Workflow

```bash
# 1. Find ready work (no unresolved dependencies)
sc issue ready

# 2. Claim a block of work
sc issue next-block --count 3

# 3. Complete when done
sc issue complete SC-a1b2

# 4. Check what's ready next
sc issue ready
```

### Dependency-Aware Scheduling

```bash
# Create with dependencies
sc issue batch '{"issues":[
  {"title":"Schema migration","issueType":"task"},
  {"title":"API endpoint","issueType":"task"}
],"dependencies":[
  {"issueIndex":1,"dependsOnIndex":0,"dependencyType":"blocks"}
]}'

# Only unblocked issues appear in ready list
sc issue ready
```

## Verbosity & Debugging

```bash
sc -v status        # Info level
sc -vv status       # Debug level
sc -vvv status      # Trace level
sc -q status        # Quiet (errors only)
RUST_LOG=debug sc status  # Override via env var
```

Tracing output goes to stderr, never polluting stdout. Note: Debug output is minimal - most commands just output JSON to stdout.

## Named Flag Aliases

Agents can use `--title`, `--id`, `--key` etc. as flags instead of positional args:

```bash
# Both work identically:
sc issue create "Fix bug"
sc issue create --title "Fix bug"

sc issue show SC-a1b2
sc issue show --id SC-a1b2
```

## Repeatable Flags

Labels support both comma-separated and repeated flags:

```bash
sc issue create "Bug" -l bug,security      # Comma-separated
sc issue create "Bug" -l bug -l security   # Repeated
sc issue list --labels bug,security        # Filter: all must match
sc issue list --labels-any bug,security    # Filter: any must match
```
