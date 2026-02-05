# Resume Workflow

For resuming previous work with full context.

> **IMPORTANT:** NEVER use `context_session_start` to resume. It creates duplicates.
> ALWAYS use `context_list_sessions` → `context_session_resume`.

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

```
context_list_sessions search="[user's topic/description]"
```

If user didn't specify, list recent sessions:

```
context_list_sessions limit=5
```

### 2. Confirm Session with User

Present the matching sessions and confirm which one to resume.

### 3. Resume the Session

Use `context_session_resume` with the session ID:

```
context_session_resume
  session_id="sess_..."
  session_name="Session Name"
```

### 4. Load Context

```
context_status
context_get priority="high"
context_get category="reminder"
```

## If Restoring from Checkpoint

When user says "restore from checkpoint":

```
# 1. Find checkpoint
context_list_checkpoints search="checkpoint-name"

# 2. Get details
context_get_checkpoint checkpoint_id="..."

# 3. Restore
context_restore checkpoint_id="..." checkpoint_name="..."
```

## Example

```
User: "resume the auth work"

→ context_list_sessions search="auth"
→ Found: "Auth Feature Implementation" (sess_abc123)

→ context_session_resume session_id="sess_abc123" session_name="Auth Feature Implementation"
→ Resumed session

→ context_status
→ Items: 12, Checkpoints: 2

→ context_get priority="high"
→ Shows: auth-decision, rate-limit-decision

→ context_get category="reminder"
→ Shows: todo-tests, next-steps

→ "Resumed 'Auth Feature Implementation'. Key decisions: JWT over sessions. Next: Add rate limiting to token endpoint"
```

## Output to User

After resume, summarize:
- Session name
- Key decisions/context found
- Pending reminders/next steps
