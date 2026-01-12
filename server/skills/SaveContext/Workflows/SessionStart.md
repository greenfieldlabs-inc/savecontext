# SessionStart Workflow

For starting or resuming coding sessions.

## When to Use

- Beginning work on a project
- User says "start session", "begin work"
- Work will span multiple conversations

## Pattern

```
context_session_start
  name="descriptive-task-name"
  description="what you're working on"
```

This automatically:
- Creates new session if none exists
- Resumes existing active session if one exists

## When to Use force_new: true

Use `force_new: true` when user clearly wants a NEW session:

- **New version/release**: "start session for v0.1.26" (different from v0.1.25)
- **Explicit new**: "start a new session", "fresh session", "start fresh"
- **Different scope**: Session name is clearly different from any existing work

```
context_session_start
  name="v0.1.26-planning"
  description="Planning next release"
  force_new=true
```

## Session Naming

**Good:** `"v0.1.26-features"`, `"implementing-oauth2-auth"`, `"fixing-payment-bug"`
**Bad:** `"session 1"`, `"work"`, `"stuff"`

## After Starting

Optionally check existing context:

```
context_get category="decision" priority="high"
context_status
```

## Examples

**Start new version (use force_new):**
```
User: "start a session for v0.1.26"
→ context_session_start name="v0.1.26-planning" description="..." force_new=true
→ New session created
```

**Start new work:**
```
User: "let's work on the auth feature"
→ context_session_start name="auth-feature" description="Implementing JWT authentication"
→ Session started (or resumed if exists)
```

**Resume existing:**
```
User: "continue working on auth"
→ context_session_start name="auth-feature"
→ Resumed existing session
```

## Do NOT

- Start sessions for quick one-off saves
- Create multiple sessions in one conversation
- Skip force_new when user explicitly names a new version/release
