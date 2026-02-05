# Prime Workflow

Read-only context aggregation for full project awareness.

## When to Use

- At conversation start when resuming complex projects
- When an agent needs full project state in a single call
- Before making architectural decisions requiring broad context
- When injecting context into agent system prompts

## Quick Use

```bash
sc prime
```

Returns session state, high-priority items, decisions, active issues, memory, and a command reference — all in one call.

## Output Modes

### Terminal (default)
Colored, human-readable output:
```bash
sc prime
```

### Compact (agent injection)
Markdown formatted for system prompts:
```bash
sc prime --compact
```

### JSON (programmatic)
Structured JSON for parsing:
```bash
sc prime --json
```

## With Transcripts

Parse Claude Code session transcripts for additional context:

```bash
sc prime --transcript
sc prime --transcript --transcript-limit 10
```

This reads JSONL transcript files from `~/.claude/projects/` and extracts conversation summaries, providing richer project history.

## What It Returns

| Section | Contents |
|---------|----------|
| Session | Name, status, description, branch, created/updated times |
| Git | Branch, uncommitted changes |
| Context | High-priority items, decisions, reminders, recent progress |
| Issues | Ready issues (open, unblocked, unassigned) |
| Memory | Project commands, configs, notes |
| Transcripts | Recent conversation summaries (if `--transcript`) |
| Commands | Quick reference cheatsheet |

## Example

```bash
# User starts a new conversation on a complex project

sc prime --compact
# → Returns markdown with full project state

# Use the output to understand:
# - What decisions were made
# - What work is pending
# - What issues are ready
# - What commands/configs are saved
```

## Compared to Other Commands

| Command | Purpose |
|---------|---------|
| `sc status` | Quick session stats (item count, categories) |
| `sc prime` | Full context aggregation (everything at once) |
| `sc compaction` | Creates checkpoint + summary (mutates state) |

**Key difference:** `sc prime` is purely read-only. It never creates checkpoints or modifies the database.
