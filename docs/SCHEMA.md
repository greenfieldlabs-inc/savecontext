# Database Schema

SaveContext uses SQLite with WAL mode. All data is stored locally at `~/.savecontext/data/savecontext.db`.

The base schema is defined in `server/src/database/schema.sql`. Incremental changes are applied via versioned migrations in `cli/migrations/`. The Rust CLI embeds all migrations at compile time.

## Tables

### sessions

Tracks coding sessions with lifecycle state management.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique session identifier (e.g., `sess_abc123`) |
| `name` | TEXT | Session name |
| `description` | TEXT | Optional description |
| `branch` | TEXT | Git branch if available |
| `channel` | TEXT | Derived from branch or name (default: `general`) |
| `project_path` | TEXT | Absolute path to project/repo |
| `status` | TEXT | `active`, `paused`, or `completed` |
| `ended_at` | INTEGER | Timestamp when paused/completed |
| `created_at` | INTEGER | Unix timestamp (ms) |
| `updated_at` | INTEGER | Unix timestamp (ms) |

### context_items

Individual context entries saved during sessions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique item identifier |
| `session_id` | TEXT FK | References sessions(id) |
| `key` | TEXT | Unique identifier within session |
| `value` | TEXT | Context content |
| `category` | TEXT | `reminder`, `decision`, `progress`, or `note` |
| `priority` | TEXT | `high`, `normal`, or `low` |
| `channel` | TEXT | Topic/branch-based organization |
| `tags` | TEXT | JSON array of tag strings |
| `size` | INTEGER | Size in bytes |
| `embedding_status` | TEXT | `none`, `pending`, `complete`, or `error` |
| `embedding_provider` | TEXT | `ollama`, `transformers`, or `huggingface` |
| `embedding_model` | TEXT | Model used for embedding |
| `chunk_count` | INTEGER | Number of chunks (large items split) |
| `embedded_at` | INTEGER | When embedding was generated |
| `created_at` | INTEGER | Unix timestamp (ms) |
| `updated_at` | INTEGER | Unix timestamp (ms) |

UNIQUE constraint on `(session_id, key)`.

### projects

Project registry for ID generation and metadata.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique project identifier |
| `project_path` | TEXT UNIQUE | Absolute path to project directory |
| `name` | TEXT | Display name |
| `description` | TEXT | Project description |
| `issue_prefix` | TEXT | Prefix for issue short IDs (e.g., `SC`) |
| `next_issue_number` | INTEGER | Auto-incrementing issue counter |
| `plan_prefix` | TEXT | Prefix for plan short IDs |
| `next_plan_number` | INTEGER | Auto-incrementing plan counter |
| `created_at` | INTEGER | Unix timestamp (ms) |
| `updated_at` | INTEGER | Unix timestamp (ms) |

### issues

Issue tracking with hierarchy, dependencies, and agent attribution.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique issue identifier |
| `short_id` | TEXT | Human-readable ID (e.g., `SC-a1b2`) |
| `project_path` | TEXT | Project directory path |
| `title` | TEXT | Issue title |
| `description` | TEXT | Issue description |
| `details` | TEXT | Implementation details or notes |
| `status` | TEXT | `backlog`, `open`, `in_progress`, `blocked`, `closed`, `deferred` |
| `priority` | INTEGER | 0=lowest, 1=low, 2=medium, 3=high, 4=critical |
| `issue_type` | TEXT | `task`, `bug`, `feature`, `epic`, `chore` |
| `plan_id` | TEXT FK | References plans(id), nullable |
| `parent_id` | TEXT | Parent issue ID for subtasks (added by migration) |
| `created_by_agent` | TEXT | Agent that created the issue |
| `closed_by_agent` | TEXT | Agent that closed the issue |
| `assigned_to_agent` | TEXT | Currently assigned agent |
| `assigned_at` | INTEGER | When assignment happened |
| `created_in_session` | TEXT | Session ID where created |
| `closed_in_session` | TEXT | Session ID where closed |
| `close_reason` | TEXT | Optional reason for closing (migration 014) |
| `created_at` | INTEGER | Unix timestamp (ms) |
| `updated_at` | INTEGER | Unix timestamp (ms) |
| `closed_at` | INTEGER | Timestamp when closed |
| `deferred_at` | INTEGER | Timestamp when deferred |

### issue_labels

Tags for categorizing issues.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique label entry identifier |
| `issue_id` | TEXT FK | References issues(id) |
| `label` | TEXT | Label string |

UNIQUE constraint on `(issue_id, label)`.

### issue_dependencies

Relationships between issues for dependency tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique dependency identifier |
| `issue_id` | TEXT FK | The issue that has the dependency |
| `depends_on_id` | TEXT FK | The issue it depends on |
| `dependency_type` | TEXT | `blocks`, `related`, `parent-child`, `discovered-from` |
| `created_at` | INTEGER | Unix timestamp (ms) |

UNIQUE constraint on `(issue_id, depends_on_id)`.

### plans

Implementation plans and PRDs linked to issues.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique plan identifier |
| `short_id` | TEXT | Human-readable ID |
| `project_id` | TEXT FK | References projects(id) |
| `project_path` | TEXT | Project directory path |
| `title` | TEXT | Plan title |
| `content` | TEXT | Plan content (markdown) |
| `status` | TEXT | `draft`, `active`, `completed`, `archived` |
| `success_criteria` | TEXT | Success criteria |
| `session_id` | TEXT FK | Session that created the plan (migration 013) |
| `source_path` | TEXT | Source file path for captured plans (migration 013) |
| `source_hash` | TEXT | SHA-256 hash for deduplication (migration 013) |
| `created_in_session` | TEXT | Session ID where created |
| `completed_in_session` | TEXT | Session ID where completed |
| `created_at` | INTEGER | Unix timestamp (ms) |
| `updated_at` | INTEGER | Unix timestamp (ms) |
| `completed_at` | INTEGER | Timestamp when completed |

### checkpoints

Named snapshots of session state.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique checkpoint identifier |
| `session_id` | TEXT FK | References sessions(id) |
| `name` | TEXT | Checkpoint name |
| `description` | TEXT | Checkpoint description |
| `git_status` | TEXT | Git working tree status at checkpoint |
| `git_branch` | TEXT | Git branch at checkpoint |
| `item_count` | INTEGER | Number of items in checkpoint |
| `total_size` | INTEGER | Total size in bytes |
| `created_at` | INTEGER | Unix timestamp (ms) |

### checkpoint_items

Links checkpoints to context items.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique entry identifier |
| `checkpoint_id` | TEXT FK | References checkpoints(id) |
| `context_item_id` | TEXT FK | References context_items(id) |
| `group_name` | TEXT | Optional group for organization |
| `group_order` | INTEGER | Order within group |

### project_memory

Project-specific commands, configs, and notes. Persists across all sessions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique memory item identifier |
| `project_path` | TEXT | Project directory path |
| `key` | TEXT | Unique identifier within project |
| `value` | TEXT | The stored value |
| `category` | TEXT | `command`, `config`, or `note` |
| `created_at` | INTEGER | Unix timestamp (ms) |
| `updated_at` | INTEGER | Unix timestamp (ms) |

UNIQUE constraint on `(project_path, key)`.

### agent_sessions

Tracks which agent is currently working on each session. Enables multi-agent support.

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | TEXT PK | Format: `{projectName}-{branch}-{provider}` |
| `session_id` | TEXT FK | References sessions(id) |
| `project_path` | TEXT | Full project path |
| `git_branch` | TEXT | Git branch name |
| `provider` | TEXT | MCP client provider |
| `last_active_at` | INTEGER | Timestamp of last activity |

### session_projects

Many-to-many relationship for multi-path sessions (monorepos).

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | TEXT | References sessions(id) |
| `project_path` | TEXT | Project directory path |
| `added_at` | INTEGER | Timestamp when path was added |

Primary key on `(session_id, project_path)`.

### issue_projects

Many-to-many relationship for multi-project issues.

| Column | Type | Description |
|--------|------|-------------|
| `issue_id` | TEXT | References issues(id) |
| `project_path` | TEXT | Project directory path |
| `added_at` | INTEGER | Timestamp |

Primary key on `(issue_id, project_path)`.

### dirty_plans

Dirty tracking for JSONL sync of plans.

| Column | Type | Description |
|--------|------|-------------|
| `plan_id` | TEXT PK | References plans(id) |
| `marked_at` | INTEGER | Timestamp when marked dirty |

### embeddings_meta

Embedding configuration metadata.

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT PK | Configuration key |
| `value` | TEXT | Configuration value |
| `updated_at` | INTEGER | Unix timestamp (ms) |

### vec_context_chunks (virtual)

Vector storage for semantic search embeddings. Uses sqlite-vec virtual table.

| Column | Type | Description |
|--------|------|-------------|
| `embedding` | float[768] | Vector embedding (cosine distance) |
| `item_id` | TEXT | References context_items(id) |
| `chunk_index` | INTEGER | Chunk position for large items |

## Migrations

Migrations are applied automatically on database open. Already-applied migrations are tracked in the `schema_migrations` table.

| Version | Description |
|---------|-------------|
| 001 | Session lifecycle (status, ended_at) |
| 002 | Multi-path sessions (session_projects table) |
| 003 | Agent sessions table |
| 004 | Memory and tasks tables |
| 005 | Checkpoint grouping (group_name, group_order) |
| 006 | Rename tasks to issues |
| 007 | Embeddings support (embedding columns on context_items) |
| 008 | Dynamic vector dimensions |
| 009 | Rename task category to reminder |
| 010 | Issue projects (multi-project issues) |
| 011 | Blob embeddings |
| 012 | Tiered embeddings |
| 013 | Plan session binding + JSONL sync (session_id, source_path, source_hash, dirty_plans) |
| 014 | Close reason (close_reason column on issues) |
