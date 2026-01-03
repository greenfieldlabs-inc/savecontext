# Changelog

All notable changes to this project will be documented in this file.

## Historical Note
Versions 0.1.0-0.1.2 were development releases with package.json version mismatches. v0.1.3 is the first npm-published release.

## [0.1.21] - 2026-01-03

### Fixed
- **Dashboard standalone build fix** - Resolved native module loading error when running via `npx @savecontext/dashboard`
  - Clean webpack build eliminates Turbopack module hashing artifacts
  - better-sqlite3 now loads correctly in standalone mode

## [0.1.20] - 2026-01-03

### Added
- **Dashboard npx command** - Run the dashboard without cloning the repo
  - `npx @savecontext/dashboard` starts the dashboard on port 3333
  - `npx @savecontext/dashboard -p 4000` for custom port
  - Uses Next.js standalone output mode for self-contained distribution
  - Includes pnpm symlink resolution for native module compatibility

### Changed
- **Next.js upgraded to 16.1.1** - Security patches for CVE-2025-55184 and CVE-2025-67779
  - Uses webpack bundler for production builds (Turbopack has issues with native modules in standalone mode)
  - 0 vulnerabilities in npm audit

### Fixed
- **Embedding provider lazy retry** - If embedding provider (HuggingFace, Ollama, etc.) is unavailable at startup, the server now retries automatically on first search instead of staying broken until restart
  - Added 1-minute retry cooldown to avoid hammering unavailable providers
  - Provider automatically recovers when it becomes available
- **Improved error messages for semantic search fallback**
  - Now shows actual configured provider name instead of generic "Install Ollama" message
  - Startup message indicates provider will retry on first search
  - Keyword fallback tip shows configured provider status

## [0.1.19] - 2026-01-02

### Changed
- **BREAKING: Task tools renamed to Issue tools** - All 13 task-related MCP tools renamed for clarity
  - `context_task_create` → `context_issue_create`
  - `context_task_update` → `context_issue_update`
  - `context_task_list` → `context_issue_list`
  - `context_task_complete` → `context_issue_complete`
  - `context_task_claim` → `context_issue_claim`
  - `context_task_release` → `context_issue_release`
  - `context_task_get_ready` → `context_issue_get_ready`
  - `context_task_get_next_block` → `context_issue_get_next_block`
  - `context_task_create_batch` → `context_issue_create_batch`
  - `context_task_add_dependency` → `context_issue_add_dependency`
  - `context_task_remove_dependency` → `context_issue_remove_dependency`
  - `context_task_add_labels` → `context_issue_add_labels`
  - `context_task_remove_labels` → `context_issue_remove_labels`
- **Parameter name changes** for issue tools
  - `taskId` → `issueId`
  - `task_ids` → `issue_ids`
  - `taskType` → `issueType`
  - `task_title` → `issue_title`
  - `taskIndex` → `issueIndex` (in batch create)
- **Status value changes** - Issue status now uses clearer terminology
  - `pending` → `open`
  - `done` → `closed`
  - Full status set: `open`, `in_progress`, `blocked`, `closed`, `deferred`
- **Database schema updated** - Local SQLite schema uses `issues` table instead of `tasks`
  - Table renamed: `tasks` → `issues`
  - Table renamed: `task_labels` → `issue_labels`
  - Table renamed: `task_dependencies` → `issue_dependencies`
  - Column renamed: `task_type` → `issue_type`
  - Column renamed: `completed_at` → `closed_at`
  - Column renamed: `completed_in_session` → `closed_in_session`
- **CLI renamed** - `savecontext-tasks` → `savecontext-issues`
- **Enhanced issue features** - Issues now support:
  - Human-readable short IDs (e.g., PROJ-123)
  - 5-level priority system (0=lowest to 4=critical)
  - Issue types: task, bug, feature, epic, chore
  - Parent-child hierarchies (Epic > Task > Subtask)
  - Labels for categorization
  - Dependencies between issues
  - Plan linking
  - Agent attribution tracking
- **License changed from MIT to AGPL-3.0** - Commercial license available for proprietary use

### Added
- **Plans system** - Create PRDs and specifications, link issues to plans, track implementation progress
  - `context_plan_create` - Create a new plan (PRD/specification)
  - `context_plan_list` - List plans with status filtering
  - `context_plan_get` - Get plan details with linked epics
  - `context_plan_update` - Update plan title, content, status, or success criteria
- **Project management tools** - Explicit project CRUD operations
  - `context_project_create` - Create a new project with custom issue prefix
  - `context_project_list` - List all projects with session counts
  - `context_project_get` - Get project details by path
  - `context_project_update` - Update project settings
  - `context_project_delete` - Delete project with cascade
- **Issue delete tool** - `context_issue_delete` for permanent issue removal
- **Local embeddings library** - Multi-provider support for semantic search
  - Ollama provider (recommended, uses nomic-embed-text)
  - HuggingFace provider (cloud API, any HF model)
  - Transformers.js fallback (in-process, no external deps)
- **Embeddings CLI** - `savecontext-embeddings` for managing vector embeddings
  - `status` - Check embedding provider and item status
  - `backfill` - Generate embeddings for existing items
  - `providers` - List available embedding providers
- **Issues CLI** - `savecontext-issues` for issue management from command line
- **Plans CLI** - `savecontext-plans` for plan management from command line
- **Dashboard** - Local Next.js web interface for visual session and issue management
- **Category rename** - `task` category renamed to `reminder` for clarity

### Fixed
- **Migration failures now propagate** - Previously, migration errors were silently logged but swallowed, causing the app to continue with broken schema. Now throws error immediately to fail fast.
- **N+1 query in `tagContextItems()`** - Previously made 2 database calls per item in a loop. Now uses batch IN clause query + transaction wrapper for 10-100x performance improvement when tagging multiple items.
- **Semantic search without active session** - `context_get` with `search_all_sessions: true` now works even when no session is active. Previously failed with "No active session" error despite not needing one.

### Improved
- **Database type safety** - Added `SqliteBindValue` type (`string | number | bigint | Buffer | null`) and replaced 11 instances of `params: any[]` with proper typing. Catches type errors at compile time (e.g., accidentally passing booleans which SQLite doesn't support).

## [0.1.18] - 2025-12-19

### Fixed
- **`--tool`, `--path`, `--sync` flags now work** - Flags were documented in v0.1.16 but missing from CLI parser
  - `--tool <name>` - Target tool for skill install (claude, codex, gemini, etc.)
  - `--path <path>` - Custom path for skill install
  - `--sync` - Sync skill to all previously configured tools

## [0.1.17] - 2025-12-19

### Fixed
- **`--setup-skill` flag now works** - Flag was documented in v0.1.16 but missing from published package

### Added
- **Compound Workflow Triggers** - SKILL.md now recognizes multi-step workflow requests
  - "wrap up session", "end of day", "checkpoint everything"
  - "resume fully", "pick up where I left off and show status"
  - "checkpoint with tags", "tag and checkpoint"
  - "prepare for handoff", "handoff to another agent"
- **Compound Workflows Section** - SKILL.md includes step-by-step recipes for:
  - Wrap Up Session: save progress, tag items, checkpoint, pause
  - Resume Fully: start session, show status, display high-priority items and tasks
  - Checkpoint with Tags: review items, tag, create checkpoint
  - Prepare for Handoff: log summary, tag all items, create handoff checkpoint

## [0.1.16] - 2025-12-17

### Added
- **SaveContext Skill for AI Coding Tools** - Teach AI agents how to use SaveContext effectively
  - `npx @savecontext/mcp --setup-skill` installs to Claude Code (`~/.claude/skills/savecontext/`)
  - `--tool codex` installs to OpenAI Codex (`~/.codex/skills/savecontext/`)
  - `--tool <name> --path <path>` installs to any tool with custom skill directory
  - `--sync` updates all previously configured installations
  - Skill config saved to `~/.savecontext/skill-sync.json` for easy updates
  - SKILL.md: Behavioral guidance for session management, context saving, checkpointing
  - references/WORKFLOWS.md: Detailed patterns for multi-session work, compaction recovery, multi-agent coordination
  - **Formatting guidance**: Thorough examples showing how to structure context values with markdown formatting, good/bad comparisons, length guidelines

### Fixed
- **Cross-platform statusline support** - Session tracking now works on Windows, macOS, Linux, and WSL
  - **Setup detects Python automatically**: Tries `py -3` (Windows), `python3`, `python` in order
  - Shows platform-specific install instructions if Python 3 not found
  - **Windows**: `WT_SESSION`, `ConEmuPID`, `SESSIONNAME` + PPID, `winpid-{PPID}` fallback
  - **WSL**: Detects via kernel release, uses Windows Terminal env vars when available
  - **Linux**: TTY, GNOME Terminal, Konsole, Tilix, Kitty, Alacritty, `linuxpid-{PPID}` fallback
  - **macOS**: TTY, `TERM_SESSION_ID`, `ITERM_SESSION_ID`, `macpid-{PPID}` fallback
  - **All users**: Run `npx @savecontext/mcp@latest --setup-statusline` to update

### Changed
- Build script now copies skills directory to dist
- Package now includes `skills` directory for npm publishing

## [0.1.15] - 2025-12-15

### Added
- **PostToolUse Hook for Real-time Status Updates**
  - Status line now updates immediately when SaveContext MCP tools run
  - Installs `~/.savecontext/hooks/update-status-cache.py` alongside statusline
  - Hooks into session lifecycle: start, resume, switch, pause, end, rename
  - TTY-based isolation ensures multiple Claude Code instances don't conflict
  - Works identically for both local and cloud MCP servers

### Changed
- **`--setup-statusline` now installs both scripts**
  - Statusline script: `~/.savecontext/statusline.py`
  - Hook script: `~/.savecontext/hooks/update-status-cache.py`
  - Automatically configures `~/.claude/settings.json` with hooks section
  - Preserves existing settings and hooks during installation

## [0.1.14] - 2025-12-15

### Added
- **Claude Code Status Line** - See your active session directly in Claude Code
  - `npx @savecontext/mcp@latest --setup-statusline` for one-command setup
  - Displays: session name, context usage (tokens + %), cost, duration, lines changed
  - Automatically refreshes on every SaveContext tool call
  - 2-hour cache TTL per terminal instance
  - Works with both local and cloud modes
- **Improved tool definitions** - Better agent guidance for efficient context retrieval
  - `context_get`: Added `query`, `search_all_sessions`, `threshold` params to schema (semantic search was backend-only, now exposed to agents)
  - `context_list_sessions`: Added `search` param to schema (keyword search was backend-only, now exposed to agents)
  - Tool descriptions now emphasize search-first approach to reduce unnecessary full listings
  - Local mode: `query` param performs keyword fallback with relevance scoring

## [0.1.13] - 2025-12-12

### Added
- **`savecontext-sessions` CLI** - User-focused session management
  - `savecontext-sessions list` - List sessions with search and filtering
  - `savecontext-sessions show` - Display session details
  - `savecontext-sessions rename` - Rename sessions with interactive picker
  - `savecontext-sessions delete` - Delete sessions with confirmation safeguards
  - `savecontext-sessions archive` - Mark sessions as completed (soft close)
  - `savecontext-sessions add-path` - Add project paths to sessions
  - `savecontext-sessions remove-path` - Remove project paths from sessions
  - Requires cloud authentication (`savecontext-auth login`)
- **`savecontext-projects` CLI** - User-focused project management
  - `savecontext-projects list` - List projects with session counts
  - `savecontext-projects rename` - Rename projects
  - `savecontext-projects delete` - Delete projects (sessions unlinked, not deleted)
  - `savecontext-projects merge` - Merge two projects into one
  - Requires cloud authentication (`savecontext-auth login`)
- **Session search parameter** - `context_list_sessions` now supports `search` parameter
  - Case-insensitive text search on session name and description
  - Faster than listing all sessions when looking for specific work
- **Semantic search enhancements** (Cloud only)
  - `search_all_sessions` parameter for cross-session semantic search
  - Default similarity threshold lowered to 0.5 for better recall

### Changed
- **MCP tools reduced from 38 to 35** - User operations separated from agent tools
  - Removed: `context_session_move`, `project_rename`, `project_delete`
  - These operations are now CLI-only via `savecontext-sessions` and `savecontext-projects`
  - Rationale: Agents shouldn't reorganize user's project structure without explicit CLI action
- **CloudClient methods updated** - Session operations now accept explicit `session_id` for CLI use
  - `endSession`, `pauseSession`, `renameSession` can target specific sessions
  - Enables CLI to operate on any session, not just the "current" one

### Fixed
- **Session path operations** - Now require `session_id` and `session_name` for verification
- **Activity tracking** - Session activity timestamps update correctly across all operations

## [0.1.12] - 2025-11-30

### Added
- **`savecontext-auth` CLI** - Device authorization for SaveContext Cloud
  - `savecontext-auth login` - Authenticate via browser with OAuth (GitHub, Google)
  - `savecontext-auth logout` - Log out and clear local credentials
  - `savecontext-auth status` - Show authentication status and MCP URL
  - `savecontext-auth whoami` - Display current user info
  - Auto-opens browser for authentication
  - MCP config JSON copied to clipboard on successful login
  - Professional terminal UX with spinners, styled boxes, and colors
  - CI/automation support: `--quiet`, `--json`, `--no-clipboard`, `--no-save`, `--redact` flags
  - `--no-save` outputs full API key to stdout without saving to disk (for CI secrets management)
  - `--redact` hides API key in terminal output while still saving to credentials file
  - Clipboard security warning when API key is copied
- **`context_session_remove_path` tool** - Remove project paths from multi-path sessions
  - Cannot remove the last path (sessions must have at least one project path)
  - Works in both local SQLite and cloud modes
  - Tool schema includes `project_path` (required) parameter
  - Use case: Clean up stale paths or paths added by mistake to sessions
- **HTTP Streamable Transport** - Direct MCP connections without stdio proxy (Cloud only)
  - Endpoint: `https://mcp.savecontext.dev/mcp` with Bearer token auth
  - Supports `initialize`, `tools/list`, `tools/call` methods
  - Enables remote connections from Claude Desktop, Factory, OpenAI, and other HTTP-capable clients
  - See README for client-specific configuration examples

### Fixed
- **Cloud: Resume completed sessions** - Cloud API now allows resuming completed sessions
  - Local mode already supported this (see v0.1.2 changelog)
  - Removed artificial restriction in Lambda that blocked `context_session_resume` for completed sessions
  - Sessions can now be resumed regardless of status (active, paused, or completed)
- **Cloud: Session operations now respect resumed session** - Fixed bug where session tools would operate on wrong session
  - After `context_session_resume`, tools like `context_status`, `context_session_add_path`, etc. would fall back to most recently updated session instead of the resumed one
  - Now explicitly passes `session_id` to all session operations: status, rename, end, pause, add_path, remove_path
  - Critical fix for multi-project workflows where you need to operate on a specific session

## [0.1.11] - 2025-11-24

### Added
- **23 new MCP client mappings** - Extended provider detection for more AI coding tools
  - IDEs: VS Code, Visual Studio, Zed, JetBrains
  - AI Assistants: Roo Code, Augment, Kilo Code, Copilot, Cody, Tabnine, Qodo, Amazon Q, Replit, Opencode, Antigravity
  - CLI Tools: Gemini CLI, Warp, Qwen Coder
  - Desktop Apps: Perplexity, ChatGPT, LM Studio, BoltAI, Raycast

### Changed
- **Agent ID format for desktop apps** - Desktop apps without project context now use `global-{provider}` format
  - Previously: `unknown-main-claude-desktop` (confusing with fake branch)
  - Now: `global-claude-desktop` (clean, no branch since desktop apps can't detect it)
  - Coding tools with project context unchanged: `{project}-{branch}-{provider}`
- **Provider detection reorganized** - Client mappings now organized into two clear sections:
  - Coding tools (have project path and git branch context)
  - Desktop apps (no project path or git branch context)
- **`context_session_start` tool description enhanced** - Improved guidance for AI agents on project path usage
  - Added `project_path` to tool schema with clear description
  - Instructions to always pass specific project folder path (not workspace root)
  - Guidance to ask user when working in monorepo or unsure which project to use
  - Prevents incorrect project tracking from tools that don't set working directory correctly

### Fixed
- **Desktop app agent tracking** - Claude Desktop and other desktop apps now properly tracked as active agents
  - Previously desktop apps weren't tracked because they don't send project path
  - Cloud API now accepts agents without project path, using "global" as fallback
- **Cloud client error handling** - `ensureSession()` now logs errors instead of silently swallowing them
- **Safe JSON parsing** - Database tag parsing now handles corrupted JSON gracefully instead of crashing
- **Fetch response handling** - Cloud client now handles non-JSON success responses correctly

### Improved
- **Schema constraints** - Tool schemas now include input validation hints
  - Session name: 1-200 characters
  - Context value: max 100KB
  - Query limit: 1-300 items
- **Code organization** - Configuration constants moved to shared `utils/constants.ts`
- **Checkpoint validation** - Extracted `validateCheckpointName` helper to reduce code duplication

## [0.1.10] - 2025-11-22

### Added
- **`force_new` parameter for `context_session_start`** - Force create a new session instead of auto-resuming
  - When `force_new=true`, pauses any existing active session before creating new one
  - Paused sessions can be resumed later via `context_session_resume`
  - Useful when you want to start fresh without resuming previous work
  - Tool description updated to mention this option

### Changed
- **`context_session_rename` now requires `current_name` parameter** - Verification to prevent accidental renames
  - Must call `context_status` first to get current session name
  - Prevents renaming wrong session when multiple sessions exist
  - TypeScript `RenameSessionArgs` interface updated with `current_name: string`

### Fixed
- **Session resume bug** - Only resume sessions with `active` status, not `completed` or `paused`
  - Previously could try to resume a session that was already ended
- **Stale agent session cleanup** - Agent session links are properly cleaned up when:
  - Session is ended via `context_session_end`
  - New session is forced via `force_new=true`
- **Cloud prepare-compaction** - Now properly passes session_id to API endpoint

## [0.1.9] - 2025-11-20

### Fixed
- npx @savecontext/mcp now works directly without -p flag

### Changed
- Package now exposes 4 binaries: `savecontext`, `savecontext-migrate`, `mcp`, `migrate`
- The `mcp` alias enables `npx @savecontext/mcp` to work

## [0.1.8] - 2025-11-20

### Fixed
- **Critical:** Executable permissions on compiled binaries now preserved via build script
- TypeScript compilation loses executable permissions - now explicitly restored with chmod
- Both `savecontext` and `savecontext-migrate` binaries now work correctly after npm install
- v0.1.6 and v0.1.7 were unusable - use v0.1.8 instead

### Changed
- Build script now includes `chmod +x dist/index.js dist/cli/migrate.js` to ensure binaries are executable

## [0.1.7] - 2025-11-20 [BROKEN - USE 0.1.8]

### Fixed
- **Critical:** Restore `./` prefix to bin entries that were stripped by `npm pkg fix`
- Package executables now work correctly with `npx` and global installs
- v0.1.6 was unusable due to broken bin paths - use v0.1.7 instead

## [0.1.6] - 2025-11-20 [BROKEN - USE 0.1.8]

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
