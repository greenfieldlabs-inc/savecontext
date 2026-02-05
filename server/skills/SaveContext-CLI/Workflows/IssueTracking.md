# IssueTracking Workflow

For creating and tracking issues, bugs, and features.

## When to Use

- User wants to track a bug or task
- Work needs status tracking
- Tasks may be picked up by another agent
- Multi-step work items

## Quick Issue Pattern

```bash
sc issue create "<title>" -t <type> -p <priority> -d "<description>"
```

Types: `bug`, `feature`, `task`, `epic`, `chore`
Priority: `0` (lowest) to `4` (critical)

## Work Execution Pattern

**Always claim before implementing:**

```bash
# 1. Claim issue
sc issue claim <short_id>

# 2. Do the work
# ... implement ...

# 3. Update with verified implementation
sc issue update <short_id> --details "## Summary
What was done

## Files Modified
- file.ts"

# 4. Complete
sc issue complete <short_id>
```

## Update Details When Implementation Changes

**Critical:** If your implementation differs from the plan, update details BEFORE completing:

```bash
sc issue update <short_id> --details "## Summary
Changed approach from absolute to relative timestamps.

## Implementation
- Added created_in_last_days param
- Created utils/time.ts

## Files Modified
- registry.ts
- time.ts (new)"
```

Why: Future agents need accurate context. The issue is the source of truth.

## Multi-Task Work (5+ issues)

Create a Plan first, then link issues. See `Planning.md` workflow.

## Epic Execution Pattern

```bash
# 1. Mark epic in_progress FIRST
sc issue update <epic_id> -s in_progress

# 2. Claim and complete each task (with details updates)

# 3. Complete epic when all tasks done
sc issue complete <epic_id>
```

## Listing Issues

```bash
sc issue list -s open
sc issue list -t bug --priority-min 3
sc issue list --search "authentication"
sc issue list --plan <plan_id>
```

## Examples

**Track a bug:**
```bash
# User: "track this Safari login bug"
sc issue create "Login fails on Safari 17" -t bug -p 3 -d "Login button unresponsive on Safari 17"
```

**Complete with updated details:**
```bash
# User: "I fixed it differently than planned"
sc issue update <id> --details "## Fix
Was CSS issue not JS. Changed z-index.

## Files
- button.css"

sc issue complete <id>
```

## Do NOT

- Implement without claiming first
- Complete issues without updating details
- Leave stale details when implementation changes
- Skip marking epic as in_progress before claiming tasks
