-- Migration 006: Rename tasks to issues with enhanced features
-- Renames tasks table to issues, adds hierarchy, dependencies, labels, and plans

-- Step 1: Create new issues table with all enhanced fields
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  short_id TEXT,
  project_path TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  details TEXT,
  status TEXT DEFAULT 'open',              -- open, in_progress, blocked, closed, deferred
  priority INTEGER DEFAULT 2,              -- 0=lowest, 1=low, 2=normal, 3=high, 4=critical
  issue_type TEXT DEFAULT 'task',          -- task, bug, feature, epic, chore
  plan_id TEXT,                            -- Will reference plans(id) after plans table created
  created_by_agent TEXT,
  closed_by_agent TEXT,
  created_in_session TEXT,
  closed_in_session TEXT,
  assigned_to_agent TEXT,
  assigned_at INTEGER,
  assigned_in_session TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  deferred_at INTEGER
);

-- Step 2: Migrate data from tasks to issues (if tasks table exists)
INSERT OR IGNORE INTO issues (id, project_path, title, description, status, created_at, updated_at, closed_at)
SELECT
  id,
  project_path,
  title,
  description,
  CASE status
    WHEN 'todo' THEN 'open'
    WHEN 'pending' THEN 'open'
    WHEN 'done' THEN 'closed'
    ELSE status
  END,
  created_at,
  updated_at,
  completed_at
FROM tasks;

-- Step 3: Drop old tasks table
DROP TABLE IF EXISTS tasks;

-- Step 4: Create indexes for issues
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_path);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_issues_short_id ON issues(project_path, short_id);
CREATE INDEX IF NOT EXISTS idx_issues_assigned ON issues(assigned_to_agent);

-- Step 5: Create issue_labels table
CREATE TABLE IF NOT EXISTS issue_labels (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  UNIQUE(issue_id, label)
);
CREATE INDEX IF NOT EXISTS idx_issue_labels_label ON issue_labels(label);

-- Step 6: Create issue_dependencies table
CREATE TABLE IF NOT EXISTS issue_dependencies (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  dependency_type TEXT DEFAULT 'blocks',   -- blocks, related, parent-child, discovered-from
  created_at INTEGER NOT NULL,
  UNIQUE(issue_id, depends_on_id)
);
CREATE INDEX IF NOT EXISTS idx_issue_deps_depends ON issue_dependencies(depends_on_id);

-- Step 7: Create projects table for ID generation and metadata
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  issue_prefix TEXT,
  next_issue_number INTEGER DEFAULT 1,
  plan_prefix TEXT,
  next_plan_number INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(project_path);

-- Step 8: Create plans table
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  short_id TEXT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_path TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT DEFAULT 'draft',             -- draft, active, completed, archived
  success_criteria TEXT,
  created_in_session TEXT,
  completed_in_session TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_plans_project_id ON plans(project_id);
CREATE INDEX IF NOT EXISTS idx_plans_project_path ON plans(project_path);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_short_id ON plans(project_id, short_id);

-- Step 9: Add foreign key for plan_id on issues (can't ALTER in SQLite, handled by app)
CREATE INDEX IF NOT EXISTS idx_issues_plan ON issues(plan_id);
