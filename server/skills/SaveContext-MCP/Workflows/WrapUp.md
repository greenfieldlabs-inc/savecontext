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

### 1. Save Current Progress

```
context_save
  key="session-wrapup-[timestamp]"
  value="## Session Summary\n\n**Completed:**\n- [list items]\n\n**Next:**\n- [next steps]"
  category="progress"
```

### 2. Tag Recent Items (Optional)

If items should be grouped:

```
context_tag
  keys=["item1", "item2"]
  tags=["feature-name"]
  action="add"
```

### 3. Create Checkpoint

```
context_checkpoint
  name="wrapup-[date]"
  include_git=true
```

### 4. Pause Session

```
context_session_pause
```

## Example

```
User: "wrap up for today"

→ context_save key="wrapup-2025-01-12" value="## Session Summary\n\n**Completed:**\n- Added JWT token generation\n- Implemented refresh token rotation\n\n**Next:**\n- Add rate limiting\n- Write integration tests" category="progress"

→ context_checkpoint name="wrapup-2025-01-12" include_git=true

→ context_session_pause

→ "Session wrapped up. Checkpoint created: wrapup-2025-01-12"
```

## Output to User

After wrap up, report:
- What was saved
- Checkpoint name/ID
- How to resume: `context_session_start name="..."`
