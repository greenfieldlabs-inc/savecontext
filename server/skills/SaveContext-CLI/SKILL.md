---
name: SaveContext-CLI
description: Persistent memory for AI coding agents via CLI. USE WHEN user says "save context", "remember this", "checkpoint", "resume session", "prepare for compaction", "wrap up", OR when starting work on a project that may span sessions.
allowed-tools: "Bash(sc:*)"
---

# SaveContext (CLI)

Save decisions, track progress, and maintain continuity across coding sessions using the `sc` command-line tool.

All commands use the `sc` binary. Add `--json` for structured JSON output.

## Critical Rules

**NEVER use `sc session start` when the user says "resume".** The word "resume" (or "continue session", "pick up where I left off") ALWAYS means:
1. `sc session list --search "<topic>"` to find the session
2. `sc session resume <session_id>` to resume it

`sc session start` creates NEW sessions. Using it to "resume" almost always creates duplicates.

## Quick Actions

| User Says | Do This |
|-----------|---------|
| "save this decision" | `sc save "key" "value" -c decision -p high` |
| "remember this" | `sc save "key" "value" -c note` |
| "checkpoint" | `sc checkpoint create "name"` |
| "wrap up" | See [WrapUp workflow](#wrap-up) |
| "resume [topic]" | **MUST** `sc session list --search "topic"` then `sc session resume <id>` |
| "start session" | `sc session start "name" -d "description"` (new sessions only) |
| "what went wrong" | Check the error hint — includes suggestions, similar IDs |

## Error Handling

Errors include hints and suggestions. If an ID is not found, check the hint for similar IDs.
When no session is active, the error lists recent resumable sessions.

Structured JSON errors are automatic when piped. See `cli/AGENTS.md` for error codes.

## Command Cheatsheet

### Sessions
```bash
sc session start "name" -d "description"      # Start new session
sc session list --search "query"               # Find sessions
sc session resume <id>                         # Resume paused session
sc session pause                               # Pause current session
sc session end                                 # End session
sc status                                      # Current session + stats
```

### Context Items
```bash
sc save "key" "value" -c decision -p high      # Save context
sc get -s "search query"                       # Semantic search
sc get -k "exact-key"                          # Get by key
sc get -c decision -P high                     # Filter by category/priority
sc update "key" --value "new value"            # Update item
sc delete "key"                                # Delete item
```

### Issues
```bash
sc issue create "title" -t feature -p 2        # Create issue
sc issue list -s open                          # List issues
sc issue claim <id>                            # Claim for work
sc issue complete <id>                         # Mark complete
sc issue update <id> -s in_progress            # Update status
```

### Checkpoints
```bash
sc checkpoint create "name" --include-git      # Create checkpoint
sc checkpoint list -s "query"                  # Find checkpoints
sc checkpoint show <id>                        # Get details
sc checkpoint restore <id>                     # Restore
```

### Memory (persistent across sessions)
```bash
sc memory save "key" "value" -c command        # Save memory
sc memory get "key"                            # Get memory
sc memory list                                 # List all
```

### Plans
```bash
sc plan create "title" --content "markdown"    # Create plan
sc plan list                                   # List plans
sc plan show <id>                              # Get plan details
```

### Prime (full context)
```bash
sc prime                                       # Full context aggregation
sc prime --compact                             # Markdown for agent injection
sc prime --transcript                          # Include session transcripts
```

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **QuickSave** | "save", "remember", "note this" | `Workflows/QuickSave.md` |
| **SessionStart** | Starting work, "begin session" | `Workflows/SessionStart.md` |
| **WrapUp** | "wrap up", "end of day" | `Workflows/WrapUp.md` |
| **Resume** | "resume", "continue" | `Workflows/Resume.md` |
| **Compaction** | "prepare for compaction" | `Workflows/Compaction.md` |
| **IssueTracking** | "create issue", "track this bug" | `Workflows/IssueTracking.md` |
| **Planning** | "plan this feature" | `Workflows/Planning.md` |
| **Prime** | "what's the full context", conversation start | `Workflows/Prime.md` |
| **Advanced** | Multi-day projects, multi-agent, branch switching, subagents | `Workflows/AdvancedWorkflows.md` |

## Examples

**Example 1: Quick save during work**
```bash
# User: "remember that we chose JWT over sessions for auth"
sc save "auth-decision" "Chose JWT over sessions for stateless scaling" -c decision -p high
```

**Example 2: Starting a work session**
```bash
# User: "let's work on the payment feature"
sc session start "payment-feature" -d "Implementing Stripe integration"
```

**Example 3: Wrapping up**
```bash
# User: "wrap up for today"
sc save "wrapup-2025-01-30" "Completed login flow. Next: rate limiting" -c progress
sc checkpoint create "wrapup-2025-01-30" --include-git
sc session pause
```

## Do NOT Automatically

- Start sessions for quick saves (just save the item)
- Run multiple commands when one suffices
- Load full reference docs unless user asks how something works

## Reference

Full CLI reference: `Workflows/Reference.md`
