# QuickSave Workflow

For saving context items WITHOUT session management overhead.

## When to Use

- User wants to save a decision, note, or reminder
- Quick capture during active work
- No need to start/manage sessions

## Pattern

```bash
sc save "<key>" "<value>" -c <category> -p <priority>
```

## Categories

| Category | Use For |
|----------|---------|
| `decision` | Architectural choices, library selections |
| `progress` | What was completed, current state |
| `reminder` | TODOs, next steps |
| `note` | Gotchas, tips, reference info |

## Priorities

- `high` — Critical decisions, blockers
- `normal` — Standard items (default)
- `low` — Nice-to-know

## Formatting

Always use markdown in values:

**Decisions:**
```bash
sc save "db-choice" "## Database Selection

**Choice:** PostgreSQL
**Rationale:** ACID compliance, complex queries
**Trade-offs:** Less flexible schema than MongoDB" -c decision -p high
```

**Progress:**
```bash
sc save "login-progress" "## Login Flow - Complete

**Completed:**
- JWT token generation
- Refresh token rotation

**Next:** Add rate limiting" -c progress
```

**Notes:**
```bash
sc save "webhook-gotcha" "## Webhook Body Parsing

**Problem:** Signature verification fails with JSON middleware
**Solution:** Use express.raw() for webhook routes" -c note
```

## Examples

**Save a decision:**
```bash
# User: "remember we're using Postgres over MongoDB"
sc save "db-choice" "## Database Selection

**Choice:** PostgreSQL
**Rationale:** ACID compliance, complex queries, existing team expertise" -c decision -p high
```

**Save a gotcha:**
```bash
# User: "note that the API needs raw body for webhooks"
sc save "webhook-gotcha" "## Webhook Body Parsing

**Problem:** Signature verification fails with JSON middleware
**Solution:** Use express.raw() for webhook routes" -c note
```

## Do NOT

- Start a session for quick saves
- Run multiple commands when one suffices
- Ask for confirmation on simple saves
