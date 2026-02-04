-- Migration: Add multi-project issue support
-- Enables issues (especially epics) to span multiple project directories

-- Create junction table for many-to-many issue-project relationship
CREATE TABLE IF NOT EXISTS issue_projects (
  issue_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY (issue_id, project_path),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_issue_projects_path
  ON issue_projects(project_path);

CREATE INDEX IF NOT EXISTS idx_issue_projects_issue
  ON issue_projects(issue_id);
