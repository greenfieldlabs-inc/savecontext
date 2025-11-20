# Changelog

All notable changes to this project will be documented in this file.

## Historical Note
Versions 0.1.0-0.1.2 were development releases with package.json version mismatches. v0.1.3 is the first npm-published release.

## [0.1.6] - 2025-11-20

### Added
- **SaveContext Cloud support** - Dual-mode operation (local SQLite or cloud API)
  - Cloud mode enabled via `SAVECONTEXT_API_KEY` environment variable
  - Local mode (default) - free, SQLite-backed, no account required
  - Cloud mode - PostgreSQL-backed API at https://mcp.savecontext.dev
  - CloudClient class with Bearer token authentication and agent metadata headers
  - All 32 MCP tools work identically in both modes via automatic routing
  - Mode detection via environment variable or CLI flag `--api-key`
  - Cloud API base URL configurable via `SAVECONTEXT_BASE_URL`
- **Migration CLI** - `savecontext-migrate` binary for local to cloud data migration
  - One-time migration for new cloud accounts only (prevents data conflicts)
  - Pre-migration validation against tier limits
  - Migrates sessions, context items, checkpoints, project memory, tasks, and agent sessions
  - Migration API endpoint: https://mcp.savecontext.dev/migrate
- **Type system improvements**
  - Moved CompactionConfig, ClientInfo, ConnectionState interfaces to types/index.ts
  - Added ContextItemUpdate and TaskUpdate interfaces for typed partial updates
  - Added CheckpointItemRow and CheckpointRow types for SQLite migration queries
- **Tool description enhancements** - 8 tools now explicitly document required parameters
  - context_restore: "Requires checkpoint_id and checkpoint_name"
  - context_checkpoint_add_items: "Requires checkpoint_id, checkpoint_name, and item_keys"
  - context_checkpoint_remove_items: "Requires checkpoint_id, checkpoint_name, and item_keys"
  - context_checkpoint_split: "Requires source_checkpoint_id, source_checkpoint_name, and splits array"
  - context_checkpoint_delete: "Requires checkpoint_id and checkpoint_name"
  - context_session_resume: "Requires session_id and session_name"
  - context_session_switch: "Requires session_id and session_name"
  - context_session_delete: "Requires session_id and session_name"
- Commander.js dependency (v14.0.2) for CLI argument parsing
- npm publish workflow with prepublishOnly/postpublish scripts for README

### Changed
- Server startup now detects mode based on API key presence and logs mode to stderr
- DatabaseManager and CloudClient are mutually exclusive - only one initialized per mode
- All tool handlers check mode and proxy to cloud API or use local database accordingly
- Validation functions now validate checkpoint_name and source_checkpoint_name for verification
- README reorganized with cloud mode configuration, migration instructions, and mode comparison
- package.json version bumped to 0.1.6
- package.json bin now includes savecontext-migrate entry point

### Fixed
- Replaced `const updates: any = {}` with typed ContextItemUpdate and TaskUpdate interfaces
- Replaced `(item as any)` type casts in migrate.ts with proper CheckpointItemRow typing
- Build warnings from untyped objects eliminated

## [0.1.5] - 2025-11-14

### Added (EXPERIMENTAL)
- **User-configurable compaction behavior** via environment variables
  - `SAVECONTEXT_COMPACTION_THRESHOLD` (50-90%, default: 70%)
  - `SAVECONTEXT_COMPACTION_MODE` (auto/remind/manual, default: remind)
  - Dynamic AI instruction generation injected into system prompt via MCP protocol
  - Only validated with Claude Code - requires CLI restart when env vars change
  - Other MCP clients may not support the instructions field
- Git staged diff capture during compaction (50KB limit)
- Git context in compaction summaries (branch, file counts, staged changes)
- Tool schema verification parameters to prevent user errors (task_title, checkpoint_name, session_name)
- Version now read from package.json for consistency

### Changed
- Tools requiring verification parameters: context_task_update, context_task_complete, context_restore, context_checkpoint_add_items, context_checkpoint_remove_items, context_checkpoint_split, context_checkpoint_delete, context_session_resume, context_session_switch, context_session_delete
- Tool responses now include human-readable names instead of just IDs

## [0.1.4] - 2025-11-10

### Added
- **Checkpoint Grouping & Management System** - Organize context items and create selective checkpoints
- `tags` field on context_items for flexible item organization
- `context_tag` tool - Tag items by specific keys or wildcard patterns (e.g., "feature_*")
- **Selective Checkpoint Creation** - Filter checkpoints by tags, keys, categories, or exclude specific tags
- **Selective Restoration** - Restore only tagged items or specific categories from checkpoints
- `context_checkpoint_add_items` tool - Add items to existing checkpoints
- `context_checkpoint_remove_items` tool - Remove items from checkpoints to fix mixed work streams
- `context_checkpoint_split` tool - Split mixed checkpoints into organized separate checkpoints
- `context_checkpoint_delete` tool - Delete checkpoints permanently to clean up failed or duplicate checkpoints
- Database methods: `tagContextItems()`, `addItemsToCheckpoint()`, `removeItemsFromCheckpoint()`, `splitCheckpoint()`, `deleteCheckpoint()`
- Enhanced `createCheckpoint()` with filter support (include_tags, include_keys, include_categories, exclude_tags)
- Enhanced `restoreCheckpoint()` with filter support (restore_tags, restore_categories)
- Migration 005: Added tags column and checkpoint grouping metadata

### Changed
- `context_checkpoint` tool now supports filter parameters for selective checkpoints
- `context_restore` tool now supports filter parameters for selective restoration
- `context_checkpoint_split` now requires filters and validates results to prevent agent errors
- `context_checkpoint_split` returns warnings if splits have 0 items or all items (likely misconfigured filters)
- Tool descriptions enhanced with required workflows and examples to prevent common mistakes
- Tool count increased from 27 to 32 (5 new tools)
- Updated validation for all new tool parameters

### Use Cases
- **Separate Work Streams**: Tag items by project area (e.g., "auth", "ui", "api") and create focused checkpoints
- **Fix Mixed Checkpoints**: Remove unwanted items or split messy checkpoints into organized ones
- **Selective Restoration**: Restore only high-priority items or specific work streams
- **Incremental Checkpoints**: Add forgotten items to existing checkpoints

## [0.1.3] - 2025-11-08

### Added
- Project memory system for storing commands, configs, and notes that persist across sessions
- Task management system for tracking work across multiple sessions
- `project_memory` table for project-scoped memory storage
- `tasks` table for simple todo/done task tracking
- `context_memory_save` tool - Save project memory (command, config, or note)
- `context_memory_get` tool - Retrieve memory by key
- `context_memory_list` tool - List all memory for current project
- `context_memory_delete` tool - Delete memory item
- `context_task_create` tool - Create a new task
- `context_task_update` tool - Update task title, description, or status
- `context_task_list` tool - List tasks with optional status filter
- `context_task_complete` tool - Quick mark task as done
- Database methods: `saveMemory`, `getMemory`, `listMemory`, `deleteMemory`, `createTask`, `updateTask`, `listTasks`, `completeTask`, `deleteTask`

### Changed
- Tool count increased from 19 to 27 (8 new tools)
- Memory uses INSERT OR REPLACE for simple overwrite behavior on duplicate keys

## [0.1.2] - 2025-11-06

### Added
- Multi-agent support for concurrent terminal instances
- `agent_sessions` table for tracking which session each agent is currently working on
- Automatic MCP client detection via protocol initialization handshake
- Agent ID generation from project path, git branch, and provider (`{projectName}-{branch}-{provider}`)
- Per-connection client tracking (future-proof for SSE/HTTP transports)
- Provider detection for Claude Code, Cursor, Cline, Factory.ai, Codex CLI, Windsurf, Continue.dev
- Database methods: `setCurrentSessionForAgent`, `getCurrentSessionForAgent`, `clearCurrentSessionForAgent`, `getAgentsForSession`
- Session responses now include `agent_id` and `provider` fields
- Agent activity timestamp tracking on all operations (save, update, delete, checkpoint, resume)
- `context_delete` tool for removing context items
- `context_update` tool for editing existing context items
- Database method `updateContextItem()` for partial field updates

### Changed
- `context_session_start` now uses agent-scoped session tracking instead of global active session
- Multiple tools and terminals can now work simultaneously on the same session without conflicts
- Session isolation by agent ID (project + branch + provider combination)
- MCP initialization captures `clientInfo.name` from protocol handshake
- Multiple tools can work on same session concurrently (e.g., Claude Code and Factory.ai tracked as separate agents)
- Agent activity timestamps update automatically on every operation to track real-time activity
- Context items can now be deleted and edited after creation
- Tool count increased from 17 to 19

### Fixed
- Multiple terminal instances can now have their own active sessions simultaneously
- Branch isolation works automatically (main vs feature branches = different agents)
- No more forced pause/resume when switching between terminals
- `list_sessions` now correctly shows multi-path sessions by querying `session_projects` junction table instead of only checking primary `project_path`
- Agent activity timestamps now update in real-time instead of showing stale timestamps from hours/days ago
- Agent switching (e.g., Claude Code → Factory.ai) now creates separate agent entries instead of overwriting the previous agent
- `context_session_end` and `context_session_pause` now clear agent associations, allowing fresh session creation
- Completed sessions can now be resumed (removed blocking restriction)

## [0.1.1] - 2025-11-04

### Added
- Multi-path session support for monorepos and related projects
- `context_session_add_path` tool to manually add project paths to active session
- `session_projects` junction table for many-to-many session-project relationships
- Database methods: `getSessionPaths`, `addProjectPath`, `removeProjectPath`, `getActiveSessionForPaths`, `listSessionsByPaths`
- Auto-add current path when resuming sessions in new directories

### Changed
- `context_session_start` automatically adds new paths to existing active sessions when working across related directories
- Session responses now include `project_paths` array showing all associated paths
- Database migration system: created 002_add_multi_path_sessions.sql
- Tool count increased from 16 to 17

### Fixed
- Agents working across monorepo folders (e.g., /frontend and /backend) can now share the same session

## [0.1.0] - 2025-11-04

### Added
- Session lifecycle management with pause/resume/end operations
- `context_session_pause` tool to pause current session for later resumption
- `context_session_resume` tool to resume paused sessions
- `context_session_end` tool to complete sessions with duration and stats tracking
- `context_session_switch` tool for atomic session switching
- `context_session_delete` tool to permanently delete sessions
- Project path isolation - sessions automatically filtered by repository
- Auto-resume logic - automatically resumes existing active session instead of creating duplicates
- Session status tracking: active, paused, completed
- Session duration tracking with `ended_at` timestamp
- Database migration system for schema updates
- `project_path` field in sessions table for repository isolation
- `status` field in sessions table for lifecycle state management
- Database indexes for project_path and status fields
- Project utility functions for path normalization and comparison
- Lightweight checkpoint search with keyword filtering across name, description, and session name
- `context_get_checkpoint` tool for retrieving full checkpoint details including item previews
- Project-scoped checkpoint filtering (defaults to current project)
- Pagination support for checkpoint search results
- Checkpoint search returns minimal data to avoid context bloat
- High-priority item preview (top 5) in detailed checkpoint view

### Changed
- `context_session_start` now checks for existing active sessions and resumes instead of duplicating
- `context_list_sessions` now filters by project path by default
- Session statistics in `context_status` include duration and session state
- Database schema updated to support session lifecycle management
- `context_list_checkpoints` refactored to support keyword search and filtering
- Checkpoint listing now returns minimal data by default (id, name, session_name, created_at, item_count)
- Tool count increased from 10 to 16

### Fixed
- Sessions no longer duplicated when restarting AI coding assistant in same project
- Improved session discovery across different projects

## [0.0.1] - 2025-11-02

### Added
- MCP server implementation with stdio transport
- Session management with automatic channel derivation from git branches
- Context item storage with categories (task, decision, progress, note)
- Priority levels for context items (high, normal, low)
- Checkpoint system for session state snapshots
- Checkpoint restore functionality
- Smart compaction analysis for context limit management
- Git integration for branch detection and status capture
- SQLite database with WAL mode for persistence
- Channel system for organizing context by git branches
- Database views for session summaries and high-priority items
- Automatic session timestamp updates via triggers
- `context_session_start` - Create or resume sessions
- `context_save` - Save context items with categories and priorities
- `context_get` - Retrieve context items with filtering
- `context_checkpoint` - Create named checkpoints
- `context_restore` - Restore from checkpoints
- `context_list_checkpoints` - List session checkpoints
- `context_status` - Get session statistics and compaction recommendations
- `context_prepare_compaction` - Smart checkpoint with analysis
- `context_session_rename` - Rename active session
- `context_list_sessions` - List recent sessions
