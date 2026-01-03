import {
  SESSION_NAME_MAX_LENGTH,
  CONTEXT_VALUE_MAX_LENGTH,
  CONTEXT_ITEMS_MAX_LIMIT,
} from '../utils/constants.js';

export const tools = [
      {
        name: 'context_session_start',
        description: 'Start a new coding session or resume existing one. Auto-derives channel from git branch. Call at conversation start or when switching contexts. Use force_new=true to always create a fresh session instead of resuming an existing one. IMPORTANT: Always pass project_path with the specific project folder path (not workspace root). If working in a monorepo or unsure which project folder to use, ask the user before calling this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: SESSION_NAME_MAX_LENGTH,
              description: 'Session name (e.g., "Implementing Authentication")',
            },
            description: {
              type: 'string',
              description: 'Session description',
            },
            project_path: {
              type: 'string',
              description: 'Project folder path. Always pass this to ensure correct project tracking. Ask the user if unsure which folder to use.',
            },
            channel: {
              type: 'string',
              description: 'Optional channel name (auto-derived from git branch if not provided)',
            },
            force_new: {
              type: 'boolean',
              description: 'Force create a new session instead of resuming existing one. Use when you want to start fresh.',
            },
          },
          required: ['name', 'description'],
        },
      },
      {
        name: 'context_save',
        description: 'Save individual context items (decisions, reminders, notes, progress). Use frequently to capture important information. Supports categories (reminder/decision/progress/note) and priorities (high/normal/low).',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Unique key for this context item (e.g., "current_task", "auth_decision")',
            },
            value: {
              type: 'string',
              maxLength: CONTEXT_VALUE_MAX_LENGTH,
              description: 'The context value to save (max 100KB)',
            },
            category: {
              type: 'string',
              enum: ['reminder', 'decision', 'progress', 'note'],
              description: 'Category of this context item',
            },
            priority: {
              type: 'string',
              enum: ['high', 'normal', 'low'],
              description: 'Priority level',
            },
            channel: {
              type: 'string',
              description: 'Channel to save to (uses session default if not specified)',
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'context_get',
        description: 'Retrieve saved context items. PREFER using query param for semantic search when looking for specific information - searches item values by meaning. Use key for exact retrieval, or filters (category, priority) when browsing.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'RECOMMENDED: Semantic search query to find items by meaning (e.g., "how did we handle authentication"). Cloud mode uses AI-powered search; local mode uses keyword fallback.',
            },
            search_all_sessions: {
              type: 'boolean',
              description: 'When using query, search across ALL your sessions (default: false, searches current session only)',
            },
            threshold: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Semantic search threshold (0-1). Lower = more results. Default: 0.5. Only applies to cloud mode.',
            },
            key: {
              type: 'string',
              description: 'Exact key to retrieve a specific item (bypasses search)',
            },
            category: {
              type: 'string',
              enum: ['reminder', 'decision', 'progress', 'note'],
              description: 'Filter by category',
            },
            priority: {
              type: 'string',
              enum: ['high', 'normal', 'low'],
              description: 'Filter by priority',
            },
            channel: {
              type: 'string',
              description: 'Filter by channel',
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: CONTEXT_ITEMS_MAX_LIMIT,
              description: 'Maximum items to return (default: 100)',
            },
            offset: {
              type: 'number',
              description: 'Number of items to skip (for pagination)',
            },
          },
        },
      },
      {
        name: 'context_delete',
        description: 'Delete a context item from the current session. Use to remove outdated information, fix mistakes, or clean up test data.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Key of the context item to delete',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'context_update',
        description: 'Update an existing context item. Change the value, category, priority, or channel of a previously saved item.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Key of the context item to update',
            },
            value: {
              type: 'string',
              description: 'New value for the context item',
            },
            category: {
              type: 'string',
              enum: ['reminder', 'decision', 'progress', 'note'],
              description: 'New category',
            },
            priority: {
              type: 'string',
              enum: ['high', 'normal', 'low'],
              description: 'New priority level',
            },
            channel: {
              type: 'string',
              description: 'New channel',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'context_memory_save',
        description: 'Save project memory (command, config, or note) for current project. Memory persists across sessions and is accessible by all agents working on this project.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Unique key for this memory item (e.g., "run_tests", "api_endpoint")',
            },
            value: {
              type: 'string',
              description: 'The value to remember (command, URL, note, etc.)',
            },
            category: {
              type: 'string',
              enum: ['command', 'config', 'note'],
              description: 'Type of memory (default: command)',
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'context_memory_get',
        description: 'Retrieve project memory by key.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Memory key to retrieve',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'context_memory_list',
        description: 'List all memory items for current project. Optionally filter by category.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['command', 'config', 'note'],
              description: 'Optional: filter by category',
            },
          },
        },
      },
      {
        name: 'context_memory_delete',
        description: 'Delete a memory item by key.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Memory key to delete',
            },
          },
          required: ['key'],
        },
      },
      // Project CRUD tools
      {
        name: 'context_project_create',
        description: 'Create a new project. Projects must be created before starting sessions. Use this to set up a new codebase with custom name, description, and issue prefix.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the project directory',
            },
            name: {
              type: 'string',
              description: 'Project display name (defaults to folder name)',
            },
            description: {
              type: 'string',
              description: 'Project description',
            },
            issue_prefix: {
              type: 'string',
              description: 'Prefix for issue IDs (e.g., "SC" creates SC-1, SC-2). Defaults to first 4 chars of name.',
            },
          },
          required: ['project_path'],
        },
      },
      {
        name: 'context_project_list',
        description: 'List all projects with optional session counts.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum projects to return (default: 50)',
            },
            include_session_count: {
              type: 'boolean',
              description: 'Include count of sessions per project (default: false)',
            },
          },
        },
      },
      {
        name: 'context_project_get',
        description: 'Get details of a specific project by path.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the project directory',
            },
          },
          required: ['project_path'],
        },
      },
      {
        name: 'context_project_update',
        description: 'Update project settings (name, description, issue prefix).',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the project directory',
            },
            name: {
              type: 'string',
              description: 'New project name',
            },
            description: {
              type: 'string',
              description: 'New project description',
            },
            issue_prefix: {
              type: 'string',
              description: 'New prefix for issue IDs',
            },
          },
          required: ['project_path'],
        },
      },
      {
        name: 'context_project_delete',
        description: 'Delete a project and all associated data (issues, plans, memory). Sessions are unlinked but not deleted. Requires confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the project directory',
            },
            confirm: {
              type: 'boolean',
              description: 'Must be true to confirm deletion',
            },
          },
          required: ['project_path', 'confirm'],
        },
      },
      {
        name: 'context_issue_create',
        description: 'Create a new issue for the current project. Can link to a Plan for tracking implementation of PRDs/specs. Issues persist across sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Issue title',
            },
            description: {
              type: 'string',
              description: 'Optional issue description',
            },
            details: {
              type: 'string',
              description: 'Implementation details or notes',
            },
            priority: {
              type: 'number',
              minimum: 0,
              maximum: 4,
              description: 'Priority level: 0=lowest, 1=low, 2=medium (default), 3=high, 4=critical',
            },
            issueType: {
              type: 'string',
              enum: ['task', 'bug', 'feature', 'epic', 'chore'],
              description: 'Type of issue (default: task)',
            },
            parentId: {
              type: 'string',
              description: 'Parent issue ID for subtasks',
            },
            planId: {
              type: 'string',
              description: 'Link issue to a Plan (PRD/spec). Use context_plan_list to find plan IDs.',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels/tags for categorization',
            },
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'blocked', 'closed', 'deferred'],
              description: 'Initial status (default: open)',
            },
          },
          required: ['title'],
        },
      },
      {
        name: 'context_issue_update',
        description: 'Update an existing issue (title, description, status, priority, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID to update',
            },
            issue_title: {
              type: 'string',
              description: 'Current issue title (for verification and display)',
            },
            title: {
              type: 'string',
              description: 'New issue title',
            },
            description: {
              type: 'string',
              description: 'New issue description',
            },
            details: {
              type: 'string',
              description: 'New implementation details',
            },
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'blocked', 'closed', 'deferred'],
              description: 'New issue status',
            },
            priority: {
              type: 'number',
              minimum: 0,
              maximum: 4,
              description: 'New priority level (0-4)',
            },
            issueType: {
              type: 'string',
              enum: ['task', 'bug', 'feature', 'epic', 'chore'],
              description: 'New issue type',
            },
            parentId: {
              type: 'string',
              description: 'New parent issue ID (or null to remove)',
            },
            planId: {
              type: 'string',
              description: 'Link issue to a Plan (or null to remove link)',
            },
            add_project_path: {
              type: 'string',
              description: 'Add issue to an additional project path (multi-project support). The issue will appear when querying from this project.',
            },
            remove_project_path: {
              type: 'string',
              description: 'Remove issue from an additional project path. Cannot remove the primary project path.',
            },
          },
          required: ['id', 'issue_title'],
        },
      },
      {
        name: 'context_issue_list',
        description: 'List issues for current project with advanced filtering and sorting.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'blocked', 'closed', 'deferred'],
              description: 'Filter by status',
            },
            priority: {
              type: 'number',
              description: 'Filter by exact priority (0-4)',
            },
            priority_min: {
              type: 'number',
              description: 'Filter by minimum priority',
            },
            priority_max: {
              type: 'number',
              description: 'Filter by maximum priority',
            },
            issueType: {
              type: 'string',
              enum: ['task', 'bug', 'feature', 'epic', 'chore'],
              description: 'Filter by issue type',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by labels (all must match)',
            },
            labels_any: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by labels (any must match)',
            },
            parentId: {
              type: 'string',
              description: 'Filter by parent issue ID',
            },
            planId: {
              type: 'string',
              description: 'Filter by plan ID (show issues linked to a plan)',
            },
            has_subtasks: {
              type: 'boolean',
              description: 'Filter issues with/without subtasks',
            },
            has_dependencies: {
              type: 'boolean',
              description: 'Filter issues with/without dependencies',
            },
            sortBy: {
              type: 'string',
              enum: ['priority', 'createdAt', 'updatedAt'],
              description: 'Sort field (default: createdAt)',
            },
            sortOrder: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort order (default: desc)',
            },
            limit: {
              type: 'number',
              description: 'Maximum issues to return',
            },
            all_projects: {
              type: 'boolean',
              description: 'Search across all projects instead of just current project (default: false)',
            },
          },
        },
      },
      {
        name: 'context_issue_complete',
        description: 'Mark an issue as complete (closed). Automatically unblocks dependent issues.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID to mark as closed',
            },
            issue_title: {
              type: 'string',
              description: 'Issue title (for verification and display)',
            },
          },
          required: ['id', 'issue_title'],
        },
      },
      {
        name: 'context_issue_delete',
        description: 'Delete an issue permanently. Also removes all dependencies. Cannot be undone. Requires issue_id and issue_title.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID to delete',
            },
            issue_title: {
              type: 'string',
              description: 'Issue title (for verification and display)',
            },
          },
          required: ['id', 'issue_title'],
        },
      },
      {
        name: 'context_issue_add_dependency',
        description: 'Add a dependency between issues. The issue will depend on another issue.',
        inputSchema: {
          type: 'object',
          properties: {
            issueId: {
              type: 'string',
              description: 'ID of the issue that will have the dependency',
            },
            dependsOnId: {
              type: 'string',
              description: 'ID of the issue it depends on',
            },
            dependencyType: {
              type: 'string',
              enum: ['blocks', 'related', 'parent-child', 'discovered-from'],
              description: 'Type of dependency (default: blocks)',
            },
          },
          required: ['issueId', 'dependsOnId'],
        },
      },
      {
        name: 'context_issue_remove_dependency',
        description: 'Remove a dependency between issues.',
        inputSchema: {
          type: 'object',
          properties: {
            issueId: {
              type: 'string',
              description: 'ID of the issue with the dependency',
            },
            dependsOnId: {
              type: 'string',
              description: 'ID of the issue it depends on',
            },
          },
          required: ['issueId', 'dependsOnId'],
        },
      },
      {
        name: 'context_issue_add_labels',
        description: 'Add labels to an issue for categorization.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels to add',
            },
          },
          required: ['id', 'labels'],
        },
      },
      {
        name: 'context_issue_remove_labels',
        description: 'Remove labels from an issue.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels to remove',
            },
          },
          required: ['id', 'labels'],
        },
      },
      {
        name: 'context_issue_claim',
        description: 'Claim issues for the current agent. Marks them as in_progress and assigns to you.',
        inputSchema: {
          type: 'object',
          properties: {
            issue_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Issue IDs to claim',
            },
          },
          required: ['issue_ids'],
        },
      },
      {
        name: 'context_issue_release',
        description: 'Release issues back to the pool. Unassigns and sets status to open.',
        inputSchema: {
          type: 'object',
          properties: {
            issue_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Issue IDs to release',
            },
          },
          required: ['issue_ids'],
        },
      },
      {
        name: 'context_issue_get_ready',
        description: 'Get issues that are ready to work on (open, no blocking dependencies, not assigned).',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum issues to return (default: 10)',
            },
            sortBy: {
              type: 'string',
              enum: ['priority', 'createdAt'],
              description: 'Sort field (default: priority)',
            },
          },
        },
      },
      {
        name: 'context_issue_get_next_block',
        description: 'Get next block of ready issues and claim them. Smart issue assignment for agents.',
        inputSchema: {
          type: 'object',
          properties: {
            count: {
              type: 'number',
              description: 'Number of issues to claim (default: 3)',
            },
            priority_min: {
              type: 'number',
              description: 'Minimum priority to consider',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only consider issues with these labels',
            },
          },
        },
      },
      {
        name: 'context_issue_create_batch',
        description: 'Create multiple issues at once with dependencies. Supports linking all issues to a Plan. Useful for creating issue hierarchies from plans.',
        inputSchema: {
          type: 'object',
          properties: {
            planId: {
              type: 'string',
              description: 'Link all issues in batch to a Plan (PRD/spec). Individual issues can override.',
            },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Issue title' },
                  description: { type: 'string', description: 'Issue description' },
                  details: { type: 'string', description: 'Implementation details' },
                  priority: { type: 'number', description: 'Priority 0-4' },
                  issueType: { type: 'string', enum: ['task', 'bug', 'feature', 'epic', 'chore'] },
                  parentId: { type: 'string', description: 'Parent ID or $N reference' },
                  planId: { type: 'string', description: 'Override batch-level planId for this issue' },
                  labels: { type: 'array', items: { type: 'string' } },
                },
                required: ['title'],
              },
              description: 'Array of issues to create',
            },
            dependencies: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  issueIndex: { type: 'number', description: 'Index of issue in array' },
                  dependsOnIndex: { type: 'number', description: 'Index of dependency' },
                  dependencyType: { type: 'string', enum: ['blocks', 'related', 'parent-child', 'discovered-from'] },
                },
                required: ['issueIndex', 'dependsOnIndex'],
              },
              description: 'Dependencies between issues (by array index)',
            },
          },
          required: ['issues'],
        },
      },
      {
        name: 'context_checkpoint',
        description: 'Create named checkpoint snapshot for manual saves. Supports selective checkpoints via filters. Use before major refactors, git branch switches, or experimental changes. For auto-save before context fills up, use context_prepare_compaction instead.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Checkpoint name (e.g., "before-refactor", "auth-complete")',
            },
            description: {
              type: 'string',
              description: 'Optional checkpoint description',
            },
            include_git: {
              type: 'boolean',
              description: 'Include git status in checkpoint (default: false)',
            },
            include_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only include items with these tags',
            },
            include_keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only include items matching these key patterns (supports wildcards like "feature_*")',
            },
            include_categories: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['reminder', 'decision', 'progress', 'note'],
              },
              description: 'Only include items in these categories',
            },
            exclude_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Exclude items with these tags',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'context_restore',
        description: 'Restore session state from checkpoint. Supports selective restoration via filters. Use to continue previous work, recover from mistakes, or restore after context compaction. Requires checkpoint_id and checkpoint_name.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of checkpoint to restore',
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint name (for verification and display)',
            },
            restore_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only restore items with these tags',
            },
            restore_categories: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['reminder', 'decision', 'progress', 'note'],
              },
              description: 'Only restore items in these categories',
            },
          },
          required: ['checkpoint_id', 'checkpoint_name'],
        },
      },
      {
        name: 'context_tag',
        description: 'Tag context items for organization and filtering. Supports tagging by specific keys or wildcard patterns. MUST be used before context_checkpoint_split to tag items by work stream (e.g., tag auth items with "auth", UI items with "ui"). Use context_get to verify items and their keys first, then tag by specific keys (not patterns) for accuracy.',
        inputSchema: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific item keys to tag',
            },
            key_pattern: {
              type: 'string',
              description: 'Wildcard pattern to match keys (e.g., "feature_*")',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to add or remove',
            },
            action: {
              type: 'string',
              enum: ['add', 'remove'],
              description: 'Whether to add or remove the tags',
            },
          },
          required: ['tags', 'action'],
        },
      },
      {
        name: 'context_checkpoint_add_items',
        description: 'Add items to an existing checkpoint. Use to incrementally build up checkpoints or add items you forgot to include. Requires checkpoint_id, checkpoint_name, and item_keys.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to modify',
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint name (for verification and display)',
            },
            item_keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Keys of items to add to the checkpoint',
            },
          },
          required: ['checkpoint_id', 'checkpoint_name', 'item_keys'],
        },
      },
      {
        name: 'context_checkpoint_remove_items',
        description: 'Remove items from an existing checkpoint. Use to fix checkpoints that contain unwanted items or to clean up mixed work streams. Requires checkpoint_id, checkpoint_name, and item_keys.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to modify',
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint name (for verification and display)',
            },
            item_keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Keys of items to remove from the checkpoint',
            },
          },
          required: ['checkpoint_id', 'checkpoint_name', 'item_keys'],
        },
      },
      {
        name: 'context_checkpoint_split',
        description: 'Split a checkpoint into multiple checkpoints based on tags or categories. REQUIRED WORKFLOW: (1) Use context_get_checkpoint to see all items, (2) Use context_tag to tag items by work stream (e.g., "auth", "ui"), (3) Then split using include_tags for each work stream. Each split MUST have include_tags or include_categories - the tool will ERROR if no filters provided. Verify results show expected item counts. Requires source_checkpoint_id, source_checkpoint_name, and splits array.',
        inputSchema: {
          type: 'object',
          properties: {
            source_checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to split',
            },
            source_checkpoint_name: {
              type: 'string',
              description: 'Source checkpoint name (for verification and display)',
            },
            splits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Name for the new checkpoint',
                  },
                  description: {
                    type: 'string',
                    description: 'Optional description',
                  },
                  include_tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Only include items with these tags',
                  },
                  include_categories: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['reminder', 'decision', 'progress', 'note'],
                    },
                    description: 'Only include items in these categories',
                  },
                },
                required: ['name'],
              },
              description: 'Array of split configurations',
            },
          },
          required: ['source_checkpoint_id', 'source_checkpoint_name', 'splits'],
        },
      },
      {
        name: 'context_checkpoint_delete',
        description: 'Delete a checkpoint permanently. Use to clean up failed, duplicate, or unwanted checkpoints. Cannot be undone. Requires checkpoint_id and checkpoint_name.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to delete',
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint name (for verification and display)',
            },
          },
          required: ['checkpoint_id', 'checkpoint_name'],
        },
      },
      {
        name: 'context_list_checkpoints',
        description: 'Lightweight checkpoint search with keyword filtering. Returns minimal data (id, name, session_name, created_at, item_count) to avoid context bloat. Defaults to current project. Use context_get_checkpoint to get full details for a specific checkpoint.',
        inputSchema: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description: 'Keyword search across checkpoint name, description, and session name',
            },
            session_id: {
              type: 'string',
              description: 'Filter to specific session',
            },
            project_path: {
              type: 'string',
              description: 'Filter to specific project (default: current project)',
            },
            include_all_projects: {
              type: 'boolean',
              description: 'Show checkpoints from all projects (default: false)',
            },
            limit: {
              type: 'number',
              description: 'Maximum results to return (default: 20)',
            },
            offset: {
              type: 'number',
              description: 'Pagination offset (default: 0)',
            },
          },
        },
      },
      {
        name: 'context_get_checkpoint',
        description: 'Get full details for a specific checkpoint. Returns complete data including description, git status/branch, and preview of top 5 high-priority items. Use after context_list_checkpoints to drill down into relevant checkpoints.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to retrieve',
            },
          },
          required: ['checkpoint_id'],
        },
      },
      {
        name: 'context_status',
        description: 'Get current session statistics: item count, categories breakdown, priorities, recent activity. Use to understand session state or decide when to checkpoint. Includes compaction suggestions when item count is high.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'context_prepare_compaction',
        description: 'Smart checkpoint for context compaction. Call when conversation gets long (40+ messages) or before context limit. Analyzes priority items, identifies next steps, generates restoration summary. Returns critical context for seamless session continuation. Works across all AI coding tools.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'context_session_rename',
        description: 'Rename current session. Use when initial name wasn\'t descriptive enough or context changed direction. Call context_status first to get the current session name.',
        inputSchema: {
          type: 'object',
          properties: {
            current_name: {
              type: 'string',
              description: 'Current session name (for verification - get from context_status)',
            },
            new_name: {
              type: 'string',
              description: 'New session name',
            },
          },
          required: ['current_name', 'new_name'],
        },
      },
      {
        name: 'context_list_sessions',
        description: 'Find sessions by keyword search or list recent sessions. PREFER using search param when looking for specific sessions - it searches name and description. Only omit search when you need to browse all recent sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description: 'RECOMMENDED: Keyword search on session name and description. Use this first when looking for specific sessions.',
            },
            limit: {
              type: 'number',
              description: 'Maximum sessions to return (default: 10)',
            },
            project_path: {
              type: 'string',
              description: 'Filter by project path (defaults to current working directory)',
            },
            status: {
              type: 'string',
              enum: ['active', 'paused', 'completed', 'all'],
              description: 'Filter by session status',
            },
            include_completed: {
              type: 'boolean',
              description: 'Include completed sessions (default: false)',
            },
          },
        },
      },
      {
        name: 'context_session_end',
        description: 'End (complete) the current session. Marks session as completed with timestamp. Returns session summary including duration, items saved, and checkpoints created. Use when work is finished.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'context_session_pause',
        description: 'Pause the current session to resume later. Preserves all session state and can be resumed with context_session_resume. Use when switching contexts or taking a break.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'context_session_resume',
        description: 'Resume a previously paused session. Restores session state and sets it as the active session. Cannot resume completed sessions. Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to resume',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['session_id', 'session_name'],
        },
      },
      {
        name: 'context_session_switch',
        description: 'Switch between sessions atomically. Pauses current session (if any) and resumes the specified session. Use when working on multiple projects. Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to switch to',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['session_id', 'session_name'],
        },
      },
      {
        name: 'context_session_delete',
        description: 'Delete a session permanently. Cannot delete active sessions (must pause or end first). Cascade deletes all context items and checkpoints. Use to clean up accidentally created sessions. Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to delete',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['session_id', 'session_name'],
        },
      },
      {
        name: 'context_session_add_path',
        description: 'Add a project path to a session. Enables sessions to span multiple related directories (e.g., monorepo folders like /frontend and /backend, or /app and /dashboard). Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Project path to add (defaults to current working directory)',
            },
            session_id: {
              type: 'string',
              description: 'ID of the session to add path to',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['session_id', 'session_name'],
        },
      },
      {
        name: 'context_session_remove_path',
        description: 'Remove a project path from a session. Cannot remove the last path (sessions must have at least one path). Use to clean up paths that are no longer needed. Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Project path to remove from the session',
            },
            session_id: {
              type: 'string',
              description: 'ID of the session to remove path from',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['project_path', 'session_id', 'session_name'],
        },
      },
      // ====================
      // Plan Tools
      // ====================
      {
        name: 'context_plan_create',
        description: 'Create a new plan (PRD/specification) for the current project. Plans organize work into epics and tasks.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Plan title (e.g., "User Authentication System", "API Redesign")',
            },
            content: {
              type: 'string',
              description: 'Full plan content in markdown format. Include requirements, goals, success criteria.',
            },
            status: {
              type: 'string',
              enum: ['draft', 'active', 'completed'],
              description: 'Plan status (default: draft)',
            },
            successCriteria: {
              type: 'string',
              description: 'Optional success criteria for the plan',
            },
            project_path: {
              type: 'string',
              description: 'Project path (defaults to current directory)',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'context_plan_list',
        description: 'List plans for the current project. Returns plans with their status and epic counts.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['draft', 'active', 'completed', 'all'],
              description: 'Filter by status (default: active plans only)',
            },
            project_path: {
              type: 'string',
              description: 'Project path to filter by',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of plans to return (default: 50)',
            },
          },
        },
      },
      {
        name: 'context_plan_get',
        description: 'Get details of a specific plan including its linked epics.',
        inputSchema: {
          type: 'object',
          properties: {
            plan_id: {
              type: 'string',
              description: 'ID of the plan to retrieve',
            },
          },
          required: ['plan_id'],
        },
      },
      {
        name: 'context_plan_update',
        description: 'Update a plan\'s title, content, status, project, or success criteria. Changing project_path cascades to all linked issues.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID of the plan to update',
            },
            title: {
              type: 'string',
              description: 'New plan title',
            },
            content: {
              type: 'string',
              description: 'New plan content',
            },
            status: {
              type: 'string',
              enum: ['draft', 'active', 'completed'],
              description: 'New plan status',
            },
            successCriteria: {
              type: 'string',
              description: 'New success criteria',
            },
            project_path: {
              type: 'string',
              description: 'New project path. Cascades to all linked issues.',
            },
          },
          required: ['id'],
        },
      },
];
