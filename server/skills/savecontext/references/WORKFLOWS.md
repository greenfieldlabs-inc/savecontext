# SaveContext Workflows

Detailed workflow patterns for common scenarios.

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

```
# 1. Start session with descriptive name
context_session_start
  name="implementing-user-authentication"
  description="Adding OAuth2 with JWT tokens, refresh token rotation"

# 2. Save initial architectural decisions (well-formatted!)
context_save
  key="auth-architecture"
  value="## Authentication Architecture

**Choice:** OAuth2 with JWT access tokens + refresh tokens
**Token Lifetimes:** Access: 15min, Refresh: 7 days

**Storage:** Refresh tokens in PostgreSQL with device fingerprinting
**Rationale:** Stateless access tokens scale horizontally; refresh tokens enable revocation

**Trade-off:** Requires token blocklist for immediate revocation

Impact: `auth/`, `middleware/`, `lib/tokens.ts`"
  category="decision"
  priority="high"

# 3. Track progress as you work (include next steps!)
context_save
  key="auth-progress-day1"
  value="## Auth Implementation - Day 1

**Completed:**
- JWT generation with RS256 signing
- Token validation middleware
- User claims extraction

**Current state:** Core token flow working, tests passing

**Next:** Implement refresh token rotation endpoint
**Files touched:** `auth/jwt.ts`, `middleware/auth.ts`"
  category="progress"

# 4. Before stopping, tag and checkpoint
context_tag keys=["auth-architecture", "auth-progress-day1"] tags=["auth"] action="add"
context_checkpoint name="auth-day1-complete"
context_session_pause
```

### Day 2: Resuming Work

```
# 1. Start session (auto-resumes)
context_session_start name="implementing-user-authentication"

# 2. Check what was done
context_get category="decision" priority="high"
context_get category="progress"

# 3. Continue work, save new progress (well-formatted!)
context_save
  key="auth-progress-day2"
  value="## Auth Implementation - Day 2

**Completed:**
- Refresh token rotation with family tracking
- Logout endpoint with token revocation
- Token blocklist in Redis (5min TTL for access tokens)

**Current state:** Full auth flow operational, 94% test coverage

**Next:** Rate limiting on auth endpoints
**Blocked by:** None
**Files touched:** `auth/refresh.ts`, `auth/logout.ts`, `lib/redis.ts`"
  category="progress"

# 4. Save any new decisions (with rationale!)
context_save
  key="auth-rate-limit-decision"
  value="## Rate Limiting Strategy

**Choice:** Sliding window algorithm via Redis
**Limits:**
- Login: 5 attempts/minute/IP
- Token refresh: 10 attempts/minute/user
- Password reset: 3 attempts/hour/email

**Rationale:** Sliding window prevents burst attacks while being fair to legitimate users
**Rejected:** Fixed window (allows burst at boundary), token bucket (overkill for auth)

**Trade-off:** Requires Redis; adds ~2ms latency per request

Impact: `middleware/rate-limit.ts`, `lib/redis.ts`"
  category="decision"
  priority="high"
```

### Finishing the Feature

```
# 1. Tag all auth items
context_tag key_pattern="auth-*" tags=["auth", "v1.2"] action="add"

# 2. Create completion checkpoint
context_checkpoint name="auth-feature-complete" include_git=true

# 3. End or pause based on next steps
context_session_end  # If done with this task
context_session_pause  # If might continue later
```

---

## Pre-Refactor Checkpoint Workflow

Before making significant changes to the codebase.

### Before Refactoring

```
# 1. Document current state (be specific!)
context_save
  key="pre-refactor-state"
  value="## Pre-Refactor: Session to JWT Migration

**Current architecture:** Express-session with Redis store
**Why migrating:** Horizontal scaling issues; sessions don't work well with serverless

**Files affected:**
- `auth/*.ts` - Session creation/validation logic
- `middleware/*.ts` - Auth middleware checks session
- `tests/auth/*.test.ts` - 47 tests depend on session mocking

**Risk areas:**
- Concurrent request handling during migration
- Existing logged-in users will be logged out
- Mobile app caches session tokens

**Rollback plan:** Feature flag `USE_JWT_AUTH` allows instant rollback"
  category="note"
  priority="high"

# 2. Capture refactor plan (with acceptance criteria!)
context_save
  key="refactor-plan"
  value="## TODO: JWT Migration

**Context:** Moving from sessions to JWT for stateless auth

**Steps:**
1. Add JWT utils (`lib/jwt.ts`) - generation, validation, refresh
2. Update middleware to check JWT OR session (parallel support)
3. Migrate endpoints one-by-one behind feature flag
4. Update tests to support both auth methods
5. Remove session code after 1 week of JWT-only

**Acceptance criteria:**
- All 47 auth tests pass
- No increase in auth latency (p99 < 50ms)
- Existing mobile sessions gracefully migrated

**Estimated scope:** 12 files, ~400 lines changed"
  category="reminder"
  priority="high"

# 3. Create checkpoint with git status
context_checkpoint
  name="pre-jwt-migration"
  include_git=true
  description="State before migrating from sessions to JWT"
```

### If Refactor Goes Wrong

```
# 1. Check checkpoint
context_list_checkpoints search="pre-jwt"

# 2. Get details
context_get_checkpoint checkpoint_id="..."

# 3. Restore context (doesn't restore code, just context)
context_restore
  checkpoint_id="..."
  checkpoint_name="pre-jwt-migration"

# Note: Use git to restore code changes
```

---

## Compaction Recovery Workflow

When context gets too long and needs compaction.

### Detecting Compaction Need

```
# Check status
context_status

# Response includes:
# - should_compact: true/false
# - compaction_reason: "High item count (45 items)" or "Context usage at 75%"
```

### Preparing for Compaction

```
# 1. Ensure important items are tagged
context_get  # Review all items
context_tag keys=["critical-decision-1", "current-task"] tags=["preserve"] action="add"

# 2. Call prepare_compaction
context_prepare_compaction

# Response includes:
# - checkpoint: { id, name }
# - critical_context: summary of high-priority items
# - restore_instructions: how to continue in new session
```

### Continuing After Compaction

In a NEW conversation (after the old one was compacted):

```
# 1. Start session (will auto-resume)
context_session_start name="same-session-name"

# 2. Restore from compaction checkpoint
context_list_checkpoints search="compaction"
context_restore
  checkpoint_id="..."
  checkpoint_name="auto-compaction-..."

# 3. Check restored context
context_get priority="high"
context_get category="reminder"
```

---

## Multi-Agent Coordination

When multiple AI agents work on the same project.

### Agent A (Claude Code Terminal)

```
# Start session
context_session_start name="feature-payments"

# Save work (well-formatted so Agent B understands!)
context_save
  key="stripe-integration-progress"
  value="## Stripe Integration - Terminal Agent

**Completed:**
- Checkout session endpoint (`POST /api/checkout`)
- Price ID lookup from product catalog
- Success/cancel URL configuration

**Current state:** Checkout creates Stripe session, redirects to hosted page

**Next:** Webhook handler for payment confirmation
**Blocked by:** Need webhook signing secret in env

**Files:** `routes/checkout.ts`, `lib/stripe.ts`
**Test coverage:** 3 tests added, all passing"
  category="progress"

# Tag by agent for attribution
context_tag keys=["stripe-integration-progress"] tags=["terminal-agent", "payments"] action="add"
```

### Agent B (Claude Desktop or Cursor)

```
# Same session (auto-joins)
context_session_start name="feature-payments"

# Check what terminal agent did
context_get tags=["terminal-agent"]

# Continue work (reference what Agent A did!)
context_save
  key="stripe-webhook-handler"
  value="## Stripe Webhooks - Desktop Agent

**Completed:**
- Webhook endpoint (`POST /api/webhooks/stripe`)
- Signature verification using `stripe.webhooks.constructEvent`
- Event handlers: `checkout.session.completed`, `invoice.paid`

**Building on:** Terminal agent's checkout flow (see `stripe-integration-progress`)

**Current state:** Webhooks verified and processed, order status updated

**Next:** Add `invoice.payment_failed` handler for dunning
**Files:** `routes/webhooks.ts`, `services/orders.ts`
**Test coverage:** 5 tests (mocked Stripe events)"
  category="progress"

context_tag keys=["stripe-webhook-handler"] tags=["desktop-agent", "payments"] action="add"
```

### Coordination Pattern

Both agents see each other's context. Use tags to track who did what:
- Tag by agent: `terminal-agent`, `desktop-agent`, `cursor-agent`
- Tag by feature: `payments`, `auth`, `ui`
- Combine: Both agents tag with `payments`, individual agent tags for attribution

---

## Branch Switching Workflow

When switching between git branches with different contexts.

### Before Switching

```
# 1. Check current session
context_status

# 2. Tag current work by branch
context_tag key_pattern="*" tags=["branch-feature-auth"] action="add"

# 3. Checkpoint current state
context_checkpoint
  name="feature-auth-wip"
  include_git=true
  include_tags=["branch-feature-auth"]

# 4. Pause session
context_session_pause
```

### After Switching to New Branch

```
# 1. Check for existing session on this branch
context_list_sessions search="feature-payments"

# 2. If exists, resume
context_session_resume session_id="..." session_name="..."

# 3. If new, start fresh
context_session_start name="feature-payments"
```

### Returning to Original Branch

```
# 1. Find checkpoint
context_list_checkpoints search="feature-auth"

# 2. Resume session
context_list_sessions search="feature-auth"
context_session_resume session_id="..." session_name="..."

# 3. Restore context if needed
context_restore checkpoint_id="..." checkpoint_name="feature-auth-wip"
```

---

## Semantic Search Patterns

Finding context by meaning.

### Basic Search

```
# Natural language queries
context_get query="how did we handle rate limiting"
context_get query="what database schema decisions were made"
context_get query="authentication architecture"
```

### Filtered Search

```
# Combine query with filters
context_get query="performance optimization" category="decision"
context_get query="auth" priority="high"
```

### Cross-Session Search

```
# Search ALL sessions (not just current)
context_get query="how did we solve the memory leak" search_all_sessions=true
```

### Threshold Tuning

```
# Default threshold is 0.5

# More results (broader match)
context_get query="authentication" threshold=0.3

# Fewer results (precise match)
context_get query="JWT token rotation" threshold=0.7
```

### Deep Retrieval Pattern

When initial search isn't enough:

```
# 1. Broad search
context_get query="payment integration" search_all_sessions=true

# 2. Note session names from results
# Results show: session_name="stripe-integration-v2"

# 3. Find that session
context_list_sessions search="stripe-integration"

# 4. Switch or get full context
context_session_switch session_id="..." session_name="..."
context_get  # Now see all items in that session
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

### Step 1: Enter Plan Mode

Before creating a SaveContext plan, enter your tool's planning mode to explore the codebase and design the approach:

**Claude Code (CLI):**
```
# Claude Code has an EnterPlanMode tool
# Use it to explore codebase, understand architecture, design approach
# Write your implementation plan in the plan file
# Exit plan mode when ready to create SaveContext plan
```

**Other CLI Tools and AI Coding Agents:**
- Enter your plan mode if available
- Research existing patterns in the codebase
- Understand affected files and dependencies
- Draft implementation approach before committing to plan

### Step 2: Create the Plan

```
context_plan_create
  title="User Authentication System"
  content="## Overview
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
- jsonwebtoken, passport, passport-google-oauth20
- @types/passport, @types/jsonwebtoken"
  successCriteria="- All OAuth flows work end-to-end
- Token refresh works without user re-auth
- 95% test coverage on auth code
- No increase in login latency (p99 < 200ms)"
  status="active"
```

### Step 3: Create Epics Linked to Plan

Break the plan into major work streams (epics):

```
# Epic 1: Core JWT infrastructure
context_issue_create
  title="Implement JWT token infrastructure"
  issueType="epic"
  planId="PLAN-abc123"
  priority=3
  description="Set up JWT generation, validation, and refresh token rotation"

# Epic 2: OAuth provider integration
context_issue_create
  title="Integrate OAuth providers"
  issueType="epic"
  planId="PLAN-abc123"
  priority=3
  description="Add Google and GitHub OAuth using passport.js"

# Epic 3: Auth middleware and protection
context_issue_create
  title="Implement auth middleware"
  issueType="epic"
  planId="PLAN-abc123"
  priority=2
  description="Create middleware for protected routes and token validation"
```

### Step 4: Create Tasks Under Epics

Break epics into implementable tasks:

```
# Tasks for JWT infrastructure epic
context_issue_create
  title="Set up JWT key pair generation"
  issueType="task"
  parentId="EPIC-1"  # Parent epic ID
  planId="PLAN-abc123"
  description="Create script for RS256 key generation and rotation"

context_issue_create
  title="Implement access token generation"
  issueType="task"
  parentId="EPIC-1"
  planId="PLAN-abc123"
  description="Create lib/tokens.ts with sign/verify functions"

context_issue_create
  title="Add refresh token storage"
  issueType="task"
  parentId="EPIC-1"
  planId="PLAN-abc123"
  description="Create token_families table and repository"
```

### Step 5: Set Dependencies

```
# Token verification depends on token generation
context_issue_add_dependency
  issueId="TASK-verify-tokens"
  dependsOnId="TASK-generate-tokens"
  dependencyType="blocks"
```

### Step 6: Execute the Plan

Combine issue tracking with context saves to preserve work across sessions:

```
# 1. Get ready issues (open, no blockers, unassigned)
context_issue_get_ready

# 2. Claim work
context_issue_claim issue_ids=["TASK-jwt-gen"]

# 3. Save what you're working on (for session continuity)
context_save
  key="working-on-jwt-gen"
  value="Implementing JWT generation in lib/tokens.ts

Approach: RS256 with rotating key pairs
Files: lib/tokens.ts, lib/keys.ts
Status: In progress"
  category="progress"

# 4. Do the work...

# 5. Save any decisions made during implementation
context_save
  key="jwt-signing-decision"
  value="## JWT Signing Algorithm

Choice: RS256 over HS256
Rationale: Asymmetric keys allow public verification without exposing secret
Trade-off: Slightly larger tokens, key rotation complexity

Impact: lib/tokens.ts, middleware/auth.ts"
  category="decision"
  priority="high"

# 6. Save gotchas discovered
context_save
  key="jwt-gotcha-clockskew"
  value="JWT validation fails with 'token not yet valid' if server clocks differ.

Fix: Added 30s clockTolerance to jsonwebtoken verify options.
File: lib/tokens.ts:47"
  category="note"

# 7. Complete the issue
context_issue_complete id="TASK-jwt-gen" issue_title="Implement JWT generation"

# 8. Update progress for the epic
context_save
  key="epic-jwt-progress"
  value="## JWT Infrastructure Epic

Completed:
- TASK-jwt-gen: JWT generation with RS256 ✓

In Progress:
- TASK-jwt-verify: Token validation middleware

Remaining:
- TASK-refresh-tokens: Refresh token rotation

Blockers: None
Next: Implement verify middleware"
  category="progress"

# 9. Claim next issue and repeat
context_issue_claim issue_ids=["TASK-jwt-verify"]
```

**Save Rhythm:**
- **On claim**: Save what you're starting (category: progress)
- **On decisions**: Save architectural choices immediately (category: decision, priority: high)
- **On gotchas**: Save tricky issues and their fixes (category: note)
- **On complete**: Update epic progress summary (category: progress)
- **On blockers**: Save blocker details (category: reminder, priority: high)

### Description Standards

**Plan Descriptions:**
```markdown
## Overview
One paragraph explaining the feature and its value.

## Requirements
Numbered list of functional requirements.

## Technical Approach
How you'll implement it (patterns, libraries, architecture).

## Files Affected
List of files/directories that will change.

## Dependencies
External packages needed.
```

**Epic Descriptions:**
```markdown
Brief statement of what this work stream accomplishes.

Scope: [files or components affected]
Depends on: [other epics if any]
```

**Task Descriptions:**
```markdown
Specific implementation details.
File: [primary file to modify]
Acceptance: [how to verify it's done]
```

### Plan Status Transitions

```
draft → active → completed
```

- **draft**: Plan is being written, not ready for implementation
- **active**: Plan approved, epics/tasks can be worked
- **completed**: All success criteria met

### Viewing Plan Progress

```
# Get plan with linked epics
context_plan_get plan_id="PLAN-abc123"

# List issues linked to plan
context_issue_list planId="PLAN-abc123"

# Check epic completion
context_issue_list planId="PLAN-abc123" issueType="epic"
```

---

## Checklist Templates

### Session Start Checklist

- [ ] Call `context_session_start` with descriptive name
- [ ] Check `context_status` for existing items
- [ ] Review high-priority decisions: `context_get priority="high"`
- [ ] Check current tasks: `context_get category="reminder"`

### Pre-Checkpoint Checklist

- [ ] Tag related items by work stream
- [ ] Include `include_git=true` for code-affecting changes
- [ ] Use descriptive checkpoint name
- [ ] Add description if context isn't obvious

### Pre-Compaction Checklist

- [ ] Tag critical items with `preserve` or feature tags
- [ ] Ensure current task is saved
- [ ] Note any blockers or next steps
- [ ] Call `context_prepare_compaction`
- [ ] Save the checkpoint ID for restoration
