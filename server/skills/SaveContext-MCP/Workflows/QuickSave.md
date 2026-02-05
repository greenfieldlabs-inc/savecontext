# QuickSave Workflow

For saving context items WITHOUT session management overhead.

## When to Use

- User wants to save a decision, note, or reminder
- Quick capture during active work
- No need to start/manage sessions

## Pattern

```
context_save
  key="descriptive-key"
  value="[Well-formatted markdown content]"
  category="decision|progress|reminder|note"
  priority="high|normal|low"
```

## Categories

| Category | Use For |
|----------|---------|
| `decision` | Architectural choices, library selections |
| `progress` | What was completed, current state |
| `reminder` | TODOs, next steps |
| `note` | Gotchas, tips, reference info |

## Formatting

Always use markdown in values:

**Decisions:**
```
## [Decision Title]

**Choice:** [What was decided]
**Rationale:** [Why]
**Trade-offs:** [What we gave up]
```

**Progress:**
```
## [Task] - [Status]

**Completed:**
- Item 1
- Item 2

**Next:** [Immediate next action]
```

**Notes:**
```
## [Topic] Gotcha

**Problem:** [What goes wrong]
**Solution:** [How to fix]
```

## Examples

**Save a decision:**
```
User: "remember we're using Postgres over MongoDB"
→ context_save key="db-choice" value="## Database Selection\n\n**Choice:** PostgreSQL\n**Rationale:** ACID compliance, complex queries, existing team expertise" category="decision" priority="high"
```

**Save a gotcha:**
```
User: "note that the API needs raw body for webhooks"
→ context_save key="webhook-gotcha" value="## Webhook Body Parsing\n\n**Problem:** Signature verification fails with JSON middleware\n**Solution:** Use express.raw() for webhook routes" category="note"
```

## Do NOT

- Start a session for quick saves
- Call multiple tools
- Ask for confirmation on simple saves
