# SessionStart Workflow

For starting NEW coding sessions.

## When to Use

- Beginning work on a project
- User says "start session", "begin work"
- Work will span multiple conversations

## Pattern

```bash
sc session start "<name>" -d "<description>"
```

This automatically:
- Creates new session if none exists
- Resumes existing active session if one exists on the same project path

## When to Use force_new

When user clearly wants a NEW session (not available in CLI yet — create a new session by using a different name).

- **New version/release**: "start session for v0.1.26" (different from v0.1.25)
- **Explicit new**: "start a new session", "fresh session"

## Session Naming

**Good:** `"v0.1.26-features"`, `"implementing-oauth2-auth"`, `"fixing-payment-bug"`
**Bad:** `"session 1"`, `"work"`, `"stuff"`

## After Starting

Optionally check existing context:

```bash
sc get -c decision -P high
sc status
```

## Examples

**Start new version:**
```bash
# User: "start a session for v0.1.26"
sc session start "v0.1.26-planning" -d "Planning next release"
```

**Start new work:**
```bash
# User: "let's work on the auth feature"
sc session start "auth-feature" -d "Implementing JWT authentication"
```

## Do NOT

- Start sessions for quick one-off saves
- Create multiple sessions in one conversation
- **Use `sc session start` when user says "resume" or "continue"** — use the Resume workflow instead (`sc session list` → `sc session resume`)
