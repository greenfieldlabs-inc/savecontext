//! Database migrations embedded at compile time.
//!
//! Migrations are sourced from `/migrations/` at the repo root and
//! embedded into the binary using `include_str!`. This ensures the
//! binary is self-contained with no runtime file dependencies.

use rusqlite::{Connection, Result};
use tracing::{info, warn};

/// A single migration with version identifier and SQL content.
struct Migration {
    version: &'static str,
    sql: &'static str,
}

/// All migrations in order, embedded at compile time.
///
/// Version names match the SQL filenames (without .sql extension).
/// The `schema_migrations` table tracks which have been applied.
const MIGRATIONS: &[Migration] = &[
    Migration {
        version: "001_add_session_lifecycle",
        sql: include_str!("../../../migrations/001_add_session_lifecycle.sql"),
    },
    Migration {
        version: "002_add_multi_path_sessions",
        sql: include_str!("../../../migrations/002_add_multi_path_sessions.sql"),
    },
    Migration {
        version: "003_add_agent_sessions",
        sql: include_str!("../../../migrations/003_add_agent_sessions.sql"),
    },
    Migration {
        version: "004_add_memory_and_tasks",
        sql: include_str!("../../../migrations/004_add_memory_and_tasks.sql"),
    },
    Migration {
        version: "005_add_checkpoint_grouping",
        sql: include_str!("../../../migrations/005_add_checkpoint_grouping.sql"),
    },
    Migration {
        version: "006_rename_tasks_to_issues",
        sql: include_str!("../../../migrations/006_rename_tasks_to_issues.sql"),
    },
    Migration {
        version: "007_embeddings_support",
        sql: include_str!("../../../migrations/007_embeddings_support.sql"),
    },
    Migration {
        version: "008_dynamic_vec_dimensions",
        sql: include_str!("../../../migrations/008_dynamic_vec_dimensions.sql"),
    },
    Migration {
        version: "009_rename_task_to_reminder",
        sql: include_str!("../../../migrations/009_rename_task_to_reminder.sql"),
    },
    Migration {
        version: "010_issue_projects",
        sql: include_str!("../../../migrations/010_issue_projects.sql"),
    },
    Migration {
        version: "011_blob_embeddings",
        sql: include_str!("../../../migrations/011_blob_embeddings.sql"),
    },
    Migration {
        version: "012_tiered_embeddings",
        sql: include_str!("../../../migrations/012_tiered_embeddings.sql"),
    },
];

/// Run all pending migrations on the database.
///
/// Migrations are applied in order. Already-applied migrations (tracked in
/// the `schema_migrations` table) are skipped. This is idempotent and safe
/// to call on every database open.
///
/// # Errors
///
/// Returns an error if a migration fails to apply. Note that ALTER TABLE
/// errors for duplicate columns are handled gracefully (logged as warnings)
/// since the schema may already have those columns from the base DDL.
pub fn run_migrations(conn: &Connection) -> Result<()> {
    // Ensure schema_migrations table exists
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Get already applied migrations
    let applied: std::collections::HashSet<String> = conn
        .prepare("SELECT version FROM schema_migrations")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;

    // Apply pending migrations in order
    for migration in MIGRATIONS {
        if applied.contains(migration.version) {
            continue;
        }

        info!(version = migration.version, "Applying migration");

        // Execute migration SQL
        if let Err(e) = conn.execute_batch(migration.sql) {
            let err_str = e.to_string();
            // Handle expected failures gracefully:
            // 1. ALTER TABLE with duplicate column (base schema already has columns)
            // 2. vec0 module not found (sqlite-vec not available in Rust)
            if err_str.contains("duplicate column name") {
                warn!(
                    version = migration.version,
                    "Migration partially applied (columns exist), marking complete"
                );
            } else if err_str.contains("no such module: vec0") {
                warn!(
                    version = migration.version,
                    "Skipping sqlite-vec virtual table (not available in Rust CLI)"
                );
            } else {
                return Err(e);
            }
        }

        // Record migration as applied
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![migration.version, chrono::Utc::now().timestamp_millis()],
        )?;

        info!(version = migration.version, "Migration complete");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::schema::SCHEMA_SQL;

    /// Apply base schema before running migrations (mirrors production flow)
    fn setup_db(conn: &Connection) {
        conn.execute_batch(SCHEMA_SQL).expect("Base schema should apply");
    }

    #[test]
    fn test_migrations_compile() {
        // This test verifies that all include_str! paths are valid
        // If any path is wrong, compilation will fail
        assert!(!MIGRATIONS.is_empty());
        assert_eq!(MIGRATIONS.len(), 12);
    }

    #[test]
    fn test_run_migrations_fresh_db() {
        let conn = Connection::open_in_memory().unwrap();
        setup_db(&conn);
        run_migrations(&conn).expect("Migrations should apply to fresh database");

        // Verify all migrations are recorded
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 12);
    }

    #[test]
    fn test_run_migrations_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        setup_db(&conn);

        // Run twice - should not fail
        run_migrations(&conn).expect("First run should succeed");
        run_migrations(&conn).expect("Second run should succeed (idempotent)");

        // Still only 12 migrations recorded
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 12);
    }
}
