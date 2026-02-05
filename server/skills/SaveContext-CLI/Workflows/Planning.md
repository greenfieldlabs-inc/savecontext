# Planning Workflow

For multi-task features, releases, or work spanning 5+ issues.

## When to Use

- Feature with multiple subtasks
- Release planning
- Work that needs epics and dependencies
- User says "plan this feature", "implement [complex thing]"

## Pattern

```bash
# 1. Create plan
sc plan create "Feature Name" --content "## Overview

## Goals

## Success Criteria" -s active

# 2. Create epics with tasks linked to plan (batch mode)
sc issue batch --json-input '{
  "planId": "<plan_id>",
  "issues": [
    { "title": "Epic: Feature A", "issueType": "epic", "details": "## Implementation\n..." },
    { "title": "Task 1", "parentId": "$0", "issueType": "task" },
    { "title": "Task 2", "parentId": "$0", "issueType": "task" }
  ],
  "dependencies": [
    { "issueIndex": 2, "dependsOnIndex": 1, "dependencyType": "blocks" }
  ]
}'

# 3. Present plan to user before implementing
```

## Plan Content Structure

```markdown
## Overview
[What this plan accomplishes]

## Goals
- Goal 1
- Goal 2

## Priority Order
1. Epic A (highest)
2. Epic B
3. Epic C (backlog)

## Success Criteria
- All tests pass
- No regressions
```

## Batch Creation with References

Use `$N` to reference earlier issues in the batch:

```json
{
  "issues": [
    { "title": "Epic: Auth", "issueType": "epic" },
    { "title": "Add JWT types", "parentId": "$0" },
    { "title": "Add middleware", "parentId": "$0" },
    { "title": "Add MCP tool", "parentId": "$0" }
  ],
  "dependencies": [
    { "issueIndex": 2, "dependsOnIndex": 1, "dependencyType": "blocks" },
    { "issueIndex": 3, "dependsOnIndex": 2, "dependencyType": "blocks" }
  ]
}
```

## Managing Plans

```bash
# List active plans
sc plan list

# Get plan with linked issues
sc plan show <plan_id>

# Mark plan complete
sc plan update <plan_id> -s completed
```

## Examples

**Plan a feature:**
```bash
# User: "implement user notifications"

sc plan create "User Notifications" --content "## Overview
Real-time notifications system

## Success Criteria
- Users receive notifications
- Read/unread state tracked" -s active

sc issue batch --json-input '{
  "planId": "<plan_id>",
  "issues": [
    { "title": "Epic: Notification System", "issueType": "epic" },
    { "title": "Add notification model", "parentId": "$0" },
    { "title": "Add WebSocket handler", "parentId": "$0" },
    { "title": "Add notification UI", "parentId": "$0" }
  ]
}'

# → "Created plan with 1 epic and 3 tasks. Ready to implement?"
```

## Do NOT

- Skip plans for multi-task work
- Create issues without linking to plan
- Start implementing before presenting plan
