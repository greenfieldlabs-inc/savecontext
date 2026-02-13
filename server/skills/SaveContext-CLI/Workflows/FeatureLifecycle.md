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

```bash
# Check for existing plans
sc plan list

# Check for existing issues related to this work
sc issue list --search "feature name"
sc issue list -s open

# Check for ready work (open, no blockers)
sc issue ready
```

If related work exists, build on it. Don't create duplicates.

---

## Phase 2: Plan

**Decompose the feature into a plan, epics, and tasks. Present to user BEFORE implementing.**

### Step 1: Create the plan

```bash
sc plan create "Feature Name" --content "## Overview
What this feature does and why.

## Goals
- Goal 1
- Goal 2

## Approach
Technical approach and key decisions.

## Success Criteria
- Criterion 1
- Criterion 2" -s active
```

### Step 2: Create epics with tasks

```bash
sc issue batch --json-input '{
  "planId": "<plan_id>",
  "issues": [
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
  ],
  "dependencies": [
    { "issueIndex": 2, "dependsOnIndex": 1, "dependencyType": "blocks" },
    { "issueIndex": 3, "dependsOnIndex": 2, "dependencyType": "blocks" }
  ]
}'
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

```bash
# 1. Mark the epic in_progress
sc issue update <epic_id> -s in_progress

# 2. Find what's ready to work on
sc issue ready

# 3. Claim the task
sc issue claim <task_id>

# 4. Do the work...

# 5. Update the issue with what you actually did
sc issue update <task_id> --details "## Summary
What was implemented and how.

## Files Modified
- path/to/file.ts - description of change
- path/to/other.ts - description of change

## Decisions Made
- Chose X over Y because Z"

# 6. Complete the task
sc issue complete <task_id>

# 7. Claim next task and repeat
```

### Save decisions as you go

When you make an architectural choice during implementation:

```bash
sc save "decision-key" "## Decision: [What]

**Choice:** [What you chose]
**Rationale:** [Why]
**Trade-off:** [What you gave up]
**Impact:** [Files/areas affected]" -c decision -p high
```

### If implementation diverges from plan

Update the issue details BEFORE completing so future agents (or the user) see what actually happened, not what was planned:

```bash
sc issue update <task_id> --details "## Summary
Changed approach from X to Y because of [reason].

## Actual Implementation
- [what was really done]

## Files Modified
- [actual files]"
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

```bash
# Create issues for requested changes
sc issue create "Fix spacing in header component" \
  -t task --parent <epic_id> -p 3

# Or batch if multiple changes
sc issue batch --json-input '{
  "planId": "<plan_id>",
  "issues": [
    { "title": "Fix spacing in header", "parentId": "<epic_id>", "issueType": "task" },
    { "title": "Add loading state to button", "parentId": "<epic_id>", "issueType": "task" }
  ]
}'

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

```bash
# 1. Complete the epic (if not already)
sc issue complete <epic_id>

# 2. File issues for any remaining work or follow-ups
sc issue create "Follow-up: add integration tests" -t task -p 1

# 3. Update issue statuses
#    - Close finished work
#    - Defer work that's not happening now
sc issue update <deferred_id> -s deferred

# 4. Mark plan complete (if all epics done)
sc plan update <plan_id> -s completed

# 5. Save a summary
sc save "feature-complete" "## Feature Complete: [Name]

**Delivered:**
- [what was built]

**Follow-ups filed:**
- SC-xxxx: [description]

**Decisions log:**
- [key decisions for future reference]" -c progress
```

---

## Quick Reference: The Loop

| Phase | Key Commands | User Involved? |
|-------|-------------|----------------|
| **Discover** | `sc issue ready`, `sc plan list`, `sc issue list --search` | No |
| **Plan** | `sc plan create`, `sc issue batch` | Yes — approve plan |
| **Execute** | `sc issue claim`, `sc issue complete`, `sc save` | No (heads down) |
| **Review** | Present results, `sc issue create` for changes | Yes — approve or iterate |
| **Complete** | `sc plan update -s completed`, `sc issue complete` | Yes — final sign-off |

## Do NOT

- Start implementing before user approves the plan
- Complete a review phase without asking the user for feedback
- Skip the Discover phase (you'll create duplicates)
- Use `-t feature` for epics (use `-t epic` for work containers)
- Create flat issues when work has parent-child structure
- Mark the plan complete before all epics are done
- Forget to file follow-up issues for remaining work
