# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2025-11-06

### Added
- Multi-agent support for concurrent terminal instances
- `agent_sessions` table for tracking which session each agent is currently working on
- Automatic MCP client detection via protocol initialization handshake
- Agent ID generation from project path and git branch (`{projectName}-{branch}`)
- Per-connection client tracking (future-proof for SSE/HTTP transports)
- Provider detection for Claude Code, Cursor, Cline, Factory.ai, Codex CLI, Windsurf, Continue.dev
- Database methods: `setCurrentSessionForAgent`, `getCurrentSessionForAgent`, `clearCurrentSessionForAgent`, `getAgentsForSession`
- Session responses now include `agent_id` and `provider` fields

### Changed
- `context_session_start` now uses agent-scoped session tracking instead of global active session
- Multiple Claude Code terminals can now work simultaneously without conflicts
- Session isolation by agent ID (project + branch combination)
- MCP initialization captures `clientInfo.name` from protocol handshake
- Tool switching supported (e.g., start in Factory.ai, continue in Claude Code)

### Fixed
- Multiple terminal instances can now have their own active sessions simultaneously
- Branch isolation works automatically (main vs feature branches = different agents)
- No more forced pause/resume when switching between terminals
- `list_sessions` now correctly shows multi-path sessions by querying `session_projects` junction table instead of only checking primary `project_path`

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
