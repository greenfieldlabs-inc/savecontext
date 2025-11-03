-- Migration: Add session lifecycle management
-- Date: 2025-11-03
-- Description: Adds project_path, status, and ended_at columns to sessions table

-- Add new columns (safe for existing data)
ALTER TABLE sessions ADD COLUMN project_path TEXT;
ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE sessions ADD COLUMN ended_at INTEGER;

-- Update existing sessions to have 'active' status
UPDATE sessions SET status = 'active' WHERE status IS NULL;

-- Create new indexes for filtering
CREATE INDEX IF NOT EXISTS idx_sessions_project_path
  ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_project_status
  ON sessions(project_path, status);
