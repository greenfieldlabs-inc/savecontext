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

```
context_save
  key="decision-[topic]"
  value="[what was decided and why]"
  category="decision"
  priority="high"

context_save
  key="progress-[feature]"
  value="[what's done, current state]"
  category="progress"
  priority="high"

context_save
  key="next-[task]"
  value="[what needs to happen next]"
  category="reminder"
  priority="high"
```

### 3. Tag Items for This Work Block

Tag ONLY the items you just saved (use specific keys, not patterns):

```
context_tag
  keys=["decision-auth", "progress-login", "next-tests"]
  tags=["auth-feature"]
  action="add"
```

### 4. Create Checkpoint with Tags

```
context_checkpoint
  name="[feature]-checkpoint"
  description="[what this checkpoint contains]"
  include_tags=["[feature-tag]"]
```

## Example

```
User: "prepare for compaction, we've been working a while"

# Think: What's critical from this session?
# - Decided on JWT over sessions
# - Completed login endpoint
# - Need to add rate limiting next

→ context_save key="decision-jwt" value="Using JWT over sessions - stateless, scales horizontally" category="decision" priority="high"

→ context_save key="progress-login" value="Login endpoint complete with validation, error handling" category="progress" priority="high"

→ context_save key="next-rate-limit" value="Add rate limiting to login endpoint before release" category="reminder" priority="high"

→ context_tag keys=["decision-jwt", "progress-login", "next-rate-limit"] tags=["auth-work"] action="add"

→ context_checkpoint name="auth-checkpoint" description="Auth decisions and login progress" include_tags=["auth-work"]

→ "Saved 3 key context items and created checkpoint 'auth-checkpoint'. In a new conversation, restore with: context_list_checkpoints search='auth'"
```

## After Compaction (New Conversation)

```
# 1. Find the checkpoint
context_list_checkpoints search="auth"

# 2. Restore it
context_restore checkpoint_id="ckpt_..." checkpoint_name="auth-checkpoint"

# 3. Check restored context
context_get priority="high"
```

## Output to User

Provide restore instructions:
- Checkpoint name created
- How to restore in new conversation
- Summary of what was preserved
