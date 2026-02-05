# Compaction Workflow

For preserving critical context when conversation gets long.

## Triggers

- "prepare for compaction"
- "save important context"
- "conversation getting long"
- Context usage high (40+ messages)

## Strategy

Strategically save key items and create tagged checkpoints. Think through what's critical before saving.

## Execution Sequence

### 1. Identify Key Context to Preserve

Think through what's critical:
- **Decisions**: Architectural choices, trade-offs made
- **Progress**: What was completed, current state
- **Blockers**: What's stuck, why
- **Next Steps**: What needs to happen next

### 2. Save Each Key Item

```bash
sc save "decision-<topic>" "<what was decided and why>" -c decision -p high

sc save "progress-<feature>" "<what's done, current state>" -c progress -p high

sc save "next-<task>" "<what needs to happen next>" -c reminder -p high
```

### 3. Tag Items for This Work Block

Tag ONLY the items you just saved (use specific keys):

```bash
sc tag add "auth-feature" --keys "decision-auth,progress-login,next-tests"
```

### 4. Create Checkpoint with Tags

```bash
sc checkpoint create "<feature>-checkpoint" -d "<what this checkpoint contains>" --tags "auth-feature"
```

### 5. Or Use Auto-Compaction

For automatic compaction that preserves critical context:

```bash
sc compaction --json
```

This returns: checkpoint ID, summary, high-priority items, next steps, and a restoration prompt.

## Example

```bash
# User: "prepare for compaction, we've been working a while"

# Think: What's critical from this session?
# - Decided on JWT over sessions
# - Completed login endpoint
# - Need to add rate limiting next

sc save "decision-jwt" "Using JWT over sessions - stateless, scales horizontally" -c decision -p high

sc save "progress-login" "Login endpoint complete with validation, error handling" -c progress -p high

sc save "next-rate-limit" "Add rate limiting to login endpoint before release" -c reminder -p high

sc tag add "auth-work" --keys "decision-jwt,progress-login,next-rate-limit"

sc checkpoint create "auth-checkpoint" -d "Auth decisions and login progress" --tags "auth-work"

# → "Saved 3 key context items and created checkpoint 'auth-checkpoint'."
# → "In a new conversation, restore with: sc checkpoint list -s 'auth' → sc checkpoint restore <id>"
```

## After Compaction (New Conversation)

```bash
# 1. Find the checkpoint
sc checkpoint list -s "auth" --json

# 2. Restore it
sc checkpoint restore <checkpoint_id>

# 3. Check restored context
sc get -P high --json
```

## Output to User

Provide restore instructions:
- Checkpoint name created
- How to restore in new conversation
- Summary of what was preserved
