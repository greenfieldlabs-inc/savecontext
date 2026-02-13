# WrapUp Workflow

Compound workflow for ending a work session.

## Triggers

- "wrap up"
- "wrap up session"
- "end of day"
- "checkpoint everything"
- "wrap up and checkpoint"

## Execution Sequence

Execute these in order:

### 1. Triage Issues

**Before wrapping up, clean up issue state:**

```bash
# Check for issues you claimed but didn't finish
sc issue list -s in_progress

# Complete anything that's done
sc issue complete <id>

# Defer work that won't happen this session
sc issue update <id> -s deferred

# File issues for any remaining work or follow-ups discovered
sc issue create "Follow-up: thing noticed during work" -t task -p 2
```

### 2. Save Current Progress

```bash
sc save "session-wrapup-$(date +%Y%m%d)" \
  "## Session Summary

**Completed:**
- [list items]

**Next:**
- [next steps]" -c progress
```

### 3. Tag Recent Items (Optional)

If items should be grouped:

```bash
sc tag add "feature-name" --keys "item1,item2"
```

### 4. Create Checkpoint

```bash
sc checkpoint create "wrapup-$(date +%Y-%m-%d)" --include-git
```

### 5. Pause Session

```bash
sc session pause
```

## Example

```bash
# User: "wrap up for today"

sc save "wrapup-2025-01-30" "## Session Summary

**Completed:**
- Added JWT token generation
- Implemented refresh token rotation

**Next:**
- Add rate limiting
- Write integration tests" -c progress

sc checkpoint create "wrapup-2025-01-30" --include-git

sc session pause

# → "Session wrapped up. Checkpoint created: wrapup-2025-01-30"
```

## Output to User

After wrap up, report:
- What was saved
- Checkpoint name/ID
- How to resume: `sc session list` → `sc session resume <id>`
