# SaveContext CLI Workflows

Detailed workflow patterns for common scenarios using the `sc` CLI.

## Contents

- [Multi-Session Project Workflow](#multi-session-project-workflow)
- [Pre-Refactor Checkpoint Workflow](#pre-refactor-checkpoint-workflow)
- [Compaction Recovery Workflow](#compaction-recovery-workflow)
- [Multi-Agent Coordination](#multi-agent-coordination)
- [Branch Switching Workflow](#branch-switching-workflow)
- [Semantic Search Patterns](#semantic-search-patterns)
- [Implementation Planning Workflow](#implementation-planning-workflow)

---

## Multi-Session Project Workflow

For projects that span multiple days or sessions.

### Day 1: Starting Work

```bash
# 1. Start session with descriptive name
sc session start "implementing-user-authentication" \
  -d "Adding OAuth2 with JWT tokens, refresh token rotation"

# 2. Save initial architectural decisions (well-formatted!)
sc save "auth-architecture" "## Authentication Architecture

**Choice:** OAuth2 with JWT access tokens + refresh tokens
**Token Lifetimes:** Access: 15min, Refresh: 7 days

**Storage:** Refresh tokens in PostgreSQL with device fingerprinting
**Rationale:** Stateless access tokens scale horizontally; refresh tokens enable revocation

**Trade-off:** Requires token blocklist for immediate revocation

Impact: auth/, middleware/, lib/tokens.ts" -c decision -p high

# 3. Track progress as you work (include next steps!)
sc save "auth-progress-day1" "## Auth Implementation - Day 1

**Completed:**
- JWT generation with RS256 signing
- Token validation middleware
- User claims extraction

**Current state:** Core token flow working, tests passing

**Next:** Implement refresh token rotation endpoint
**Files touched:** auth/jwt.ts, middleware/auth.ts" -c progress

# 4. Before stopping, tag and checkpoint
sc tag add "auth" --keys "auth-architecture,auth-progress-day1"
sc checkpoint create "auth-day1-complete" --include-git
sc session pause
```

### Day 2: Resuming Work

```bash
# 1. Find and resume session (NEVER use sc session start to resume!)
sc session list --search "authentication"
sc session resume <session_id>

# 2. Check what was done
sc get -c decision -P high --json
sc get -c progress --json

# 3. Continue work, save new progress (well-formatted!)
sc save "auth-progress-day2" "## Auth Implementation - Day 2

**Completed:**
- Refresh token rotation with family tracking
- Logout endpoint with token revocation
- Token blocklist in Redis (5min TTL for access tokens)

**Current state:** Full auth flow operational, 94% test coverage

**Next:** Rate limiting on auth endpoints
**Blocked by:** None
**Files touched:** auth/refresh.ts, auth/logout.ts, lib/redis.ts" -c progress

# 4. Save any new decisions (with rationale!)
sc save "auth-rate-limit-decision" "## Rate Limiting Strategy

**Choice:** Sliding window algorithm via Redis
**Limits:**
- Login: 5 attempts/minute/IP
- Token refresh: 10 attempts/minute/user
- Password reset: 3 attempts/hour/email

**Rationale:** Sliding window prevents burst attacks while being fair to legitimate users
**Rejected:** Fixed window (allows burst at boundary), token bucket (overkill for auth)

**Trade-off:** Requires Redis; adds ~2ms latency per request

Impact: middleware/rate-limit.ts, lib/redis.ts" -c decision -p high
```

### Finishing the Feature

```bash
# 1. Tag all auth items
sc tag add "auth,v1.2" --pattern "auth-*"

# 2. Create completion checkpoint
sc checkpoint create "auth-feature-complete" --include-git

# 3. End or pause based on next steps
sc session end     # If done with this task
sc session pause   # If might continue later
```

---

## Pre-Refactor Checkpoint Workflow

Before making significant changes to the codebase.

### Before Refactoring

```bash
# 1. Document current state (be specific!)
sc save "pre-refactor-state" "## Pre-Refactor: Session to JWT Migration

**Current architecture:** Express-session with Redis store
**Why migrating:** Horizontal scaling issues; sessions don't work well with serverless

**Files affected:**
- auth/*.ts - Session creation/validation logic
- middleware/*.ts - Auth middleware checks session
- tests/auth/*.test.ts - 47 tests depend on session mocking

**Risk areas:**
- Concurrent request handling during migration
- Existing logged-in users will be logged out
- Mobile app caches session tokens

**Rollback plan:** Feature flag USE_JWT_AUTH allows instant rollback" -c note -p high

# 2. Capture refactor plan (with acceptance criteria!)
sc save "refactor-plan" "## TODO: JWT Migration

**Context:** Moving from sessions to JWT for stateless auth

**Steps:**
1. Add JWT utils (lib/jwt.ts) - generation, validation, refresh
2. Update middleware to check JWT OR session (parallel support)
3. Migrate endpoints one-by-one behind feature flag
4. Update tests to support both auth methods
5. Remove session code after 1 week of JWT-only

**Acceptance criteria:**
- All 47 auth tests pass
- No increase in auth latency (p99 < 50ms)
- Existing mobile sessions gracefully migrated

**Estimated scope:** 12 files, ~400 lines changed" -c reminder -p high

# 3. Create checkpoint with git status
sc checkpoint create "pre-jwt-migration" --include-git \
  -d "State before migrating from sessions to JWT"
```

### If Refactor Goes Wrong

```bash
# 1. Find checkpoint
sc checkpoint list -s "pre-jwt" --json

# 2. Get details
sc checkpoint show <checkpoint_id> --json

# 3. Restore context (doesn't restore code, just context)
sc checkpoint restore <checkpoint_id>

# Note: Use git to restore code changes
```

---

## Compaction Recovery Workflow

When context gets too long and needs compaction.

### Detecting Compaction Need

```bash
sc status --json
# Response includes:
# - should_compact: true/false
# - compaction_reason: "High item count (45 items)"
```

### Preparing for Compaction

```bash
# 1. Ensure important items are tagged
sc get --json    # Review all items
sc tag add "preserve" --keys "critical-decision-1,current-task"

# 2. Auto-compaction
sc compaction --json

# Returns: checkpoint ID, summary, high-priority items,
# next steps, and a restoration prompt
```

### Continuing After Compaction

In a NEW conversation (after the old one was compacted):

```bash
# 1. Find and resume session
sc session list --search "session-name"
sc session resume <session_id>

# 2. Restore from compaction checkpoint
sc checkpoint list -s "compaction" --json
sc checkpoint restore <checkpoint_id>

# 3. Check restored context
sc get -P high --json
sc get -c reminder --json
```

---

## Multi-Agent Coordination

When multiple AI agents work on the same project.

### Agent A (Claude Code Terminal 1)

```bash
# Start session
sc session start "feature-payments"

# Save work (well-formatted so Agent B understands!)
sc save "stripe-integration-progress" "## Stripe Integration - Terminal Agent

**Completed:**
- Checkout session endpoint (POST /api/checkout)
- Price ID lookup from product catalog
- Success/cancel URL configuration

**Current state:** Checkout creates Stripe session, redirects to hosted page

**Next:** Webhook handler for payment confirmation
**Blocked by:** Need webhook signing secret in env

**Files:** routes/checkout.ts, lib/stripe.ts
**Test coverage:** 3 tests added, all passing" -c progress

# Tag by agent for attribution
sc tag add "terminal-agent,payments" --keys "stripe-integration-progress"
```

### Agent B (Claude Code Terminal 2 or Cursor)

```bash
# Same session (auto-joins via project path)
sc session start "feature-payments"

# Check what terminal agent did
# (semantic search finds items by meaning)
sc get -s "stripe checkout" --json

# Continue work (reference what Agent A did!)
sc save "stripe-webhook-handler" "## Stripe Webhooks - Desktop Agent

**Completed:**
- Webhook endpoint (POST /api/webhooks/stripe)
- Signature verification using stripe.webhooks.constructEvent
- Event handlers: checkout.session.completed, invoice.paid

**Building on:** Terminal agent's checkout flow (see stripe-integration-progress)

**Current state:** Webhooks verified and processed, order status updated

**Next:** Add invoice.payment_failed handler for dunning
**Files:** routes/webhooks.ts, services/orders.ts
**Test coverage:** 5 tests (mocked Stripe events)" -c progress

sc tag add "desktop-agent,payments" --keys "stripe-webhook-handler"
```

### Coordination Pattern

Both agents see each other's context. Use tags to track who did what:
- Tag by agent: `terminal-agent`, `desktop-agent`, `cursor-agent`
- Tag by feature: `payments`, `auth`, `ui`
- Combine: Both agents tag with `payments`, individual agent tags for attribution

### Agent Identification

Use the `--actor` flag to identify yourself:

```bash
sc --actor "claude-code-agent-1" issue claim SC-a1b2
sc --actor "codex-agent-2" issue claim SC-c3d4
```

---

## Subagent Patterns

When a parent agent spawns subagents (via Task tool or similar) to handle subtasks.

### Parent Agent: Spawning a Subagent

Before spawning, save the task context so the subagent can pick it up:

```bash
# 1. Create an issue for the subtask
sc issue create "Implement rate limiting middleware" \
  -t task -p 3 \
  -d "Add sliding window rate limiter to auth endpoints" \
  --details "## Context
Parent is implementing auth feature.
Use Redis for rate limit storage.

## Acceptance
- 5 req/min/IP on /login
- 10 req/min/user on /refresh
- Return 429 with Retry-After header"

# 2. Tag it for the subagent
sc tag add "subagent-task,rate-limiting" --keys "rate-limit-task-context"

# 3. In Task tool prompt, tell subagent:
#    "Claim issue SC-xxxx, implement it, complete when done"
```

### Subagent: Receiving Work

When spawned as a subagent with a task:

```bash
# 1. DON'T start a new session — use the parent's session
#    The project path auto-joins you to the same session

# 2. Claim the assigned issue
sc issue claim SC-xxxx

# 3. Check context the parent left (use low threshold for reliable retrieval)
sc get -s "rate limiting" --threshold 0.3 --json
sc issue show SC-xxxx --json

# 4. Do the work...

# 5. Save your implementation decisions
sc save "rate-limit-impl" "## Rate Limiting Implementation

**Approach:** Sliding window via Redis ZSET
**Key format:** ratelimit:{type}:{identifier}

**Files created:**
- middleware/rate-limit.ts
- lib/redis-rate-limiter.ts" -c progress

# 6. Update issue with verified details
sc issue update SC-xxxx --details "## Implementation
Used Redis ZSET for sliding window.

## Files
- middleware/rate-limit.ts (new)
- lib/redis-rate-limiter.ts (new)
- Added to auth routes"

# 7. Complete the issue
sc issue complete SC-xxxx
```

### Parent Agent: Receiving Results

After subagent completes:

```bash
# 1. Check the issue was completed
sc issue show SC-xxxx --json

# 2. Read what the subagent saved
sc get -s "rate limit" --json

# 3. Continue with the broader feature
```

### Subagent Isolation Patterns

| Pattern | When to Use | How |
|---------|-------------|-----|
| **Shared session** | Subagent is part of same feature | Just claim issue, auto-joins session |
| **Isolated session** | Subagent is independent research | `sc session start "research-X"` with different name |
| **Tagged isolation** | Same session, but separated context | Tag all subagent items with `subagent-taskid` |

**Default recommendation:** Use shared session with tagged isolation. Subagent's work is visible to parent, but tagged for attribution.

---

## Branch Switching Workflow

When switching between git branches with different contexts.

### Before Switching

```bash
# 1. Check current session
sc status

# 2. Tag current work by branch
sc tag add "branch-feature-auth" --pattern "*"

# 3. Checkpoint current state (filtered to branch tag)
sc checkpoint create "feature-auth-wip" --include-git \
  --tags "branch-feature-auth"

# 4. Pause session
sc session pause
```

### After Switching to New Branch

```bash
# 1. Check for existing session on this branch
sc session list --search "feature-payments"

# 2. If exists, resume
sc session resume <session_id>

# 3. If new, start fresh
sc session start "feature-payments" -d "Payment integration"
```

### Returning to Original Branch

```bash
# 1. Find checkpoint
sc checkpoint list -s "feature-auth" --json

# 2. Resume session
sc session list --search "feature-auth"
sc session resume <session_id>

# 3. Restore context if needed
sc checkpoint restore <checkpoint_id>
```

---

## Semantic Search Patterns

Finding context by meaning, not just keywords.

### Basic Search

```bash
# Natural language queries
sc get -s "how did we handle rate limiting"
sc get -s "what database schema decisions were made"
sc get -s "authentication architecture"
```

### Filtered Search

```bash
# Combine search with filters
sc get -s "performance optimization" -c decision
sc get -s "auth" -P high
```

### Cross-Session Search

```bash
# Search ALL sessions (not just current)
sc get -s "how did we solve the memory leak" --all-sessions
```

### Threshold Tuning

```bash
# Default threshold is 0.5

# More results (broader match)
sc get -s "authentication" --threshold 0.3

# Fewer results (precise match)
sc get -s "JWT token rotation" --threshold 0.7
```

### Deep Retrieval Pattern

When initial search isn't enough:

```bash
# 1. Broad search across all sessions
sc get -s "payment integration" --all-sessions --json

# 2. Note session names from results
# Results show: session_name="stripe-integration-v2"

# 3. Find that session
sc session list --search "stripe-integration"

# 4. Switch to it and get full context
sc session switch <session_id>
sc get --json    # Now see all items in that session
```

---

## Implementation Planning Workflow

For complex features requiring architectural planning before implementation.

### When to Create a Plan

Create a plan when:
- Feature requires PRD/specification document
- Work spans multiple epics or major components
- Need to track success criteria separately from tasks
- Multiple agents or developers will reference the same spec

Skip plans for simple features where an epic with subtasks suffices.

### Step 1: Create the Plan

```bash
sc plan create "User Authentication System" \
  --content "## Overview
Implement OAuth2 authentication with JWT tokens and refresh token rotation.

## Requirements
1. Support Google and GitHub OAuth providers
2. JWT access tokens (15min expiry)
3. Refresh token rotation with family tracking
4. Token revocation for logout

## Technical Approach
- Use passport.js for OAuth providers
- RS256 JWT signing with key rotation
- Refresh tokens stored in PostgreSQL with device fingerprinting

## Files Affected
- auth/*.ts - New authentication logic
- middleware/auth.ts - JWT validation middleware
- lib/tokens.ts - Token generation and validation
- db/migrations/*.sql - User and token tables

## Dependencies
- jsonwebtoken, passport, passport-google-oauth20" \
  --criteria "All OAuth flows work end-to-end; Token refresh works without user re-auth; 95% test coverage on auth code" \
  -s active
```

### Step 2: Create Epics with Tasks (Batch)

```bash
sc issue batch --json-input '{
  "planId": "<plan_id>",
  "issues": [
    {
      "title": "Epic: JWT Token Infrastructure",
      "issueType": "epic",
      "description": "Set up JWT generation, validation, and refresh token rotation",
      "details": "## Implementation\n- RS256 key pair generation\n- Access token signing\n- Refresh token storage in PostgreSQL"
    },
    { "title": "Set up JWT key pair generation", "parentId": "$0", "issueType": "task" },
    { "title": "Implement access token generation", "parentId": "$0", "issueType": "task" },
    { "title": "Add refresh token storage", "parentId": "$0", "issueType": "task" },
    {
      "title": "Epic: OAuth Provider Integration",
      "issueType": "epic",
      "description": "Add Google and GitHub OAuth using passport.js"
    },
    { "title": "Add Google OAuth provider", "parentId": "$4", "issueType": "task" },
    { "title": "Add GitHub OAuth provider", "parentId": "$4", "issueType": "task" }
  ],
  "dependencies": [
    { "issueIndex": 2, "dependsOnIndex": 1, "dependencyType": "blocks" },
    { "issueIndex": 3, "dependsOnIndex": 2, "dependencyType": "blocks" }
  ]
}'
```

### Step 3: Execute the Plan

Combine issue tracking with context saves to preserve work across sessions:

```bash
# 1. Get ready issues (open, no blockers, unassigned)
sc issue ready

# 2. Mark epic in_progress FIRST
sc issue update <epic_id> -s in_progress

# 3. Claim work
sc issue claim <task_id>

# 4. Save what you're working on (for session continuity)
sc save "working-on-jwt-gen" "Implementing JWT generation in lib/tokens.ts

Approach: RS256 with rotating key pairs
Files: lib/tokens.ts, lib/keys.ts
Status: In progress" -c progress

# 5. Do the work...

# 6. Save any decisions made during implementation
sc save "jwt-signing-decision" "## JWT Signing Algorithm

Choice: RS256 over HS256
Rationale: Asymmetric keys allow public verification without exposing secret
Trade-off: Slightly larger tokens, key rotation complexity

Impact: lib/tokens.ts, middleware/auth.ts" -c decision -p high

# 7. Save gotchas discovered
sc save "jwt-gotcha-clockskew" "JWT validation fails with 'token not yet valid' if server clocks differ.

Fix: Added 30s clockTolerance to jsonwebtoken verify options.
File: lib/tokens.ts:47" -c note

# 8. Update issue with verified implementation details
sc issue update <task_id> --details "## Summary
Implemented JWT generation with RS256.

## Files Modified
- lib/tokens.ts (new)
- lib/keys.ts (new)"

# 9. Complete the issue
sc issue complete <task_id>

# 10. Claim next issue and repeat
sc issue claim <next_task_id>
```

### Save Rhythm

Follow this cadence to ensure nothing is lost across sessions:

| Event | What to Save | Category | Priority |
|-------|-------------|----------|----------|
| **On claim** | What you're starting, approach | `progress` | normal |
| **On decision** | Architectural choices, rationale, trade-offs | `decision` | high |
| **On gotcha** | Tricky issues, workarounds, fixes | `note` | normal |
| **On complete** | Epic progress summary, what's next | `progress` | normal |
| **On blocker** | What's blocked, why, what's needed | `reminder` | high |

### Viewing Plan Progress

```bash
# Get plan with linked epics
sc plan show <plan_id> --json

# List issues linked to plan
sc issue list --plan <plan_id>

# Check epic completion
sc issue list --plan <plan_id> -t epic

# Recently updated issues (last 7 days)
sc issue list --plan <plan_id> --updated-days 7

# Issues created today
sc issue list --created-hours 24
```

---

## Checklists

### Session Start Checklist

- [ ] Start or resume session with descriptive name
- [ ] Check status: `sc status`
- [ ] Review high-priority decisions: `sc get -P high --json`
- [ ] Check reminders: `sc get -c reminder --json`
- [ ] Check open issues: `sc issue list -s open`

### Pre-Checkpoint Checklist

- [ ] Tag related items by work stream
- [ ] Include `--include-git` for code-affecting changes
- [ ] Use descriptive checkpoint name
- [ ] Add description if context isn't obvious

### Pre-Compaction Checklist

- [ ] Tag critical items with `preserve` or feature tags
- [ ] Ensure current task progress is saved
- [ ] Note any blockers or next steps
- [ ] Run `sc compaction --json`
- [ ] Save the checkpoint ID for restoration
