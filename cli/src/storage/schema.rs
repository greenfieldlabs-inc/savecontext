//! Database schema definitions and migration logic.
//!
//! This module contains the complete SQLite schema for SaveContext,
//! ported from the TypeScript MCP server's schema.sql.

use rusqlite::{Connection, Result};

/// Current schema version for migration tracking.
pub const CURRENT_SCHEMA_VERSION: i32 = 1;

/// The complete SQL schema for the SaveContext database.
///
/// Note: Timestamps are stored as INTEGER (Unix milliseconds) for consistency
/// with the existing TypeScript implementation.
pub const SCHEMA_SQL: &str = r#"
-- ====================
-- Schema Version Tracking
-- ====================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

-- ====================
-- Core Tables
-- ====================

-- Projects: Registry for ID generation and metadata
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

-- Sessions: Track conversation sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    branch TEXT,
    channel TEXT DEFAULT 'general',
    project_path TEXT,
    status TEXT DEFAULT 'active',
    ended_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    user_id TEXT,
    synced_at INTEGER,
    is_synced INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_project_status ON sessions(project_path, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_synced ON sessions(is_synced, synced_at);

-- Session Projects: Many-to-many for multi-path sessions
CREATE TABLE IF NOT EXISTS session_projects (
    session_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, project_path),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_projects_path ON session_projects(project_path);
CREATE INDEX IF NOT EXISTS idx_session_projects_session ON session_projects(session_id);

-- Context Items: The actual saved context
CREATE TABLE IF NOT EXISTS context_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'note',
    priority TEXT DEFAULT 'normal',
    channel TEXT DEFAULT 'general',
    tags TEXT DEFAULT '[]',
    size INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    embedding_status TEXT DEFAULT 'none',
    embedding_provider TEXT,
    embedding_model TEXT,
    chunk_count INTEGER DEFAULT 0,
    embedded_at INTEGER,
    synced_at INTEGER,
    is_synced INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, key)
);

CREATE INDEX IF NOT EXISTS idx_context_items_session ON context_items(session_id);
CREATE INDEX IF NOT EXISTS idx_context_items_category ON context_items(category);
CREATE INDEX IF NOT EXISTS idx_context_items_priority ON context_items(priority);
CREATE INDEX IF NOT EXISTS idx_context_items_channel ON context_items(channel);
CREATE INDEX IF NOT EXISTS idx_context_items_created ON context_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_items_session_created ON context_items(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_items_embedding_status ON context_items(embedding_status);
CREATE INDEX IF NOT EXISTS idx_context_items_synced ON context_items(is_synced, synced_at);

-- Checkpoints: Complete snapshots of session state
CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    git_status TEXT,
    git_branch TEXT,
    item_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    synced_at INTEGER,
    is_synced INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(created_at DESC);

-- Checkpoint Items: Link checkpoints to context items
CREATE TABLE IF NOT EXISTS checkpoint_items (
    id TEXT PRIMARY KEY,
    checkpoint_id TEXT NOT NULL,
    context_item_id TEXT NOT NULL,
    group_name TEXT,
    group_order INTEGER DEFAULT 0,
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
    FOREIGN KEY (context_item_id) REFERENCES context_items(id) ON DELETE CASCADE
);

-- Plans: Implementation plans (PRDs/specs)
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    short_id TEXT,
    project_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    status TEXT DEFAULT 'draft',
    success_criteria TEXT,
    created_in_session TEXT,
    completed_in_session TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plans_project_id ON plans(project_id);
CREATE INDEX IF NOT EXISTS idx_plans_project_path ON plans(project_path);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_short_id ON plans(project_id, short_id);

-- Issues: Task/bug/feature tracking
-- Note: Parent-child relationships are stored in issue_dependencies with type 'parent-child'
CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    short_id TEXT,
    project_path TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    details TEXT,
    status TEXT DEFAULT 'open',
    priority INTEGER DEFAULT 2,
    issue_type TEXT DEFAULT 'task',
    plan_id TEXT,
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
    deferred_at INTEGER,
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL,
    CHECK (priority >= 0 AND priority <= 4)
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_path);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_issues_plan ON issues(plan_id);
CREATE INDEX IF NOT EXISTS idx_issues_short_id ON issues(project_path, short_id);
CREATE INDEX IF NOT EXISTS idx_issues_assigned ON issues(assigned_to_agent);

-- Issue Projects: Many-to-many for multi-project issues
CREATE TABLE IF NOT EXISTS issue_projects (
    issue_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    PRIMARY KEY (issue_id, project_path),
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_projects_path ON issue_projects(project_path);
CREATE INDEX IF NOT EXISTS idx_issue_projects_issue ON issue_projects(issue_id);

-- Issue Labels: Tags for categorizing issues
CREATE TABLE IF NOT EXISTS issue_labels (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    label TEXT NOT NULL,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    UNIQUE(issue_id, label)
);

CREATE INDEX IF NOT EXISTS idx_issue_labels_label ON issue_labels(label);

-- Issue Dependencies: Relationships between issues
CREATE TABLE IF NOT EXISTS issue_dependencies (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    depends_on_id TEXT NOT NULL,
    dependency_type TEXT DEFAULT 'blocks',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_id) REFERENCES issues(id) ON DELETE CASCADE,
    UNIQUE(issue_id, depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_deps_depends ON issue_dependencies(depends_on_id);

-- Project Memory: Store project-specific commands, configs, notes
CREATE TABLE IF NOT EXISTS project_memory (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'command',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_path, key)
);

CREATE INDEX IF NOT EXISTS idx_memory_project ON project_memory(project_path);
CREATE INDEX IF NOT EXISTS idx_memory_category ON project_memory(category);

-- Agent Sessions: Track active agents per session
CREATE TABLE IF NOT EXISTS agent_sessions (
    agent_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    git_branch TEXT,
    provider TEXT,
    last_active_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_session ON agent_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_active ON agent_sessions(last_active_at DESC);

-- File Cache: Track files read during session (optional)
CREATE TABLE IF NOT EXISTS file_cache (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT,
    hash TEXT,
    size INTEGER DEFAULT 0,
    last_read INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_file_cache_session ON file_cache(session_id);
CREATE INDEX IF NOT EXISTS idx_file_cache_path ON file_cache(file_path);

-- ====================
-- Sync Support (JSONL Export/Import)
-- ====================

-- Dirty tracking for incremental export
CREATE TABLE IF NOT EXISTS dirty_sessions (
    session_id TEXT PRIMARY KEY,
    marked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dirty_issues (
    issue_id TEXT PRIMARY KEY,
    marked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dirty_context_items (
    item_id TEXT PRIMARY KEY,
    marked_at INTEGER NOT NULL
);

-- Export hashes for deduplication
CREATE TABLE IF NOT EXISTS export_hashes (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    exported_at INTEGER NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
);

-- Deletion tracking for sync
-- Records when entities are deleted so imports can apply the deletion
CREATE TABLE IF NOT EXISTS sync_deletions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    deleted_by TEXT NOT NULL,
    exported INTEGER DEFAULT 0,
    UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_deletions_project ON sync_deletions(project_path);
CREATE INDEX IF NOT EXISTS idx_sync_deletions_exported ON sync_deletions(exported);

-- ====================
-- Embeddings Support (BLOB-based, pure Rust)
-- ====================

-- Embeddings configuration metadata (for dynamic dimension support)
CREATE TABLE IF NOT EXISTS embeddings_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Vector storage using regular SQLite BLOB columns
-- Stores embeddings as binary f32 arrays (4 bytes per dimension)
-- Supports chunking for large text items
CREATE TABLE IF NOT EXISTS embedding_chunks (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    dimensions INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (item_id) REFERENCES context_items(id) ON DELETE CASCADE,
    UNIQUE(item_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_embedding_chunks_item ON embedding_chunks(item_id);
CREATE INDEX IF NOT EXISTS idx_embedding_chunks_provider ON embedding_chunks(provider, model);

-- ====================
-- Audit Events
-- ====================

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    comment TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor);

-- ====================
-- Triggers
-- ====================

-- Auto-update session timestamps when context items change
CREATE TRIGGER IF NOT EXISTS update_session_timestamp
AFTER INSERT ON context_items
BEGIN
    UPDATE sessions
    SET updated_at = (strftime('%s', 'now') * 1000)
    WHERE id = NEW.session_id;
END;

-- Mark sessions dirty on change
CREATE TRIGGER IF NOT EXISTS mark_session_dirty_insert
AFTER INSERT ON sessions
BEGIN
    INSERT INTO dirty_sessions (session_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET marked_at = excluded.marked_at;
END;

CREATE TRIGGER IF NOT EXISTS mark_session_dirty_update
AFTER UPDATE ON sessions
BEGIN
    INSERT INTO dirty_sessions (session_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET marked_at = excluded.marked_at;
END;

-- Mark issues dirty on change
CREATE TRIGGER IF NOT EXISTS mark_issue_dirty_insert
AFTER INSERT ON issues
BEGIN
    INSERT INTO dirty_issues (issue_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(issue_id) DO UPDATE SET marked_at = excluded.marked_at;
END;

CREATE TRIGGER IF NOT EXISTS mark_issue_dirty_update
AFTER UPDATE ON issues
BEGIN
    INSERT INTO dirty_issues (issue_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(issue_id) DO UPDATE SET marked_at = excluded.marked_at;
END;

-- Mark context items dirty on change
-- Note: We use a single INSERT ON CONFLICT UPDATE pattern to handle both insert and update
CREATE TRIGGER IF NOT EXISTS mark_item_dirty_insert
AFTER INSERT ON context_items
BEGIN
    INSERT INTO dirty_context_items (item_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(item_id) DO UPDATE SET marked_at = excluded.marked_at;
END;

CREATE TRIGGER IF NOT EXISTS mark_item_dirty_update
AFTER UPDATE ON context_items
BEGIN
    INSERT INTO dirty_context_items (item_id, marked_at)
    VALUES (NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT(item_id) DO UPDATE SET marked_at = excluded.marked_at;
END;

-- ====================
-- Views
-- ====================

-- Recent sessions with item counts
CREATE VIEW IF NOT EXISTS recent_sessions AS
SELECT
    s.id,
    s.name,
    s.description,
    s.branch,
    s.channel,
    s.status,
    s.project_path,
    s.created_at,
    s.updated_at,
    COUNT(DISTINCT ci.id) as item_count,
    COALESCE(SUM(ci.size), 0) as total_size
FROM sessions s
LEFT JOIN context_items ci ON s.id = ci.session_id
GROUP BY s.id
ORDER BY s.updated_at DESC;

-- High priority items
CREATE VIEW IF NOT EXISTS high_priority_items AS
SELECT
    ci.*,
    s.name as session_name,
    s.branch as session_branch
FROM context_items ci
JOIN sessions s ON ci.session_id = s.id
WHERE ci.priority = 'high'
ORDER BY ci.created_at DESC;

-- Session summary with category breakdown
CREATE VIEW IF NOT EXISTS session_summary AS
SELECT
    s.id,
    s.name,
    s.channel,
    s.status,
    COUNT(DISTINCT ci.id) as total_items,
    COUNT(DISTINCT CASE WHEN ci.category = 'reminder' THEN ci.id END) as reminders,
    COUNT(DISTINCT CASE WHEN ci.category = 'decision' THEN ci.id END) as decisions,
    COUNT(DISTINCT CASE WHEN ci.category = 'progress' THEN ci.id END) as progress_items,
    COUNT(DISTINCT CASE WHEN ci.priority = 'high' THEN ci.id END) as high_priority,
    COUNT(DISTINCT cp.id) as checkpoint_count,
    COALESCE(SUM(ci.size), 0) as total_size
FROM sessions s
LEFT JOIN context_items ci ON s.id = ci.session_id
LEFT JOIN checkpoints cp ON s.id = cp.session_id
GROUP BY s.id;

-- Open issues by project
CREATE VIEW IF NOT EXISTS open_issues AS
SELECT
    i.*,
    COUNT(DISTINCT il.label) as label_count,
    COUNT(DISTINCT id.depends_on_id) as dependency_count
FROM issues i
LEFT JOIN issue_labels il ON i.id = il.issue_id
LEFT JOIN issue_dependencies id ON i.id = id.issue_id
WHERE i.status NOT IN ('closed', 'deferred')
GROUP BY i.id
ORDER BY i.priority DESC, i.created_at ASC;
"#;

/// Apply the schema to the database.
///
/// This uses `execute_batch` to run the entire DDL script.
/// It is idempotent because all statements use `IF NOT EXISTS`.
///
/// # Errors
///
/// Returns an error if the SQL execution fails or pragmas cannot be set.
pub fn apply_schema(conn: &Connection) -> Result<()> {
    // Set pragmas before schema creation
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "cache_size", "-64000")?; // 64MB cache
    conn.pragma_update(None, "temp_store", "MEMORY")?;

    // Apply schema
    conn.execute_batch(SCHEMA_SQL)?;

    // Run migrations for existing databases
    super::migrations::run_migrations(conn)?;

    // Record schema version
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![
            format!("v{CURRENT_SCHEMA_VERSION}"),
            chrono::Utc::now().timestamp_millis()
        ],
    )?;

    Ok(())
}

/// Check if a column exists in a table.
#[allow(dead_code)]
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let sql = format!(
        "SELECT 1 FROM pragma_table_info('{}') WHERE name = ?1",
        table
    );
    conn.prepare(&sql)?.exists([column])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_schema() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).expect("Failed to apply schema");

        // Verify core tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(tables.contains(&"sessions".to_string()));
        assert!(tables.contains(&"context_items".to_string()));
        assert!(tables.contains(&"issues".to_string()));
        assert!(tables.contains(&"checkpoints".to_string()));
        assert!(tables.contains(&"plans".to_string()));
        assert!(tables.contains(&"projects".to_string()));
        assert!(tables.contains(&"project_memory".to_string()));
        assert!(tables.contains(&"dirty_sessions".to_string()));
        assert!(tables.contains(&"events".to_string()));
        assert!(tables.contains(&"embedding_chunks".to_string()));
        assert!(tables.contains(&"embeddings_meta".to_string()));
    }

    #[test]
    fn test_schema_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();

        // Apply twice - should not fail
        apply_schema(&conn).expect("First apply failed");
        apply_schema(&conn).expect("Second apply failed");
    }

    #[test]
    fn test_foreign_keys_enabled() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        let fk_enabled: i32 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk_enabled, 1);
    }

    #[test]
    fn test_priority_constraint() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        // Valid priority (0-4)
        let result = conn.execute(
            "INSERT INTO issues (id, project_path, title, priority, created_at, updated_at)
             VALUES ('test1', '/test', 'Test', 2, 0, 0)",
            [],
        );
        assert!(result.is_ok());

        // Invalid priority (5)
        let result = conn.execute(
            "INSERT INTO issues (id, project_path, title, priority, created_at, updated_at)
             VALUES ('test2', '/test', 'Test', 5, 0, 0)",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_dirty_tracking_triggers() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        // Insert a session
        conn.execute(
            "INSERT INTO sessions (id, name, created_at, updated_at)
             VALUES ('sess1', 'Test Session', 0, 0)",
            [],
        )
        .unwrap();

        // Check it was marked dirty
        let dirty_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dirty_sessions WHERE session_id = 'sess1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(dirty_count, 1);
    }
}
