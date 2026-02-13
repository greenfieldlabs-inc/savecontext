# IssueTracking Workflow

For creating and tracking issues, bugs, and features.

> **For full feature lifecycle** (plan → execute → review → iterate), see `FeatureLifecycle.md`.

## When to Use

- User wants to track a bug or task
- Work needs status tracking
- Tasks may be picked up by another agent
- Multi-step work items

## Step 0: Check What Exists First

**Before creating issues, check for existing work:**

```
context_issue_get_ready                          # What's ready to work on?
context_issue_list search="keyword"              # Search by title/description
context_issue_list status="open"                 # All open issues
context_issue_list issueType="epic"              # Existing epics
```

Don't create duplicates. If related work exists, build on it or update it.

## Quick Issue Pattern

```
context_issue_create
  title="[clear title]"
  description="## Problem\n\n[description]"
  issueType="bug|feature|task|chore"
  priority=2  # 0-4, where 4 is critical
```

## Creating Epics with Subtasks

**Use `issueType: "epic"` for containers, `"task"` for implementation steps.**

```
# Create epic
context_issue_create title="Epic: Auth System" issueType="epic" priority=3

# Create subtasks under the epic
context_issue_create title="Add JWT types" issueType="task" parentId="SC-xxxx"
context_issue_create title="Add middleware" issueType="task" parentId="SC-xxxx"
```

Batch create (preferred for 3+ tasks):
```
context_issue_create_batch issues=[
  { "title": "Epic: Auth System", "issueType": "epic", "priority": 3 },
  { "title": "Add JWT types", "parentId": "$0" },
  { "title": "Add middleware", "parentId": "$0" }
] dependencies=[
  { "issueIndex": 2, "dependsOnIndex": 1, "dependencyType": "blocks" }
]
```

List subtasks: `context_issue_list parentId="SC-xxxx"`

## Work Execution Pattern

**Always claim before implementing:**

```
# 1. Claim issue
context_issue_claim issue_ids=["SC-a1b2"]

# 2. Do the work
# ... implement ...

# 3. Update with verified implementation
context_issue_update
  id="SC-a1b2"
  issue_title="Issue title"
  details="## Summary\n[what you did]\n\n## Files Modified\n- file.ts"

# 4. Complete
context_issue_complete id="SC-a1b2" issue_title="Issue title"
```

## Update Details When Implementation Changes

**Critical:** If your implementation differs from the plan, update details BEFORE completing:

```
context_issue_update
  id="SC-a1b2"
  issue_title="Add date filtering"
  details="## Summary
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

```
# 1. Mark epic in_progress FIRST
context_issue_update id="SC-epic" issue_title="Epic: Auth" status="in_progress"

# 2. Claim and complete each task (with details updates)

# 3. Complete epic when all tasks done
context_issue_complete id="SC-epic" issue_title="Epic: Auth"
```

## Listing Issues

```
context_issue_list status="open"
context_issue_list issueType="bug" priority_min=3
context_issue_list search="authentication"
context_issue_list planId="plan_..."
```

## Examples

**Track a bug:**
```
User: "track this Safari login bug"
→ context_issue_create title="Login fails on Safari 17" issueType="bug" priority=3 description="## Problem\n\nLogin button unresponsive"
```

**Complete with updated details:**
```
User: "I fixed it differently than planned"
→ context_issue_update id="SC-a1b2" issue_title="Login fails" details="## Fix\nWas CSS issue not JS. Changed z-index.\n\n## Files\n- button.css"
→ context_issue_complete id="SC-a1b2" issue_title="Login fails"
```

## Do NOT

- Implement without claiming first
- Complete issues without updating details
- Leave stale details when implementation changes
- Skip marking epic as in_progress before claiming tasks
- Use issueType="feature" for epics (use "epic" -- types affect filtering)
- Create flat issues when work has parent-child structure
