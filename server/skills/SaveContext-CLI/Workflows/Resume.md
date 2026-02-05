# Resume Workflow

For resuming previous work with full context.

> **IMPORTANT:** NEVER use `sc session start` to resume. It creates duplicates.
> ALWAYS use `sc session list` → `sc session resume`.

## Triggers

- "resume"
- "resume our session"
- "continue where I left off"
- "pick up where I left off"
- "resume [topic]"
- "continue session"

## Execution Sequence

### 1. Find Sessions Using User's Query

Use the user's description to search for matching sessions:

```bash
sc session list --search "<topic>" --json
```

If user didn't specify, list recent sessions:

```bash
sc session list -l 5 --json
```

### 2. Confirm Session with User

Present the matching sessions and confirm which one to resume.

### 3. Resume the Session

```bash
sc session resume <session_id>
```

### 4. Load Context

```bash
sc status
sc get -P high --json
sc get -c reminder --json
```

## If Restoring from Checkpoint

When user says "restore from checkpoint":

```bash
# 1. Find checkpoint
sc checkpoint list -s "checkpoint-name" --json

# 2. Get details
sc checkpoint show <checkpoint_id> --json

# 3. Restore
sc checkpoint restore <checkpoint_id>
```

## Example

```bash
# User: "resume the auth work"

sc session list --search "auth" --json
# Found: "Auth Feature Implementation" (sess_abc123)

sc session resume sess_abc123
# Resumed session

sc status
# Items: 12, Checkpoints: 2

sc get -P high --json
# Shows: auth-decision, rate-limit-decision

sc get -c reminder --json
# Shows: todo-tests, next-steps

# → "Resumed 'Auth Feature Implementation'. Key decisions: JWT over sessions. Next: Add rate limiting to token endpoint"
```

## Output to User

After resume, summarize:
- Session name
- Key decisions/context found
- Pending reminders/next steps
