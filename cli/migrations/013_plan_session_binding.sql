-- Migration 013: Plan Session Binding + JSONL Sync Support
--
-- Elevates plans to first-class session-bound entities with dirty tracking
-- for JSONL sync, matching the pattern used by sessions, issues, and context items.
-- Also adds source deduplication columns for multi-agent plan capture.

-- Session binding: nullable FK for backward compatibility
ALTER TABLE plans ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);

-- Source deduplication for plan capture (Phase 2)
ALTER TABLE plans ADD COLUMN source_path TEXT;
ALTER TABLE plans ADD COLUMN source_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_plans_source_hash ON plans(source_hash);

-- Dirty tracking table for JSONL sync
CREATE TABLE IF NOT EXISTS dirty_plans (
    plan_id TEXT PRIMARY KEY,
    marked_at INTEGER NOT NULL
);

-- Trigger: mark plan dirty on INSERT
CREATE TRIGGER IF NOT EXISTS mark_plan_dirty_insert
AFTER INSERT ON plans
BEGIN
    INSERT INTO dirty_plans (plan_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(plan_id) DO UPDATE SET marked_at = excluded.marked_at;
END;

-- Trigger: mark plan dirty on UPDATE
CREATE TRIGGER IF NOT EXISTS mark_plan_dirty_update
AFTER UPDATE ON plans
BEGIN
    INSERT INTO dirty_plans (plan_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(plan_id) DO UPDATE SET marked_at = excluded.marked_at;
END;
