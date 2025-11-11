-- SaveContext Database Schema
-- Simple, focused, effective
-- Learned from Memory Keeper, built for cloud-first architecture
-- NOTE: PRAGMA statements are executed in TypeScript code

-- ====================
-- Core Tables
-- ====================

-- Sessions: Track conversation sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  branch TEXT,                          -- Git branch if available
  channel TEXT DEFAULT 'general',       -- Derived from branch or name
  project_path TEXT,                    -- Absolute path to project/repo
  status TEXT DEFAULT 'active',         -- 'active', 'paused', 'completed'
  ended_at INTEGER,                     -- Timestamp when paused/completed
  created_at INTEGER NOT NULL,          -- Unix timestamp (ms)
  updated_at INTEGER NOT NULL,

  -- Cloud sync fields (for future)
  user_id TEXT,                         -- For multi-user support
  synced_at INTEGER,                    -- Last cloud sync timestamp
  is_synced INTEGER DEFAULT 0           -- 0 = local only, 1 = synced
);

-- Context Items: The actual saved context
CREATE TABLE IF NOT EXISTS context_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'note',         -- task, decision, progress, note
  priority TEXT DEFAULT 'normal',       -- high, normal, low
  channel TEXT DEFAULT 'general',       -- Topic/branch-based organization
  tags TEXT DEFAULT '[]',               -- JSON array of tag strings
  size INTEGER DEFAULT 0,               -- Size in bytes for cleanup
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- Cloud sync fields
  synced_at INTEGER,
  is_synced INTEGER DEFAULT 0,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, key)               -- One key per session
);

-- Checkpoints: Complete snapshots of session state
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  git_status TEXT,                      -- Git status at checkpoint
  git_branch TEXT,                      -- Git branch at checkpoint
  item_count INTEGER DEFAULT 0,         -- Number of items in checkpoint
  total_size INTEGER DEFAULT 0,         -- Total size in bytes
  created_at INTEGER NOT NULL,

  -- Cloud sync fields
  synced_at INTEGER,
  is_synced INTEGER DEFAULT 0,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Checkpoint Items: Link checkpoints to context items
CREATE TABLE IF NOT EXISTS checkpoint_items (
  id TEXT PRIMARY KEY,
  checkpoint_id TEXT NOT NULL,
  context_item_id TEXT NOT NULL,
  group_name TEXT,                      -- Optional group name for organization
  group_order INTEGER DEFAULT 0,        -- Order within group

  FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
  FOREIGN KEY (context_item_id) REFERENCES context_items(id) ON DELETE CASCADE
);

-- File Cache: Track files read during session (optional for MVP)
CREATE TABLE IF NOT EXISTS file_cache (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT,
  hash TEXT,                            -- SHA-256 for change detection
  size INTEGER DEFAULT 0,
  last_read INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, file_path)
);

-- Session Projects: Many-to-many relationship for multi-path sessions
CREATE TABLE IF NOT EXISTS session_projects (
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  added_at INTEGER NOT NULL,            -- Timestamp when path was added

  PRIMARY KEY (session_id, project_path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- ====================
-- Indexes for Performance
-- ====================

-- Context Items indexes
CREATE INDEX IF NOT EXISTS idx_context_items_session
  ON context_items(session_id);
CREATE INDEX IF NOT EXISTS idx_context_items_category
  ON context_items(category);
CREATE INDEX IF NOT EXISTS idx_context_items_priority
  ON context_items(priority);
CREATE INDEX IF NOT EXISTS idx_context_items_channel
  ON context_items(channel);
CREATE INDEX IF NOT EXISTS idx_context_items_created
  ON context_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_items_session_created
  ON context_items(session_id, created_at DESC);

-- Checkpoint indexes
CREATE INDEX IF NOT EXISTS idx_checkpoints_session
  ON checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created
  ON checkpoints(created_at DESC);

-- File cache indexes
CREATE INDEX IF NOT EXISTS idx_file_cache_session
  ON file_cache(session_id);
CREATE INDEX IF NOT EXISTS idx_file_cache_path
  ON file_cache(file_path);

-- Session projects indexes
CREATE INDEX IF NOT EXISTS idx_session_projects_path
  ON session_projects(project_path);
CREATE INDEX IF NOT EXISTS idx_session_projects_session
  ON session_projects(session_id);

-- Session lifecycle indexes
CREATE INDEX IF NOT EXISTS idx_sessions_project_path
  ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_project_status
  ON sessions(project_path, status);

-- Cloud sync indexes (for future)
CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_synced
  ON sessions(is_synced, synced_at);
CREATE INDEX IF NOT EXISTS idx_context_items_synced
  ON context_items(is_synced, synced_at);

-- ====================
-- Triggers for Maintenance
-- ====================

-- Auto-update session timestamps
CREATE TRIGGER IF NOT EXISTS update_session_timestamp
AFTER INSERT ON context_items
BEGIN
  UPDATE sessions
  SET updated_at = (strftime('%s', 'now') * 1000)
  WHERE id = NEW.session_id;
END;

-- NOTE: Size is calculated in TypeScript before insert

-- ====================
-- Views for Convenience
-- ====================

-- Recent sessions view
CREATE VIEW IF NOT EXISTS recent_sessions AS
SELECT
  s.id,
  s.name,
  s.description,
  s.branch,
  s.channel,
  s.created_at,
  s.updated_at,
  COUNT(DISTINCT ci.id) as item_count,
  COALESCE(SUM(ci.size), 0) as total_size
FROM sessions s
LEFT JOIN context_items ci ON s.id = ci.session_id
GROUP BY s.id
ORDER BY s.updated_at DESC;

-- High priority items view
CREATE VIEW IF NOT EXISTS high_priority_items AS
SELECT
  ci.*,
  s.name as session_name,
  s.branch as session_branch
FROM context_items ci
JOIN sessions s ON ci.session_id = s.id
WHERE ci.priority = 'high'
ORDER BY ci.created_at DESC;

-- Session summary view
CREATE VIEW IF NOT EXISTS session_summary AS
SELECT
  s.id,
  s.name,
  s.channel,
  COUNT(DISTINCT ci.id) as total_items,
  COUNT(DISTINCT CASE WHEN ci.category = 'task' THEN ci.id END) as tasks,
  COUNT(DISTINCT CASE WHEN ci.category = 'decision' THEN ci.id END) as decisions,
  COUNT(DISTINCT CASE WHEN ci.category = 'progress' THEN ci.id END) as progress_items,
  COUNT(DISTINCT CASE WHEN ci.priority = 'high' THEN ci.id END) as high_priority,
  COUNT(DISTINCT cp.id) as checkpoint_count,
  COALESCE(SUM(ci.size), 0) as total_size
FROM sessions s
LEFT JOIN context_items ci ON s.id = ci.session_id
LEFT JOIN checkpoints cp ON s.id = cp.session_id
GROUP BY s.id;

-- ====================
-- Multi-Agent Support (v0.1.2)
-- ====================

-- Agent Sessions: Track which agent is currently working on each session
-- Enables multiple terminal instances to work simultaneously
CREATE TABLE IF NOT EXISTS agent_sessions (
  agent_id TEXT PRIMARY KEY,               -- Format: {projectName}-{branch}-{provider}
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,              -- Full project path
  git_branch TEXT,                         -- Git branch name
  provider TEXT,                           -- MCP client provider (claude-code, factory-ai, cursor, etc.)
  last_active_at INTEGER NOT NULL,         -- Timestamp of last activity

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_session
  ON agent_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project
  ON agent_sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_active
  ON agent_sessions(last_active_at DESC);

-- ====================
-- Project Memory & Tasks (v0.1.3)
-- ====================

-- Project Memory: Store project-specific commands, configs, and notes
-- UNIQUE constraint on (project_path, key) enables UPSERT behavior
CREATE TABLE IF NOT EXISTS project_memory (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'command',         -- command, config, note
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(project_path, key)
);

CREATE INDEX IF NOT EXISTS idx_memory_project ON project_memory(project_path);
CREATE INDEX IF NOT EXISTS idx_memory_category ON project_memory(category);

-- Tasks: Simple task management with todo/done status
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo',              -- todo, done
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_path);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
