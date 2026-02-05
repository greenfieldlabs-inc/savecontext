-- Migration 004: Add project memory and tasks tables
-- Adds lightweight memory storage for project-specific commands/configs
-- and simple task management for tracking work across sessions

-- Project Memory Table
-- Stores project-specific commands, configs, and notes
-- UNIQUE constraint on (project_path, key) enables UPSERT behavior
CREATE TABLE IF NOT EXISTS project_memory (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'command',  -- command, config, note
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(project_path, key)
);

CREATE INDEX IF NOT EXISTS idx_memory_project ON project_memory(project_path);
CREATE INDEX IF NOT EXISTS idx_memory_category ON project_memory(category);

-- Tasks Table
-- Simple task management with todo/done status
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo',  -- todo, done
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_path);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
