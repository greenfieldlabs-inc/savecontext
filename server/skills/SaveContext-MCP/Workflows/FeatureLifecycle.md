# FeatureLifecycle Workflow

End-to-end workflow for taking a feature from idea to completion with user review.

## When to Use

- User asks to "implement", "build", or "add" something non-trivial
- Work requires multiple files or steps
- User says "plan this feature", "let's build X"
- Any task where you'd create more than 2-3 issues

## The Five Phases

```
Discover → Plan → Execute → Review → Complete
    ↑                          |
    └──────── iterate ─────────┘
```

---

## Phase 1: Discover

**Before creating anything, check what already exists.**

```
# Check for existing plans
context_plan_list

# Check for existing issues related to this work
context_issue_list search="feature name"
context_issue_list status="open"

# Check for ready work (open, no blockers)
context_issue_get_ready
```

If related work exists, build on it. Don't create duplicates.

---

## Phase 2: Plan

**Decompose the feature into a plan, epics, and tasks. Present to user BEFORE implementing.**

### Step 1: Create the plan

```
context_plan_create
  title="Feature Name"
  content="## Overview\nWhat this feature does and why.\n\n## Goals\n- Goal 1\n- Goal 2\n\n## Approach\nTechnical approach and key decisions.\n\n## Success Criteria\n- Criterion 1\n- Criterion 2"
  status="active"
```

### Step 2: Create epics with tasks

```
context_issue_create_batch
  planId="<plan_id>"
  issues=[
    {
      "title": "Epic: First Major Piece",
      "issueType": "epic",
      "priority": 3,
      "description": "What this epic delivers",
      "details": "## Implementation\n- Step A\n- Step B\n- Step C"
    },
    { "title": "Implement step A", "parentId": "$0", "issueType": "task" },
    { "title": "Implement step B", "parentId": "$0", "issueType": "task" },
    { "title": "Implement step C", "parentId": "$0", "issueType": "task" },
    {
      "title": "Epic: Second Major Piece",
      "issueType": "epic",
      "priority": 2
    },
    { "title": "Implement step D", "parentId": "$4", "issueType": "task" },
    { "title": "Implement step E", "parentId": "$4", "issueType": "task" }
  ]
  dependencies=[
    { "issueIndex": 2, "dependsOnIndex": 1, "dependencyType": "blocks" },
    { "issueIndex": 3, "dependsOnIndex": 2, "dependencyType": "blocks" }
  ]
```

### Step 3: Present to user and WAIT

Show the user:
- The plan overview and success criteria
- The epic/task breakdown
- The dependency order
- Estimated scope

**Ask the user if the plan looks right before implementing.** They may want to:
- Reorder priorities
- Add or remove tasks
- Change the approach
- Split into smaller phases

Do NOT start implementing until the user approves.

---

## Phase 3: Execute

**Work through tasks in dependency order, claiming each before starting.**

```
# 1. Mark the epic in_progress
context_issue_update id="<epic_id>" issue_title="Epic: ..." status="in_progress"

# 2. Find what's ready to work on
context_issue_get_ready

# 3. Claim the task
context_issue_claim issue_ids=["<task_id>"]

# 4. Do the work...

# 5. Update the issue with what you actually did
context_issue_update
  id="<task_id>"
  issue_title="Task title"
  details="## Summary\nWhat was implemented.\n\n## Files Modified\n- file.ts"

# 6. Complete the task
context_issue_complete id="<task_id>" issue_title="Task title"

# 7. Claim next task and repeat
```

### Save decisions as you go

```
context_save
  key="decision-key"
  value="## Decision: [What]\n\n**Choice:** [What you chose]\n**Rationale:** [Why]\n**Trade-off:** [What you gave up]"
  category="decision"
  priority="high"
```

### If implementation diverges from plan

Update the issue details BEFORE completing so future agents see what actually happened:

```
context_issue_update
  id="<task_id>"
  issue_title="Task title"
  details="## Summary\nChanged approach from X to Y because of [reason].\n\n## Actual Implementation\n- [what was really done]"
```

---

## Phase 4: Review

**After completing an epic (or a meaningful chunk), check in with the user.**

### Present results

Show the user:
1. What was completed (list of tasks with summaries)
2. What changed from the original plan (if anything)
3. Any decisions made during implementation
4. What's next (remaining epics/tasks)

### Ask for feedback

The user may:
- **Approve** — move to next epic or complete
- **Request changes** — create new issues for adjustments, loop back to Execute
- **Reprioritize** — reorder remaining work
- **Add scope** — new tasks discovered during review

### Handle change requests

```
# Create issues for requested changes
context_issue_create
  title="Fix spacing in header"
  issueType="task"
  parentId="<epic_id>"
  priority=3

# Or batch if multiple
context_issue_create_batch
  planId="<plan_id>"
  issues=[
    { "title": "Fix spacing in header", "parentId": "<epic_id>", "issueType": "task" },
    { "title": "Add loading state to button", "parentId": "<epic_id>", "issueType": "task" }
  ]

# Loop back to Execute phase
```

### Iterate until the user is satisfied

```
Execute epic → Present results → User feedback → Adjust → Repeat
```

Only move to Phase 5 when the user confirms the work is complete.

---

## Phase 5: Complete

**Close everything out cleanly.**

```
# 1. Complete the epic
context_issue_complete id="<epic_id>" issue_title="Epic: ..."

# 2. File issues for remaining work
context_issue_create title="Follow-up: add integration tests" issueType="task" priority=1

# 3. Defer work that's not happening now
context_issue_update id="<deferred_id>" issue_title="..." status="deferred"

# 4. Mark plan complete
context_plan_update plan_id="<plan_id>" status="completed"

# 5. Save a summary
context_save
  key="feature-complete"
  value="## Feature Complete: [Name]\n\n**Delivered:**\n- [what was built]\n\n**Follow-ups:**\n- SC-xxxx"
  category="progress"
```

---

## Quick Reference: The Loop

| Phase | Key Tools | User Involved? |
|-------|-----------|----------------|
| **Discover** | `context_issue_get_ready`, `context_plan_list`, `context_issue_list` | No |
| **Plan** | `context_plan_create`, `context_issue_create_batch` | Yes — approve plan |
| **Execute** | `context_issue_claim`, `context_issue_complete`, `context_save` | No (heads down) |
| **Review** | Present results, `context_issue_create` for changes | Yes — approve or iterate |
| **Complete** | `context_plan_update`, `context_issue_complete` | Yes — final sign-off |

## Do NOT

- Start implementing before user approves the plan
- Complete a review phase without asking the user for feedback
- Skip the Discover phase (you'll create duplicates)
- Use issueType="feature" for epics (use "epic" for work containers)
- Create flat issues when work has parent-child structure
- Mark the plan complete before all epics are done
- Forget to file follow-up issues for remaining work
