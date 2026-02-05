-- Migration 003: Add agent-scoped session tracking
-- Enables multiple Claude Code instances to work simultaneously
-- Uses MCP protocol clientInfo for automatic provider detection

-- Create agent_sessions table for tracking which session each agent is working on
CREATE TABLE IF NOT EXISTS agent_sessions (
  agent_id TEXT PRIMARY KEY,            -- "${project}-${branch}"
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,           -- Full path for reference
  git_branch TEXT NOT NULL,             -- Explicit for queries
  provider TEXT NOT NULL,               -- From MCP clientInfo.name
  last_active_at INTEGER NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Index for finding all agents working on a session
CREATE INDEX IF NOT EXISTS idx_agent_sessions_session
  ON agent_sessions(session_id);

-- Index for project + branch queries
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_branch
  ON agent_sessions(project_path, git_branch);

-- Index for provider analytics
CREATE INDEX IF NOT EXISTS idx_agent_sessions_provider
  ON agent_sessions(provider);

-- Backfill: Create agent_session entries for all currently active sessions
-- Uses 'legacy-{session_id}' as agent_id since we cannot reliably extract project name from SQL
-- These will be updated with proper '{projectname}-{branch}' agent_ids when sessions are accessed
INSERT OR IGNORE INTO agent_sessions (agent_id, session_id, project_path, git_branch, provider, last_active_at)
SELECT
  'legacy-' || s.id as agent_id,
  s.id as session_id,
  COALESCE(sp.project_path, s.project_path) as project_path,
  COALESCE(s.branch, 'main') as git_branch,
  'unknown' as provider,
  s.updated_at as last_active_at
FROM sessions s
LEFT JOIN session_projects sp ON s.id = sp.session_id
WHERE s.status = 'active'
GROUP BY s.id;

-- Note: The agent_sessions table is now the source of truth for "current session per agent"
-- Multiple sessions can be status='active' simultaneously (different agents)
-- Provider is auto-detected from MCP clientInfo during initialization handshake
