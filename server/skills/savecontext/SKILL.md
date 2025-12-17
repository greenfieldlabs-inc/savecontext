---
name: savecontext
description: This skill should be used when the user asks to "save context", "remember this decision", "track my progress", "checkpoint my work", "resume where I left off", "continue from last session", "persist state across sessions", "prepare for compaction", "restore from checkpoint", "switch sessions", or when starting work and needing to check for existing sessions.
---

# SaveContext

Persistent context management for AI coding agents. Save decisions, track progress, and maintain continuity across sessions.

## When to Use SaveContext

Use SaveContext when:
- Work spans multiple sessions or days
- Making architectural decisions worth remembering
- Approaching context limits (40+ messages)
- Switching between tasks or branches
- Collaborating with multiple agents on the same project

Do NOT use for:
- Single-session quick fixes
- Information already in the codebase
- Temporary debugging notes

## Session Start Protocol

When beginning work on a project:

1. **Check for existing session**
   ```
   context_session_start name="descriptive-task-name" description="what you're working on"
   ```
   This auto-resumes if an active session exists.

2. **Review existing context**
   ```
   context_get category="decision" priority="high"
   ```
   Check what decisions were already made.

3. **Check status**
   ```
   context_status
   ```
   See item count, checkpoint count, and if compaction is needed.

**Session Naming:**
- Good: `"implementing-oauth2-authentication"`, `"fixing-payment-webhook-bug"`
- Bad: `"working on stuff"`, `"session 1"`, `"test"`

## What to Save

### Categories

| Category | Use For | Example |
|----------|---------|---------|
| `decision` | Architectural choices, library selections | "Chose JWT over sessions for stateless scaling" |
| `progress` | What was completed, current state | "Auth login flow complete. Refresh tokens next." |
| `task` | Current work items, next steps | "TODO: Add rate limiting to token endpoint" |
| `note` | Reference info, gotchas, discoveries | "Stripe webhooks fail if body parsed as JSON first" |

### Priorities

| Priority | Use For |
|----------|---------|
| `high` | Critical decisions, blockers, must-remember info |
| `normal` | Standard progress and notes |
| `low` | Nice-to-have context, minor details |

### What's Worth Saving

**Save:**
- Architectural decisions and rationale
- API endpoints, database schemas, important URLs
- Gotchas discovered during debugging
- Current task and next steps

**Don't Save:**
- Code snippets (they're in the codebase)
- Generic best practices
- Temporary debugging info

### Key Naming

Keys should be descriptive and grep-able:
- Good: `"auth-jwt-decision"`, `"stripe-webhook-gotcha"`, `"db-schema-v2"`
- Bad: `"decision1"`, `"note"`, `"temp"`

## Formatting Context Values

**Critical:** Well-formatted context is the difference between useful restoration and useless noise. Master these patterns.

### Structure Guidelines

1. **Lead with the essential insight** - First line should be the most important point
2. **Use markdown formatting** - Headers, bullets, bold for scannability
3. **Keep items atomic** - One concept per context item
4. **Include rationale** - "What" without "why" is useless later
5. **Add actionable next steps** - Future you needs to know what's next

### Formatting Patterns by Category

**Decisions (most critical to format well):**
```
## [Decision Title]

**Choice:** [What was decided]
**Rationale:** [Why this over alternatives]
**Trade-offs:** [What we gave up]
**Alternatives rejected:** [What else was considered]

Impact: [Files/systems affected]
```

**Progress updates:**
```
## [Feature/Task] - [Status]

**Completed:**
- Item 1
- Item 2

**Current state:** [Where things stand]

**Next:** [Immediate next action]
**Blocked by:** [If applicable]
```

**Notes/Gotchas:**
```
## [Topic] Gotcha

**Problem:** [What goes wrong]
**Cause:** [Root cause]
**Solution:** [How to fix/avoid]

File: `path/to/relevant/file.ts`
```

**Tasks:**
```
## TODO: [Task title]

**Context:** [Why this needs doing]
**Approach:** [How to tackle it]
**Acceptance:** [How to know it's done]

Files: `file1.ts`, `file2.ts`
```

### Good vs Bad Examples

**Decision - BAD:**
```
context_save key="auth" value="we decided to use jwt" category="decision"
```
Problems: No rationale, no context, no alternatives, will be useless later.

**Decision - GOOD:**
```
context_save key="auth-jwt-decision" value="## Authentication: JWT with Refresh Tokens

**Choice:** JWT access tokens (15min) + refresh tokens (7 days)
**Rationale:** Stateless auth scales horizontally; refresh tokens balance security with UX

**Rejected alternatives:**
- Sessions: Requires shared state/Redis, adds complexity
- JWT only: Too short = bad UX, too long = security risk

**Trade-off:** Token revocation requires maintaining a blocklist

Impact: `auth/`, `middleware/`, `lib/tokens.ts`" category="decision" priority="high"
```

**Progress - BAD:**
```
context_save key="progress" value="did some work on the api" category="progress"
```
Problems: Vague, no specifics, doesn't help future sessions.

**Progress - GOOD:**
```
context_save key="api-endpoints-progress" value="## REST API Implementation - 70%

**Completed:**
- GET/POST/PUT/DELETE for `/users`
- GET/POST for `/projects`
- Authentication middleware
- Rate limiting (100 req/min)

**Current state:** CRUD operations working, tests passing

**Next:** Implement `/projects/:id/tasks` endpoints
**Blocked by:** Need schema decision for task priorities" category="progress"
```

**Note - BAD:**
```
context_save key="note1" value="stripe is weird" category="note"
```

**Note - GOOD:**
```
context_save key="stripe-webhook-raw-body" value="## Stripe Webhook Signature Gotcha

**Problem:** Webhook signature verification always fails
**Cause:** Express JSON middleware parses body before Stripe can verify
**Solution:** Use `express.raw({type: 'application/json'})` for webhook route ONLY

```typescript
// WRONG - global JSON parsing breaks signature
app.use(express.json());

// RIGHT - raw body for webhooks
app.post('/webhook', express.raw({type: 'application/json'}), handleWebhook);
```

File: `routes/webhooks.ts:15`" category="note" priority="high"
```

### Length Guidelines

| Category | Target Length | Max Length |
|----------|--------------|------------|
| Decision | 200-500 chars | 1000 chars |
| Progress | 150-400 chars | 800 chars |
| Note | 100-300 chars | 600 chars |
| Task | 100-250 chars | 500 chars |

**If it's longer:** Split into multiple context items with related keys (e.g., `auth-decision-jwt`, `auth-decision-refresh`).

### What NOT to Include

- **Code blocks over 10 lines** - Reference the file instead
- **Full error stack traces** - Summarize the error
- **Conversation summaries** - Save insights, not transcripts
- **Generic knowledge** - Only project-specific context
- **Temporary debug info** - Will clutter future sessions

### Multi-Item Patterns

For complex decisions, split into related items:

```
context_save key="db-schema-users" value="..." category="decision"
context_save key="db-schema-projects" value="..." category="decision"
context_save key="db-schema-relations" value="..." category="decision"
context_tag keys=["db-schema-users", "db-schema-projects", "db-schema-relations"] tags=["db", "schema-v2"] action="add"
```

This enables:
- Selective restore (`restore_tags=["db"]`)
- Targeted search (`context_get query="database schema"`)
- Clean checkpoint splitting

## Tagging Strategy

**Always tag before checkpointing.** Tags enable selective restore and checkpoint splitting.

```
context_tag keys=["auth-decision", "auth-progress"] tags=["auth"] action="add"
```

Tag conventions:
- Short, descriptive: `auth`, `ui`, `api`, `payments`
- Consistent across sessions
- By work stream or feature

## Checkpoint Triggers

Create checkpoints at these moments:

1. **Before major changes**
   ```
   context_checkpoint name="pre-refactor" include_git=true
   ```

2. **At milestones**
   After completing a feature or fixing a bug.

3. **Before context compaction**
   When context gets long, `context_prepare_compaction` auto-creates a checkpoint.

4. **Before switching branches**
   Checkpoint your current work stream before context-switching.

## Context Compaction

When conversation exceeds 40 messages or context usage is high:

```
context_prepare_compaction
```

This:
- Creates a checkpoint of all context
- Summarizes critical items (high-priority decisions, active tasks)
- Returns restore instructions for the next session

**After compaction**, in a new conversation:
```
context_restore checkpoint_id="..." checkpoint_name="..."
```

## Memory vs Context

| Type | Scope | Use For |
|------|-------|---------|
| **Context** (`context_save`) | Current session | Decisions, progress, notes for this task |
| **Memory** (`context_memory_save`) | All sessions | Commands, configs, permanent project info |

**Memory examples:**
```
context_memory_save key="test_cmd" value="npm test -- --coverage" category="command"
context_memory_save key="prod_api" value="https://api.example.com/v1" category="config"
```

Memory persists across ALL sessions for this project.

## Semantic Search

Find context by meaning, not just exact match:

```
context_get query="how did we handle authentication"
```

Search tips:
- Use natural language questions
- Lower threshold (0.3) for more results, higher (0.7) for precision
- Add `search_all_sessions=true` to search across all your sessions

## Quick Reference

| Task | Tool |
|------|------|
| Start/resume session | `context_session_start` |
| Save decision | `context_save category="decision" priority="high"` |
| Track progress | `context_save category="progress"` |
| Find previous work | `context_get query="..."` |
| Tag items | `context_tag keys=[...] tags=[...] action="add"` |
| Create checkpoint | `context_checkpoint name="..."` |
| Pause session | `context_session_pause` |
| Prepare for compaction | `context_prepare_compaction` |
| Restore from checkpoint | `context_restore` |

Full tool reference: [savecontext.dev/docs/reference/tools](https://savecontext.dev/docs/reference/tools)

## Reference Files

- [references/WORKFLOWS.md](references/WORKFLOWS.md) - Detailed workflow patterns for multi-session projects, pre-refactor checkpointing, and compaction recovery.
