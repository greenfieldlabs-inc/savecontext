-- Time tracking: billable hours linked to issues and billing periods.

CREATE TABLE IF NOT EXISTS time_entries (
    id              TEXT PRIMARY KEY,
    short_id        TEXT,
    project_path    TEXT NOT NULL,
    issue_id        TEXT,
    period          TEXT,
    hours           REAL NOT NULL,
    description     TEXT NOT NULL,
    work_date       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'logged',
    actor           TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL,
    CHECK (hours > 0),
    CHECK (status IN ('logged', 'reviewed', 'invoiced'))
);

CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_path);
CREATE INDEX IF NOT EXISTS idx_time_entries_issue ON time_entries(issue_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_period ON time_entries(period);
CREATE INDEX IF NOT EXISTS idx_time_entries_status ON time_entries(status);
CREATE INDEX IF NOT EXISTS idx_time_entries_work_date ON time_entries(work_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_short_id ON time_entries(project_path, short_id);

-- Dirty tracking for sync export
CREATE TABLE IF NOT EXISTS dirty_time_entries (
    time_entry_id TEXT PRIMARY KEY,
    marked_at     INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS mark_time_entry_dirty_insert
AFTER INSERT ON time_entries BEGIN
    INSERT INTO dirty_time_entries (time_entry_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(time_entry_id) DO UPDATE SET marked_at = excluded.marked_at;
END;

CREATE TRIGGER IF NOT EXISTS mark_time_entry_dirty_update
AFTER UPDATE ON time_entries BEGIN
    INSERT INTO dirty_time_entries (time_entry_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(time_entry_id) DO UPDATE SET marked_at = excluded.marked_at;
END;
