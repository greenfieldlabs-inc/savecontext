-- Migration: Add multi-path session support
-- Enables sessions to span multiple related project directories (e.g., monorepo folders)

-- Create junction table for many-to-many session-project relationship
CREATE TABLE IF NOT EXISTS session_projects (
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  added_at INTEGER NOT NULL,          -- Timestamp when path was added
  PRIMARY KEY (session_id, project_path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_session_projects_path
  ON session_projects(project_path);

CREATE INDEX IF NOT EXISTS idx_session_projects_session
  ON session_projects(session_id);

-- Backfill existing sessions from sessions.project_path column
-- This preserves all existing session-project relationships
INSERT OR IGNORE INTO session_projects (session_id, project_path, added_at)
SELECT id, project_path, created_at
FROM sessions
WHERE project_path IS NOT NULL;
