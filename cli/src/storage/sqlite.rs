//! SQLite storage implementation.
//!
//! This module provides the main storage backend for SaveContext using SQLite.
//! It follows the MutationContext pattern for transaction discipline and audit logging.

use crate::error::{Error, Result};
use crate::model::{Plan, PlanStatus, Project};
use crate::storage::events::{insert_event, Event, EventType};
use crate::storage::schema::apply_schema;
use rusqlite::{Connection, OptionalExtension, Transaction};
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

/// SQLite-based storage backend.
#[derive(Debug)]
pub struct SqliteStorage {
    conn: Connection,
}

/// Context for a mutation operation, tracking side effects.
///
/// This struct is passed to mutation closures to:
/// - Track which entities were modified (dirty tracking for sync)
/// - Record audit events for history
/// - Manage transaction state
pub struct MutationContext {
    /// Name of the operation being performed.
    pub op_name: String,
    /// Actor performing the operation (agent ID, user, etc.).
    pub actor: String,
    /// Events to write at the end of the transaction.
    pub events: Vec<Event>,
    /// IDs of entities marked dirty for sync export.
    pub dirty_sessions: HashSet<String>,
    pub dirty_issues: HashSet<String>,
    pub dirty_items: HashSet<String>,
    pub dirty_plans: HashSet<String>,
}

impl MutationContext {
    /// Create a new mutation context.
    #[must_use]
    pub fn new(op_name: &str, actor: &str) -> Self {
        Self {
            op_name: op_name.to_string(),
            actor: actor.to_string(),
            events: Vec::new(),
            dirty_sessions: HashSet::new(),
            dirty_issues: HashSet::new(),
            dirty_items: HashSet::new(),
            dirty_plans: HashSet::new(),
        }
    }

    /// Record an event for this operation.
    pub fn record_event(
        &mut self,
        entity_type: &str,
        entity_id: &str,
        event_type: EventType,
    ) {
        self.events.push(Event::new(
            entity_type,
            entity_id,
            event_type,
            &self.actor,
        ));
    }

    /// Record an event with old/new values for field tracking.
    pub fn record_change(
        &mut self,
        entity_type: &str,
        entity_id: &str,
        event_type: EventType,
        old_value: Option<String>,
        new_value: Option<String>,
    ) {
        self.events.push(
            Event::new(entity_type, entity_id, event_type, &self.actor)
                .with_values(old_value, new_value),
        );
    }

    /// Mark a session as dirty for sync export.
    pub fn mark_session_dirty(&mut self, session_id: &str) {
        self.dirty_sessions.insert(session_id.to_string());
    }

    /// Mark an issue as dirty for sync export.
    pub fn mark_issue_dirty(&mut self, issue_id: &str) {
        self.dirty_issues.insert(issue_id.to_string());
    }

    /// Mark a context item as dirty for sync export.
    pub fn mark_item_dirty(&mut self, item_id: &str) {
        self.dirty_items.insert(item_id.to_string());
    }

    /// Mark a plan as dirty for sync export.
    pub fn mark_plan_dirty(&mut self, plan_id: &str) {
        self.dirty_plans.insert(plan_id.to_string());
    }
}

/// Statistics from backfilling dirty records for a project.
///
/// Returned by `backfill_dirty_for_project` to indicate how many records
/// were marked dirty for sync export.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct BackfillStats {
    /// Number of sessions marked dirty.
    pub sessions: usize,
    /// Number of issues marked dirty.
    pub issues: usize,
    /// Number of context items marked dirty.
    pub context_items: usize,
    /// Number of plans marked dirty.
    pub plans: usize,
}

impl BackfillStats {
    /// Returns true if any records were marked dirty.
    #[must_use]
    pub fn any(&self) -> bool {
        self.sessions > 0 || self.issues > 0 || self.context_items > 0 || self.plans > 0
    }

    /// Returns total number of records marked dirty.
    #[must_use]
    pub fn total(&self) -> usize {
        self.sessions + self.issues + self.context_items + self.plans
    }
}

/// Counts of records for a project.
///
/// Used by `get_project_counts` to return summary statistics about
/// a project's data.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProjectCounts {
    /// Number of sessions.
    pub sessions: usize,
    /// Number of issues.
    pub issues: usize,
    /// Number of context items.
    pub context_items: usize,
    /// Number of memories.
    pub memories: usize,
    /// Number of checkpoints.
    pub checkpoints: usize,
}

impl ProjectCounts {
    /// Returns total number of records.
    #[must_use]
    pub fn total(&self) -> usize {
        self.sessions + self.issues + self.context_items + self.memories + self.checkpoints
    }
}

impl SqliteStorage {
    /// Open a database at the given path.
    ///
    /// Creates the database and applies schema if it doesn't exist.
    ///
    /// # Errors
    ///
    /// Returns an error if the connection cannot be established or schema fails.
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_with_timeout(path, None)
    }

    /// Open a database with an optional busy timeout.
    ///
    /// # Errors
    ///
    /// Returns an error if the connection cannot be established or schema fails.
    pub fn open_with_timeout(path: &Path, timeout_ms: Option<u64>) -> Result<Self> {
        let conn = Connection::open(path)?;

        if let Some(timeout) = timeout_ms {
            conn.busy_timeout(Duration::from_millis(timeout))?;
        } else {
            // Default 5 second timeout
            conn.busy_timeout(Duration::from_secs(5))?;
        }

        apply_schema(&conn)?;
        Ok(Self { conn })
    }

    /// Open an in-memory database (for testing).
    ///
    /// # Errors
    ///
    /// Returns an error if the connection cannot be established.
    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        apply_schema(&conn)?;
        Ok(Self { conn })
    }

    /// Get a reference to the underlying connection (for read operations).
    #[must_use]
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Execute a mutation with the transaction protocol.
    ///
    /// This method:
    /// 1. Begins an IMMEDIATE transaction (for write locking)
    /// 2. Executes the mutation closure
    /// 3. Writes audit events
    /// 4. Updates dirty tracking tables
    /// 5. Commits (or rolls back on error)
    ///
    /// # Errors
    ///
    /// Returns an error if any step fails. The transaction is rolled back on error.
    pub fn mutate<F, R>(&mut self, op: &str, actor: &str, f: F) -> Result<R>
    where
        F: FnOnce(&Transaction, &mut MutationContext) -> Result<R>,
    {
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

        let mut ctx = MutationContext::new(op, actor);

        // Execute the mutation
        let result = f(&tx, &mut ctx)?;

        // Write audit events
        for event in &ctx.events {
            insert_event(&tx, event)?;
        }

        // Dirty tracking is handled by triggers in schema.sql
        // But we can explicitly mark items here if triggers miss something

        // Commit
        tx.commit()?;

        Ok(result)
    }

    // ==================
    // Session Operations
    // ==================

    /// Create a new session.
    ///
    /// # Errors
    ///
    /// Returns an error if the insert fails.
    pub fn create_session(
        &mut self,
        id: &str,
        name: &str,
        description: Option<&str>,
        project_path: Option<&str>,
        branch: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("create_session", actor, |tx, ctx| {
            tx.execute(
                "INSERT INTO sessions (id, name, description, project_path, branch, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)",
                rusqlite::params![id, name, description, project_path, branch, now],
            )?;

            // Also insert into session_projects junction table for project-based filtering
            if let Some(path) = project_path {
                tx.execute(
                    "INSERT INTO session_projects (session_id, project_path, added_at) VALUES (?1, ?2, ?3)",
                    rusqlite::params![id, path, now],
                )?;
            }

            ctx.record_event("session", id, EventType::SessionCreated);
            ctx.mark_session_dirty(id);

            Ok(())
        })
    }

    /// Get a session by ID.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_session(&self, id: &str) -> Result<Option<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, branch, channel, project_path, status, ended_at, created_at, updated_at
             FROM sessions WHERE id = ?1",
        )?;

        let session = stmt
            .query_row([id], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    branch: row.get(3)?,
                    channel: row.get(4)?,
                    project_path: row.get(5)?,
                    status: row.get(6)?,
                    ended_at: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .optional()?;

        Ok(session)
    }

    /// List sessions with optional filters.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn list_sessions(
        &self,
        project_path: Option<&str>,
        status: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<Session>> {
        self.list_sessions_with_search(project_path, status, limit, None)
    }

    /// List sessions with optional filters and search.
    ///
    /// Uses the `session_projects` junction table for project path filtering,
    /// matching the MCP server's `listSessionsByPaths` behavior.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn list_sessions_with_search(
        &self,
        project_path: Option<&str>,
        status: Option<&str>,
        limit: Option<u32>,
        search: Option<&str>,
    ) -> Result<Vec<Session>> {
        let limit = limit.unwrap_or(50);

        // Build dynamic SQL query using junction table for project filtering
        let mut conditions: Vec<String> = Vec::new();
        let mut params: Vec<String> = Vec::new();
        let mut param_idx = 1;

        // Determine if we need to join with session_projects
        let (from_clause, select_distinct) = if let Some(path) = project_path {
            // Join with session_projects to find sessions associated with this project
            conditions.push(format!("sp.project_path = ?{param_idx}"));
            params.push(path.to_string());
            param_idx += 1;
            (
                "sessions s JOIN session_projects sp ON s.id = sp.session_id".to_string(),
                "DISTINCT ",
            )
        } else {
            // No project filter - query sessions directly
            ("sessions s".to_string(), "")
        };

        if let Some(st) = status {
            conditions.push(format!("s.status = ?{param_idx}"));
            params.push(st.to_string());
            param_idx += 1;
        }

        if let Some(search_term) = search {
            // Case-insensitive search matching MCP server behavior
            conditions.push(format!(
                "(s.name LIKE ?{param_idx} COLLATE NOCASE OR s.description LIKE ?{param_idx} COLLATE NOCASE)"
            ));
            params.push(format!("%{search_term}%"));
            param_idx += 1;
        }

        let where_clause = if conditions.is_empty() {
            " WHERE 1=1".to_string()
        } else {
            format!(" WHERE {}", conditions.join(" AND "))
        };

        let sql = format!(
            "SELECT {select_distinct}s.id, s.name, s.description, s.branch, s.channel, s.project_path, s.status, s.ended_at, s.created_at, s.updated_at
             FROM {from_clause}{where_clause}
             ORDER BY s.updated_at DESC LIMIT ?{param_idx}"
        );
        params.push(limit.to_string());

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = params
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();

        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                branch: row.get(3)?,
                channel: row.get(4)?,
                project_path: row.get(5)?,
                status: row.get(6)?,
                ended_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Update session status.
    ///
    /// # Errors
    ///
    /// Returns an error if the update fails or session not found.
    pub fn update_session_status(
        &mut self,
        id: &str,
        status: &str,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let ended_at = if status == "completed" || status == "paused" {
            Some(now)
        } else {
            None
        };

        self.mutate("update_session_status", actor, |tx, ctx| {
            let rows = tx.execute(
                "UPDATE sessions SET status = ?1, ended_at = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![status, ended_at, now, id],
            )?;

            if rows == 0 {
                return Err(Error::SessionNotFound { id: id.to_string() });
            }

            let event_type = match status {
                "paused" => EventType::SessionPaused,
                "completed" => EventType::SessionCompleted,
                _ => EventType::SessionUpdated,
            };
            ctx.record_event("session", id, event_type);
            ctx.mark_session_dirty(id);

            Ok(())
        })
    }

    /// Rename a session.
    ///
    /// # Errors
    ///
    /// Returns an error if the update fails or session not found.
    pub fn rename_session(
        &mut self,
        id: &str,
        new_name: &str,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("rename_session", actor, |tx, ctx| {
            let rows = tx.execute(
                "UPDATE sessions SET name = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![new_name, now, id],
            )?;

            if rows == 0 {
                return Err(Error::SessionNotFound { id: id.to_string() });
            }

            ctx.record_event("session", id, EventType::SessionUpdated);
            ctx.mark_session_dirty(id);

            Ok(())
        })
    }

    /// Delete a session and all related data.
    ///
    /// This cascades to delete:
    /// - Context items in the session
    /// - Checkpoints for the session
    /// - Session project paths
    ///
    /// # Errors
    ///
    /// Returns an error if the session doesn't exist or can't be deleted.
    pub fn delete_session(&mut self, id: &str, actor: &str) -> Result<()> {
        self.mutate("delete_session", actor, |tx, ctx| {
            // Verify session exists
            let exists: bool = tx
                .query_row(
                    "SELECT 1 FROM sessions WHERE id = ?1",
                    [id],
                    |_| Ok(true),
                )
                .unwrap_or(false);

            if !exists {
                return Err(Error::SessionNotFound { id: id.to_string() });
            }

            // Delete context items for this session
            tx.execute(
                "DELETE FROM context_items WHERE session_id = ?1",
                [id],
            )?;

            // Delete checkpoints for this session
            tx.execute(
                "DELETE FROM checkpoints WHERE session_id = ?1",
                [id],
            )?;

            // Delete session paths
            tx.execute(
                "DELETE FROM session_projects WHERE session_id = ?1",
                [id],
            )?;

            // Delete the session itself
            tx.execute("DELETE FROM sessions WHERE id = ?1", [id])?;

            ctx.record_event("session", id, EventType::SessionDeleted);

            Ok(())
        })
    }

    /// Add a project path to a session (for multi-project sessions).
    ///
    /// # Errors
    ///
    /// Returns an error if the session doesn't exist or the path is already added.
    pub fn add_session_path(
        &mut self,
        session_id: &str,
        project_path: &str,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("add_session_path", actor, |tx, ctx| {
            // Verify session exists
            let exists: bool = tx
                .query_row(
                    "SELECT 1 FROM sessions WHERE id = ?1",
                    [session_id],
                    |_| Ok(true),
                )
                .unwrap_or(false);

            if !exists {
                return Err(Error::SessionNotFound { id: session_id.to_string() });
            }

            // Insert the path (will fail if already exists due to PRIMARY KEY constraint)
            let result = tx.execute(
                "INSERT INTO session_projects (session_id, project_path, added_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![session_id, project_path, now],
            );

            match result {
                Ok(_) => {
                    ctx.record_event("session", session_id, EventType::SessionPathAdded);
                    ctx.mark_session_dirty(session_id);
                    Ok(())
                }
                Err(rusqlite::Error::SqliteFailure(err, _))
                    if err.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    Err(Error::Other(format!(
                        "Path already added to session: {project_path}"
                    )))
                }
                Err(e) => Err(e.into()),
            }
        })
    }

    /// Remove a project path from a session.
    ///
    /// Cannot remove the last path (sessions must have at least the primary path).
    ///
    /// # Errors
    ///
    /// Returns an error if the session doesn't exist or this is the last path.
    pub fn remove_session_path(
        &mut self,
        session_id: &str,
        project_path: &str,
        actor: &str,
    ) -> Result<()> {
        self.mutate("remove_session_path", actor, |tx, ctx| {
            // Verify session exists
            let session_path: Option<String> = tx
                .query_row(
                    "SELECT project_path FROM sessions WHERE id = ?1",
                    [session_id],
                    |row| row.get(0),
                )
                .optional()?;

            let primary_path = session_path.ok_or_else(|| Error::SessionNotFound {
                id: session_id.to_string(),
            })?;

            // Cannot remove the primary project path from sessions table
            if primary_path == project_path {
                return Err(Error::Other(
                    "Cannot remove primary project path. Use delete_session instead.".to_string(),
                ));
            }

            // Delete from session_projects
            let rows = tx.execute(
                "DELETE FROM session_projects WHERE session_id = ?1 AND project_path = ?2",
                rusqlite::params![session_id, project_path],
            )?;

            if rows == 0 {
                return Err(Error::Other(format!(
                    "Path not found in session: {project_path}"
                )));
            }

            ctx.record_event("session", session_id, EventType::SessionPathRemoved);
            ctx.mark_session_dirty(session_id);

            Ok(())
        })
    }

    /// Get all project paths for a session.
    ///
    /// Returns the primary path from the session plus any additional paths from session_projects.
    pub fn get_session_paths(&self, session_id: &str) -> Result<Vec<String>> {
        let conn = self.conn();

        // Get primary path from session
        let primary_path: Option<String> = conn
            .query_row(
                "SELECT project_path FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .optional()?;

        let Some(primary) = primary_path else {
            return Err(Error::SessionNotFound { id: session_id.to_string() });
        };

        // Get additional paths
        let mut stmt = conn.prepare(
            "SELECT project_path FROM session_projects WHERE session_id = ?1 ORDER BY added_at",
        )?;

        let additional_paths: Vec<String> = stmt
            .query_map([session_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        // Combine: primary path first, then additional
        let mut paths = vec![primary];
        paths.extend(additional_paths);

        Ok(paths)
    }

    // =======================
    // Context Item Operations
    // =======================

    /// Save a context item (upsert).
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn save_context_item(
        &mut self,
        id: &str,
        session_id: &str,
        key: &str,
        value: &str,
        category: Option<&str>,
        priority: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let category = category.unwrap_or("note");
        let priority = priority.unwrap_or("normal");
        let size = value.len() as i64;

        self.mutate("save_context_item", actor, |tx, ctx| {
            // Check if exists for event type
            let exists: bool = tx
                .prepare("SELECT 1 FROM context_items WHERE session_id = ?1 AND key = ?2")?
                .exists(rusqlite::params![session_id, key])?;

            tx.execute(
                "INSERT INTO context_items (id, session_id, key, value, category, priority, size, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
                 ON CONFLICT(session_id, key) DO UPDATE SET
                   value = excluded.value,
                   category = excluded.category,
                   priority = excluded.priority,
                   size = excluded.size,
                   updated_at = excluded.updated_at",
                rusqlite::params![id, session_id, key, value, category, priority, size, now],
            )?;

            let event_type = if exists {
                EventType::ItemUpdated
            } else {
                EventType::ItemCreated
            };
            ctx.record_event("context_item", id, event_type);
            ctx.mark_item_dirty(id);

            Ok(())
        })
    }

    /// Look up the actual item ID by session + key.
    ///
    /// Needed after upserts where ON CONFLICT keeps the original ID.
    pub fn get_item_id_by_key(&self, session_id: &str, key: &str) -> Result<Option<String>> {
        let id = self.conn.query_row(
            "SELECT id FROM context_items WHERE session_id = ?1 AND key = ?2",
            rusqlite::params![session_id, key],
            |row| row.get(0),
        ).optional()?;
        Ok(id)
    }

    /// Get all context items for a session with their fast-tier embeddings (if any).
    ///
    /// Single LEFT JOIN query — items without embeddings get `None`.
    /// Only fetches chunk_index=0 (the primary embedding per item).
    pub fn get_items_with_fast_embeddings(
        &self,
        session_id: &str,
    ) -> Result<Vec<(ContextItem, Option<Vec<f32>>)>> {
        let sql = "SELECT ci.id, ci.session_id, ci.key, ci.value, ci.category, ci.priority,
                          ci.channel, ci.tags, ci.size, ci.created_at, ci.updated_at,
                          ec.embedding
                   FROM context_items ci
                   LEFT JOIN embedding_chunks_fast ec ON ec.item_id = ci.id AND ec.chunk_index = 0
                   WHERE ci.session_id = ?1
                   ORDER BY ci.updated_at DESC";

        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params![session_id], |row| {
            let item = ContextItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                channel: row.get(6)?,
                tags: row.get(7)?,
                size: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            };

            let embedding: Option<Vec<f32>> = row.get::<_, Option<Vec<u8>>>(11)?
                .map(|blob| {
                    blob.chunks_exact(4)
                        .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                        .collect()
                });

            Ok((item, embedding))
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Get context items for a session.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_context_items(
        &self,
        session_id: &str,
        category: Option<&str>,
        priority: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<ContextItem>> {
        let limit = limit.unwrap_or(100);

        let mut sql = String::from(
            "SELECT id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at
             FROM context_items WHERE session_id = ?1",
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(session_id.to_string())];

        if let Some(cat) = category {
            sql.push_str(" AND category = ?");
            params.push(Box::new(cat.to_string()));
        }

        if let Some(pri) = priority {
            sql.push_str(" AND priority = ?");
            params.push(Box::new(pri.to_string()));
        }

        sql.push_str(" ORDER BY created_at DESC LIMIT ?");
        params.push(Box::new(limit));

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = params
            .iter()
            .map(|b| b.as_ref())
            .collect();

        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(ContextItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                channel: row.get(6)?,
                tags: row.get(7)?,
                size: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Delete a context item.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn delete_context_item(
        &mut self,
        session_id: &str,
        key: &str,
        actor: &str,
    ) -> Result<()> {
        self.mutate("delete_context_item", actor, |tx, ctx| {
            // Get ID and project_path for tracking
            let info: Option<(String, Option<String>)> = tx
                .query_row(
                    "SELECT ci.id, s.project_path
                     FROM context_items ci
                     JOIN sessions s ON ci.session_id = s.id
                     WHERE ci.session_id = ?1 AND ci.key = ?2",
                    rusqlite::params![session_id, key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;

            let rows = tx.execute(
                "DELETE FROM context_items WHERE session_id = ?1 AND key = ?2",
                rusqlite::params![session_id, key],
            )?;

            if rows > 0 {
                if let Some((item_id, project_path)) = info {
                    ctx.record_event("context_item", &item_id, EventType::ItemDeleted);

                    // Record for sync export
                    if let Some(ref path) = project_path {
                        let now = chrono::Utc::now().timestamp_millis();
                        tx.execute(
                            "INSERT INTO sync_deletions (entity_type, entity_id, project_path, deleted_at, deleted_by, exported)
                             VALUES ('context_item', ?1, ?2, ?3, ?4, 0)
                             ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                               deleted_at = excluded.deleted_at,
                               deleted_by = excluded.deleted_by,
                               exported = 0",
                            rusqlite::params![item_id, path, now, ctx.actor],
                        )?;
                    }
                }
            }

            Ok(())
        })
    }

    /// Update a context item's value, category, priority, or channel.
    ///
    /// # Errors
    ///
    /// Returns an error if the update fails.
    pub fn update_context_item(
        &mut self,
        session_id: &str,
        key: &str,
        value: Option<&str>,
        category: Option<&str>,
        priority: Option<&str>,
        channel: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        self.mutate("update_context_item", actor, |tx, ctx| {
            let now = chrono::Utc::now().timestamp_millis();

            // Build dynamic UPDATE query - collect field names and params separately
            let mut set_parts: Vec<&str> = vec!["updated_at"];
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];

            if let Some(v) = value {
                set_parts.push("value");
                set_parts.push("size");
                params.push(Box::new(v.to_string()));
                params.push(Box::new(v.len() as i64));
            }
            if let Some(c) = category {
                set_parts.push("category");
                params.push(Box::new(c.to_string()));
            }
            if let Some(p) = priority {
                set_parts.push("priority");
                params.push(Box::new(p.to_string()));
            }
            if let Some(ch) = channel {
                set_parts.push("channel");
                params.push(Box::new(ch.to_string()));
            }

            // Get item ID for event tracking
            let item_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM context_items WHERE session_id = ?1 AND key = ?2",
                    rusqlite::params![session_id, key],
                    |row| row.get(0),
                )
                .optional()?;

            if item_id.is_none() {
                return Err(Error::Database(rusqlite::Error::QueryReturnedNoRows));
            }

            // Build SET clause with numbered placeholders
            let set_clause: String = set_parts
                .iter()
                .enumerate()
                .map(|(i, field)| format!("{} = ?{}", field, i + 1))
                .collect::<Vec<_>>()
                .join(", ");

            let param_count = params.len();
            let query = format!(
                "UPDATE context_items SET {} WHERE session_id = ?{} AND key = ?{}",
                set_clause,
                param_count + 1,
                param_count + 2
            );

            params.push(Box::new(session_id.to_string()));
            params.push(Box::new(key.to_string()));

            let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            tx.execute(&query, param_refs.as_slice())?;

            if let Some(id) = item_id {
                ctx.record_event("context_item", &id, EventType::ItemUpdated);
            }

            Ok(())
        })
    }

    /// Add tags to a context item.
    ///
    /// # Errors
    ///
    /// Returns an error if the update fails.
    pub fn add_tags_to_item(
        &mut self,
        session_id: &str,
        key: &str,
        tags_to_add: &[String],
        actor: &str,
    ) -> Result<()> {
        self.mutate("add_tags_to_item", actor, |tx, ctx| {
            let now = chrono::Utc::now().timestamp_millis();

            // Get current tags
            let (item_id, current_tags): (String, String) = tx.query_row(
                "SELECT id, tags FROM context_items WHERE session_id = ?1 AND key = ?2",
                rusqlite::params![session_id, key],
                |row| Ok((row.get(0)?, row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "[]".to_string()))),
            )?;

            // Parse current tags
            let mut tags: Vec<String> = serde_json::from_str(&current_tags).unwrap_or_default();

            // Add new tags (avoiding duplicates)
            for tag in tags_to_add {
                if !tags.contains(tag) {
                    tags.push(tag.clone());
                }
            }

            // Update
            let new_tags = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                "UPDATE context_items SET tags = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![new_tags, now, item_id],
            )?;

            ctx.record_event("context_item", &item_id, EventType::ItemUpdated);

            Ok(())
        })
    }

    /// Remove tags from a context item.
    ///
    /// # Errors
    ///
    /// Returns an error if the update fails.
    pub fn remove_tags_from_item(
        &mut self,
        session_id: &str,
        key: &str,
        tags_to_remove: &[String],
        actor: &str,
    ) -> Result<()> {
        self.mutate("remove_tags_from_item", actor, |tx, ctx| {
            let now = chrono::Utc::now().timestamp_millis();

            // Get current tags
            let (item_id, current_tags): (String, String) = tx.query_row(
                "SELECT id, tags FROM context_items WHERE session_id = ?1 AND key = ?2",
                rusqlite::params![session_id, key],
                |row| Ok((row.get(0)?, row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "[]".to_string()))),
            )?;

            // Parse current tags
            let mut tags: Vec<String> = serde_json::from_str(&current_tags).unwrap_or_default();

            // Remove specified tags
            tags.retain(|t| !tags_to_remove.contains(t));

            // Update
            let new_tags = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                "UPDATE context_items SET tags = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![new_tags, now, item_id],
            )?;

            ctx.record_event("context_item", &item_id, EventType::ItemUpdated);

            Ok(())
        })
    }

    // ================
    // Issue Operations
    // ================

    /// Create a new issue.
    ///
    /// # Errors
    ///
    /// Returns an error if the insert fails.
    #[allow(clippy::too_many_arguments)]
    pub fn create_issue(
        &mut self,
        id: &str,
        short_id: Option<&str>,
        project_path: &str,
        title: &str,
        description: Option<&str>,
        details: Option<&str>,
        issue_type: Option<&str>,
        priority: Option<i32>,
        plan_id: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let issue_type = issue_type.unwrap_or("task");
        let priority = priority.unwrap_or(2);

        self.mutate("create_issue", actor, |tx, ctx| {
            tx.execute(
                "INSERT INTO issues (id, short_id, project_path, title, description, details, issue_type, priority, plan_id, status, created_by_agent, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10, ?11, ?11)",
                rusqlite::params![id, short_id, project_path, title, description, details, issue_type, priority, plan_id, actor, now],
            )?;

            ctx.record_event("issue", id, EventType::IssueCreated);
            ctx.mark_issue_dirty(id);

            Ok(())
        })
    }

    /// Get an issue by ID (full ID or short ID).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_issue(&self, id: &str, project_path: Option<&str>) -> Result<Option<Issue>> {
        // Try full ID first, then short ID
        let sql = if project_path.is_some() {
            "SELECT id, short_id, project_path, title, description, details, status, priority, issue_type, plan_id, created_by_agent, assigned_to_agent, created_at, updated_at, closed_at
             FROM issues WHERE (id = ?1 OR short_id = ?1) AND project_path = ?2"
        } else {
            "SELECT id, short_id, project_path, title, description, details, status, priority, issue_type, plan_id, created_by_agent, assigned_to_agent, created_at, updated_at, closed_at
             FROM issues WHERE id = ?1 OR short_id = ?1"
        };

        let mut stmt = self.conn.prepare(sql)?;

        let issue = if let Some(path) = project_path {
            stmt.query_row(rusqlite::params![id, path], map_issue_row)
        } else {
            stmt.query_row([id], map_issue_row)
        }
        .optional()?;

        Ok(issue)
    }

    /// List issues with filters.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn list_issues(
        &self,
        project_path: &str,
        status: Option<&str>,
        issue_type: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<Issue>> {
        let limit = limit.unwrap_or(50);

        let mut sql = String::from(
            "SELECT id, short_id, project_path, title, description, details, status, priority, issue_type, plan_id, created_by_agent, assigned_to_agent, created_at, updated_at, closed_at
             FROM issues WHERE project_path = ?1",
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(project_path.to_string())];

        if let Some(st) = status {
            if st != "all" {
                sql.push_str(" AND status = ?");
                params.push(Box::new(st.to_string()));
            }
        } else {
            // Default: exclude closed
            sql.push_str(" AND status != 'closed'");
        }

        if let Some(t) = issue_type {
            sql.push_str(" AND issue_type = ?");
            params.push(Box::new(t.to_string()));
        }

        sql.push_str(" ORDER BY priority DESC, created_at ASC LIMIT ?");
        params.push(Box::new(limit));

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = params
            .iter()
            .map(|b| b.as_ref())
            .collect();

        let rows = stmt.query_map(params_refs.as_slice(), map_issue_row)?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// List issues across all projects.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn list_all_issues(
        &self,
        status: Option<&str>,
        issue_type: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<Issue>> {
        let limit = limit.unwrap_or(50);

        let mut sql = String::from(
            "SELECT id, short_id, project_path, title, description, details, status, priority, issue_type, plan_id, created_by_agent, assigned_to_agent, created_at, updated_at, closed_at
             FROM issues WHERE 1=1",
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];

        if let Some(st) = status {
            if st != "all" {
                sql.push_str(" AND status = ?");
                params.push(Box::new(st.to_string()));
            }
        } else {
            // Default: exclude closed
            sql.push_str(" AND status != 'closed'");
        }

        if let Some(t) = issue_type {
            sql.push_str(" AND issue_type = ?");
            params.push(Box::new(t.to_string()));
        }

        sql.push_str(" ORDER BY priority DESC, created_at ASC LIMIT ?");
        params.push(Box::new(limit));

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();

        let rows = stmt.query_map(params_refs.as_slice(), map_issue_row)?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Update issue status.
    ///
    /// Accepts either full ID or short_id.
    ///
    /// # Errors
    ///
    /// Returns an error if the update fails.
    pub fn update_issue_status(
        &mut self,
        id: &str,
        status: &str,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let closed_at = if status == "closed" { Some(now) } else { None };

        self.mutate("update_issue_status", actor, |tx, ctx| {
            let rows = tx.execute(
                "UPDATE issues SET status = ?1, closed_at = ?2, closed_by_agent = ?3, updated_at = ?4 WHERE id = ?5 OR short_id = ?5",
                rusqlite::params![status, closed_at, if status == "closed" { Some(actor) } else { None }, now, id],
            )?;

            if rows == 0 {
                return Err(Error::IssueNotFound { id: id.to_string() });
            }

            let event_type = if status == "closed" {
                EventType::IssueClosed
            } else {
                EventType::IssueUpdated
            };
            ctx.record_event("issue", id, event_type);
            ctx.mark_issue_dirty(id);

            Ok(())
        })
    }

    /// Update issue fields (title, description, details, priority, issue_type).
    ///
    /// Only updates fields that are Some. Status is handled separately.
    ///
    /// # Errors
    ///
    /// Returns an error if the update fails.
    #[allow(clippy::too_many_arguments)]
    pub fn update_issue(
        &mut self,
        id: &str,
        title: Option<&str>,
        description: Option<&str>,
        details: Option<&str>,
        priority: Option<i32>,
        issue_type: Option<&str>,
        plan_id: Option<&str>,
        parent_id: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();

        // Build dynamic UPDATE query based on provided fields
        let mut set_clauses = vec!["updated_at = ?"];
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];

        if let Some(t) = title {
            set_clauses.push("title = ?");
            params.push(Box::new(t.to_string()));
        }
        if let Some(d) = description {
            set_clauses.push("description = ?");
            params.push(Box::new(d.to_string()));
        }
        if let Some(dt) = details {
            set_clauses.push("details = ?");
            params.push(Box::new(dt.to_string()));
        }
        if let Some(p) = priority {
            set_clauses.push("priority = ?");
            params.push(Box::new(p));
        }
        if let Some(it) = issue_type {
            set_clauses.push("issue_type = ?");
            params.push(Box::new(it.to_string()));
        }
        if let Some(pid) = plan_id {
            set_clauses.push("plan_id = ?");
            params.push(Box::new(pid.to_string()));
        }

        // Only updated_at - no actual changes
        if set_clauses.len() == 1 && parent_id.is_none() {
            return Ok(());
        }

        self.mutate("update_issue", actor, |tx, ctx| {
            // Update the issue fields
            if set_clauses.len() > 1 {
                let sql = format!(
                    "UPDATE issues SET {} WHERE id = ? OR short_id = ?",
                    set_clauses.join(", ")
                );
                params.push(Box::new(id.to_string()));
                params.push(Box::new(id.to_string()));

                let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
                let rows = tx.execute(&sql, param_refs.as_slice())?;

                if rows == 0 {
                    return Err(Error::IssueNotFound { id: id.to_string() });
                }
            }

            // Handle parent_id change via dependency
            if let Some(new_parent) = parent_id {
                // First, get the full ID
                let full_id: String = tx.query_row(
                    "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                    [id],
                    |row| row.get(0),
                )?;

                // Remove existing parent-child dependency
                tx.execute(
                    "DELETE FROM issue_dependencies WHERE issue_id = ?1 AND dependency_type = 'parent-child'",
                    [&full_id],
                )?;

                // Add new parent-child dependency if not empty
                if !new_parent.is_empty() {
                    let parent_full_id: String = tx.query_row(
                        "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                        [new_parent],
                        |row| row.get(0),
                    )?;

                    tx.execute(
                        "INSERT INTO issue_dependencies (issue_id, depends_on_id, dependency_type, created_at)
                         VALUES (?1, ?2, 'parent-child', ?3)",
                        rusqlite::params![full_id, parent_full_id, now],
                    )?;
                }
            }

            ctx.record_event("issue", id, EventType::IssueUpdated);
            ctx.mark_issue_dirty(id);

            Ok(())
        })
    }

    /// Claim an issue (assign to agent).
    ///
    /// Accepts either full ID or short_id.
    ///
    /// # Errors
    ///
    /// Returns an error if the claim fails.
    pub fn claim_issue(&mut self, id: &str, actor: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("claim_issue", actor, |tx, ctx| {
            let rows = tx.execute(
                "UPDATE issues SET assigned_to_agent = ?1, assigned_at = ?2, status = 'in_progress', updated_at = ?2 WHERE id = ?3 OR short_id = ?3",
                rusqlite::params![actor, now, id],
            )?;

            if rows == 0 {
                return Err(Error::IssueNotFound { id: id.to_string() });
            }

            ctx.record_event("issue", id, EventType::IssueClaimed);
            ctx.mark_issue_dirty(id);

            Ok(())
        })
    }

    /// Release an issue (unassign).
    ///
    /// Accepts either full ID or short_id.
    ///
    /// # Errors
    ///
    /// Returns an error if the release fails.
    pub fn release_issue(&mut self, id: &str, actor: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("release_issue", actor, |tx, ctx| {
            let rows = tx.execute(
                "UPDATE issues SET assigned_to_agent = NULL, assigned_at = NULL, status = 'open', updated_at = ?1 WHERE id = ?2 OR short_id = ?2",
                rusqlite::params![now, id],
            )?;

            if rows == 0 {
                return Err(Error::IssueNotFound { id: id.to_string() });
            }

            ctx.record_event("issue", id, EventType::IssueReleased);
            ctx.mark_issue_dirty(id);

            Ok(())
        })
    }

    /// Delete an issue.
    ///
    /// Accepts either full ID or short_id.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn delete_issue(&mut self, id: &str, actor: &str) -> Result<()> {
        self.mutate("delete_issue", actor, |tx, ctx| {
            // First get the full issue ID and project_path
            let info: Option<(String, String)> = tx
                .query_row(
                    "SELECT id, project_path FROM issues WHERE id = ?1 OR short_id = ?1",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;

            let (full_id, project_path) =
                info.ok_or_else(|| Error::IssueNotFound { id: id.to_string() })?;

            // Delete dependencies using full ID
            tx.execute(
                "DELETE FROM issue_dependencies WHERE issue_id = ?1 OR depends_on_id = ?1",
                [&full_id],
            )?;

            // Delete the issue
            let rows = tx.execute("DELETE FROM issues WHERE id = ?1", [&full_id])?;

            if rows == 0 {
                return Err(Error::IssueNotFound { id: id.to_string() });
            }

            ctx.record_event("issue", &full_id, EventType::IssueDeleted);

            // Record for sync export
            let now = chrono::Utc::now().timestamp_millis();
            tx.execute(
                "INSERT INTO sync_deletions (entity_type, entity_id, project_path, deleted_at, deleted_by, exported)
                 VALUES ('issue', ?1, ?2, ?3, ?4, 0)
                 ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                   deleted_at = excluded.deleted_at,
                   deleted_by = excluded.deleted_by,
                   exported = 0",
                rusqlite::params![full_id, project_path, now, ctx.actor],
            )?;

            Ok(())
        })
    }

    /// Add labels to an issue.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn add_issue_labels(&mut self, id: &str, labels: &[String], actor: &str) -> Result<()> {
        self.mutate("add_issue_labels", actor, |tx, ctx| {
            // Get full issue ID
            let full_id: String = tx
                .query_row(
                    "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| Error::IssueNotFound { id: id.to_string() })?;

            for label in labels {
                let label_id = format!("label_{}", &uuid::Uuid::new_v4().to_string()[..12]);
                tx.execute(
                    "INSERT OR IGNORE INTO issue_labels (id, issue_id, label) VALUES (?1, ?2, ?3)",
                    rusqlite::params![label_id, full_id, label],
                )?;
            }

            ctx.record_event("issue", &full_id, EventType::IssueUpdated);
            Ok(())
        })
    }

    /// Remove labels from an issue.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn remove_issue_labels(&mut self, id: &str, labels: &[String], actor: &str) -> Result<()> {
        self.mutate("remove_issue_labels", actor, |tx, ctx| {
            // Get full issue ID
            let full_id: String = tx
                .query_row(
                    "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| Error::IssueNotFound { id: id.to_string() })?;

            for label in labels {
                tx.execute(
                    "DELETE FROM issue_labels WHERE issue_id = ?1 AND label = ?2",
                    rusqlite::params![full_id, label],
                )?;
            }

            ctx.record_event("issue", &full_id, EventType::IssueUpdated);
            Ok(())
        })
    }

    /// Get labels for an issue.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_issue_labels(&self, id: &str) -> Result<Vec<String>> {
        let full_id: String = self
            .conn
            .query_row(
                "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::IssueNotFound { id: id.to_string() })?;

        let mut stmt = self
            .conn
            .prepare("SELECT label FROM issue_labels WHERE issue_id = ?1 ORDER BY label")?;
        let labels = stmt
            .query_map([&full_id], |row| row.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(labels)
    }

    /// Check if an issue has any dependencies (depends on other issues).
    pub fn issue_has_dependencies(&self, id: &str) -> Result<bool> {
        let full_id: String = self
            .conn
            .query_row(
                "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::IssueNotFound { id: id.to_string() })?;

        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM issue_dependencies WHERE issue_id = ?1",
            [&full_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Check if an issue has any subtasks (child issues via parent-child dependency).
    pub fn issue_has_subtasks(&self, id: &str) -> Result<bool> {
        let full_id: String = self
            .conn
            .query_row(
                "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::IssueNotFound { id: id.to_string() })?;

        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM issue_dependencies WHERE depends_on_id = ?1 AND dependency_type = 'parent-child'",
            [&full_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get the set of issue IDs that are children of a specific parent.
    ///
    /// Returns IDs of issues that have a parent-child dependency on the given parent ID.
    pub fn get_child_issue_ids(&self, parent_id: &str) -> Result<std::collections::HashSet<String>> {
        // Resolve parent ID (handle short IDs)
        let full_parent_id: String = self
            .conn
            .query_row(
                "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                [parent_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::IssueNotFound { id: parent_id.to_string() })?;

        let mut stmt = self.conn.prepare(
            "SELECT issue_id FROM issue_dependencies
             WHERE depends_on_id = ?1 AND dependency_type = 'parent-child'",
        )?;

        let rows = stmt.query_map([&full_parent_id], |row| row.get::<_, String>(0))?;

        let mut ids = std::collections::HashSet::new();
        for row in rows {
            ids.insert(row?);
        }
        Ok(ids)
    }

    /// Add a dependency between issues.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn add_issue_dependency(
        &mut self,
        issue_id: &str,
        depends_on_id: &str,
        dependency_type: &str,
        actor: &str,
    ) -> Result<()> {
        self.mutate("add_issue_dependency", actor, |tx, ctx| {
            // Get full issue IDs
            let full_issue_id: String = tx
                .query_row(
                    "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                    [issue_id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| Error::IssueNotFound {
                    id: issue_id.to_string(),
                })?;

            let full_depends_on_id: String = tx
                .query_row(
                    "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                    [depends_on_id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| Error::IssueNotFound {
                    id: depends_on_id.to_string(),
                })?;

            let dep_id = format!("dep_{}", &uuid::Uuid::new_v4().to_string()[..12]);
            let now = chrono::Utc::now().timestamp_millis();

            tx.execute(
                "INSERT OR IGNORE INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![dep_id, full_issue_id, full_depends_on_id, dependency_type, now],
            )?;

            ctx.record_event("issue", &full_issue_id, EventType::IssueUpdated);
            Ok(())
        })
    }

    /// Remove a dependency between issues.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn remove_issue_dependency(
        &mut self,
        issue_id: &str,
        depends_on_id: &str,
        actor: &str,
    ) -> Result<()> {
        self.mutate("remove_issue_dependency", actor, |tx, ctx| {
            // Get full issue IDs
            let full_issue_id: String = tx
                .query_row(
                    "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                    [issue_id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| Error::IssueNotFound {
                    id: issue_id.to_string(),
                })?;

            let full_depends_on_id: String = tx
                .query_row(
                    "SELECT id FROM issues WHERE id = ?1 OR short_id = ?1",
                    [depends_on_id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| Error::IssueNotFound {
                    id: depends_on_id.to_string(),
                })?;

            tx.execute(
                "DELETE FROM issue_dependencies WHERE issue_id = ?1 AND depends_on_id = ?2",
                rusqlite::params![full_issue_id, full_depends_on_id],
            )?;

            ctx.record_event("issue", &full_issue_id, EventType::IssueUpdated);
            Ok(())
        })
    }

    /// Clone an issue.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn clone_issue(
        &mut self,
        id: &str,
        new_title: Option<&str>,
        actor: &str,
    ) -> Result<Issue> {
        // First get the source issue
        let source = self
            .get_issue(id, None)?
            .ok_or_else(|| Error::IssueNotFound { id: id.to_string() })?;

        let new_id = format!("issue_{}", &uuid::Uuid::new_v4().to_string()[..12]);
        let new_short_id = generate_short_id();
        let default_title = format!("Copy of {}", source.title);
        let title = new_title.unwrap_or(&default_title);
        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("clone_issue", actor, |tx, ctx| {
            tx.execute(
                "INSERT INTO issues (id, short_id, project_path, title, description, details, status, priority, issue_type, plan_id, created_by_agent, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7, ?8, ?9, ?10, ?11, ?11)",
                rusqlite::params![
                    new_id,
                    new_short_id,
                    source.project_path,
                    title,
                    source.description,
                    source.details,
                    source.priority,
                    source.issue_type,
                    source.plan_id,
                    ctx.actor,
                    now
                ],
            )?;

            // Copy labels
            let labels: Vec<String> = tx
                .prepare("SELECT label FROM issue_labels WHERE issue_id = ?1")?
                .query_map([&source.id], |row| row.get(0))?
                .collect::<std::result::Result<Vec<String>, _>>()?;

            for label in &labels {
                let label_id = format!("label_{}", &uuid::Uuid::new_v4().to_string()[..12]);
                tx.execute(
                    "INSERT INTO issue_labels (id, issue_id, label) VALUES (?1, ?2, ?3)",
                    rusqlite::params![label_id, new_id, label],
                )?;
            }

            ctx.record_event("issue", &new_id, EventType::IssueCreated);
            Ok(())
        })?;

        // Return the new issue
        self.get_issue(&new_id, None)?
            .ok_or_else(|| Error::Other("Failed to retrieve cloned issue".to_string()))
    }

    /// Mark an issue as a duplicate of another.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn mark_issue_duplicate(
        &mut self,
        id: &str,
        duplicate_of_id: &str,
        actor: &str,
    ) -> Result<()> {
        // Add duplicate-of dependency
        self.add_issue_dependency(id, duplicate_of_id, "duplicate-of", actor)?;

        // Close the issue
        self.update_issue_status(id, "closed", actor)?;

        Ok(())
    }

    /// Get issues that are ready to work on (open, no blocking dependencies, not assigned).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_ready_issues(&self, project_path: &str, limit: u32) -> Result<Vec<Issue>> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.short_id, i.project_path, i.title, i.description, i.details,
                    i.status, i.priority, i.issue_type, i.plan_id, i.created_by_agent,
                    i.assigned_to_agent, i.created_at, i.updated_at, i.closed_at
             FROM issues i
             WHERE i.project_path = ?1
               AND i.status = 'open'
               AND i.assigned_to_agent IS NULL
               AND NOT EXISTS (
                   SELECT 1 FROM issue_dependencies d
                   JOIN issues dep ON dep.id = d.depends_on_id
                   WHERE d.issue_id = i.id
                     AND d.dependency_type = 'blocks'
                     AND dep.status != 'closed'
               )
             ORDER BY i.priority DESC, i.created_at ASC
             LIMIT ?2",
        )?;

        let issues = stmt
            .query_map(rusqlite::params![project_path, limit], |row| {
                Ok(Issue {
                    id: row.get(0)?,
                    short_id: row.get(1)?,
                    project_path: row.get(2)?,
                    title: row.get(3)?,
                    description: row.get(4)?,
                    details: row.get(5)?,
                    status: row.get(6)?,
                    priority: row.get(7)?,
                    issue_type: row.get(8)?,
                    plan_id: row.get(9)?,
                    created_by_agent: row.get(10)?,
                    assigned_to_agent: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                    closed_at: row.get(14)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(issues)
    }

    /// Get and claim next block of ready issues.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn get_next_issue_block(
        &mut self,
        project_path: &str,
        count: u32,
        actor: &str,
    ) -> Result<Vec<Issue>> {
        let ready = self.get_ready_issues(project_path, count)?;

        for issue in &ready {
            self.claim_issue(&issue.id, actor)?;
        }

        // Return claimed issues with updated status
        let claimed: Vec<Issue> = ready
            .iter()
            .filter_map(|i| self.get_issue(&i.id, None).ok().flatten())
            .collect();

        Ok(claimed)
    }

    // ======================
    // Issue Analytics
    // ======================

    /// Count issues grouped by a field (status, type, priority, assignee).
    pub fn count_issues_grouped(
        &self,
        project_path: &str,
        group_by: &str,
    ) -> Result<Vec<(String, i64)>> {
        let column = match group_by {
            "status" => "status",
            "type" => "issue_type",
            "priority" => "CAST(priority AS TEXT)",
            "assignee" => "COALESCE(assigned_to_agent, 'unassigned')",
            _ => return Err(Error::InvalidArgument(
                format!("Invalid group_by '{group_by}'. Valid: status, type, priority, assignee")
            )),
        };

        let sql = format!(
            "SELECT {column}, COUNT(*) as count FROM issues \
             WHERE project_path = ?1 GROUP BY {column} ORDER BY count DESC"
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([project_path], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;

        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// Get stale issues (not updated in N days).
    pub fn get_stale_issues(
        &self,
        project_path: &str,
        stale_days: u64,
        limit: u32,
    ) -> Result<Vec<Issue>> {
        let cutoff_ms = chrono::Utc::now().timestamp_millis()
            - (stale_days as i64 * 24 * 60 * 60 * 1000);

        let mut stmt = self.conn.prepare(
            "SELECT id, short_id, project_path, title, description, details,
                    status, priority, issue_type, plan_id, created_by_agent,
                    assigned_to_agent, created_at, updated_at, closed_at
             FROM issues
             WHERE project_path = ?1
               AND status IN ('open', 'in_progress', 'blocked')
               AND updated_at < ?2
             ORDER BY updated_at ASC
             LIMIT ?3",
        )?;

        let issues = stmt
            .query_map(rusqlite::params![project_path, cutoff_ms, limit], map_issue_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(issues)
    }

    /// Get blocked issues with their blockers.
    pub fn get_blocked_issues(
        &self,
        project_path: &str,
        limit: u32,
    ) -> Result<Vec<(Issue, Vec<Issue>)>> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.short_id, i.project_path, i.title, i.description, i.details,
                    i.status, i.priority, i.issue_type, i.plan_id, i.created_by_agent,
                    i.assigned_to_agent, i.created_at, i.updated_at, i.closed_at
             FROM issues i
             WHERE i.project_path = ?1
               AND i.status NOT IN ('closed', 'deferred')
               AND EXISTS (
                   SELECT 1 FROM issue_dependencies d
                   JOIN issues dep ON dep.id = d.depends_on_id
                   WHERE d.issue_id = i.id
                     AND d.dependency_type = 'blocks'
                     AND dep.status != 'closed'
               )
             ORDER BY i.priority DESC, i.created_at ASC
             LIMIT ?2",
        )?;

        let blocked_issues = stmt
            .query_map(rusqlite::params![project_path, limit], map_issue_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut blocker_stmt = self.conn.prepare(
            "SELECT dep.id, dep.short_id, dep.project_path, dep.title, dep.description, dep.details,
                    dep.status, dep.priority, dep.issue_type, dep.plan_id, dep.created_by_agent,
                    dep.assigned_to_agent, dep.created_at, dep.updated_at, dep.closed_at
             FROM issue_dependencies d
             JOIN issues dep ON dep.id = d.depends_on_id
             WHERE d.issue_id = ?1
               AND d.dependency_type = 'blocks'
               AND dep.status != 'closed'",
        )?;

        let mut results = Vec::with_capacity(blocked_issues.len());
        for issue in blocked_issues {
            let blockers = blocker_stmt
                .query_map([&issue.id], map_issue_row)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            results.push((issue, blockers));
        }

        Ok(results)
    }

    /// Get epic progress (child issue counts by status).
    pub fn get_epic_progress(&self, epic_id: &str) -> Result<EpicProgress> {
        let mut stmt = self.conn.prepare(
            "SELECT child.status, COUNT(*) as count
             FROM issue_dependencies d
             JOIN issues child ON child.id = d.issue_id
             WHERE d.depends_on_id = ?1
               AND d.dependency_type = 'parent-child'
             GROUP BY child.status",
        )?;

        let rows = stmt
            .query_map([epic_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut progress = EpicProgress::default();
        for (status, count) in rows {
            match status.as_str() {
                "closed" => progress.closed += count,
                "in_progress" => progress.in_progress += count,
                "open" => progress.open += count,
                "blocked" => progress.blocked += count,
                "deferred" => progress.deferred += count,
                _ => progress.open += count,
            }
            progress.total += count;
        }

        Ok(progress)
    }

    /// Get dependency tree starting from a root issue.
    /// Returns (issue, depth) pairs in tree order.
    pub fn get_dependency_tree(&self, root_id: &str) -> Result<Vec<(Issue, i32)>> {
        // First get the root issue
        let root = self.get_issue(root_id, None)?
            .ok_or_else(|| Error::IssueNotFound { id: root_id.to_string() })?;

        let root_full_id = root.id.clone();
        let mut result = vec![(root, 0)];
        let mut queue = vec![(root_full_id.clone(), 0i32)];
        let mut visited = std::collections::HashSet::new();
        visited.insert(root_full_id);

        let mut child_stmt = self.conn.prepare(
            "SELECT child.id, child.short_id, child.project_path, child.title,
                    child.description, child.details, child.status, child.priority,
                    child.issue_type, child.plan_id, child.created_by_agent,
                    child.assigned_to_agent, child.created_at, child.updated_at,
                    child.closed_at
             FROM issue_dependencies d
             JOIN issues child ON child.id = d.issue_id
             WHERE d.depends_on_id = ?1
               AND d.dependency_type IN ('parent-child', 'blocks')
             ORDER BY child.priority DESC, child.created_at ASC",
        )?;

        while let Some((parent_id, depth)) = queue.pop() {
            let children = child_stmt
                .query_map([&parent_id], map_issue_row)?
                .collect::<std::result::Result<Vec<_>, _>>()?;

            for child in children {
                if visited.insert(child.id.clone()) {
                    let child_id = child.id.clone();
                    result.push((child, depth + 1));
                    queue.push((child_id, depth + 1));
                }
            }
        }

        Ok(result)
    }

    /// Get all epics for a project.
    pub fn get_epics(&self, project_path: &str) -> Result<Vec<Issue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, short_id, project_path, title, description, details,
                    status, priority, issue_type, plan_id, created_by_agent,
                    assigned_to_agent, created_at, updated_at, closed_at
             FROM issues
             WHERE project_path = ?1
               AND issue_type = 'epic'
               AND status != 'closed'
             ORDER BY priority DESC, created_at ASC",
        )?;

        let issues = stmt
            .query_map([project_path], map_issue_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(issues)
    }

    /// Update close_reason on an issue.
    pub fn set_close_reason(
        &mut self,
        id: &str,
        reason: &str,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.mutate("set_close_reason", actor, |tx, _ctx| {
            let rows = tx.execute(
                "UPDATE issues SET close_reason = ?1, updated_at = ?2 WHERE id = ?3 OR short_id = ?3",
                rusqlite::params![reason, now, id],
            )?;
            if rows == 0 {
                return Err(Error::IssueNotFound { id: id.to_string() });
            }
            Ok(())
        })
    }

    /// Get close_reason for an issue.
    pub fn get_close_reason(&self, id: &str) -> Result<Option<String>> {
        let result = self.conn.query_row(
            "SELECT close_reason FROM issues WHERE id = ?1 OR short_id = ?1",
            [id],
            |row| row.get(0),
        );
        match result {
            Ok(reason) => Ok(reason),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    // ======================
    // Checkpoint Operations
    // ======================

    /// Create a checkpoint.
    ///
    /// # Errors
    ///
    /// Returns an error if the insert fails.
    #[allow(clippy::too_many_arguments)]
    pub fn create_checkpoint(
        &mut self,
        id: &str,
        session_id: &str,
        name: &str,
        description: Option<&str>,
        git_status: Option<&str>,
        git_branch: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("create_checkpoint", actor, |tx, ctx| {
            tx.execute(
                "INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![id, session_id, name, description, git_status, git_branch, now],
            )?;

            ctx.record_event("checkpoint", id, EventType::CheckpointCreated);

            Ok(())
        })
    }

    /// Add an item to a checkpoint.
    ///
    /// # Errors
    ///
    /// Returns an error if the insert fails.
    pub fn add_checkpoint_item(
        &mut self,
        checkpoint_id: &str,
        context_item_id: &str,
        actor: &str,
    ) -> Result<()> {
        let id = format!("cpitem_{}", &uuid::Uuid::new_v4().to_string()[..12]);
        self.mutate("add_checkpoint_item", actor, |tx, _ctx| {
            tx.execute(
                "INSERT OR IGNORE INTO checkpoint_items (id, checkpoint_id, context_item_id)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![id, checkpoint_id, context_item_id],
            )?;

            Ok(())
        })
    }

    /// Count context items created since the most recent checkpoint for a session.
    ///
    /// Returns 0 if no items exist. If no checkpoint exists, counts all items.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn count_items_since_last_checkpoint(&self, session_id: &str) -> Result<i64> {
        let last_checkpoint_time: Option<i64> = self.conn.query_row(
            "SELECT MAX(created_at) FROM checkpoints WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?;

        let count = if let Some(ts) = last_checkpoint_time {
            self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE session_id = ?1 AND created_at > ?2",
                rusqlite::params![session_id, ts],
                |row| row.get(0),
            )?
        } else {
            // No checkpoints yet — count all items
            self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?
        };

        Ok(count)
    }

    /// List checkpoints for a session.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn list_checkpoints(
        &self,
        session_id: &str,
        limit: Option<u32>,
    ) -> Result<Vec<Checkpoint>> {
        let limit = limit.unwrap_or(20);

        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.session_id, c.name, c.description, c.git_status, c.git_branch, c.created_at,
                    (SELECT COUNT(*) FROM checkpoint_items ci WHERE ci.checkpoint_id = c.id) as item_count
             FROM checkpoints c
             WHERE c.session_id = ?1
             ORDER BY c.created_at DESC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(rusqlite::params![session_id, limit], |row| {
            Ok(Checkpoint {
                id: row.get(0)?,
                session_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                git_status: row.get(4)?,
                git_branch: row.get(5)?,
                created_at: row.get(6)?,
                item_count: row.get(7)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get a checkpoint by ID.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_checkpoint(&self, id: &str) -> Result<Option<Checkpoint>> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.session_id, c.name, c.description, c.git_status, c.git_branch, c.created_at,
                    (SELECT COUNT(*) FROM checkpoint_items ci WHERE ci.checkpoint_id = c.id) as item_count
             FROM checkpoints c
             WHERE c.id = ?1",
        )?;

        let checkpoint = stmt
            .query_row([id], |row| {
                Ok(Checkpoint {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    git_status: row.get(4)?,
                    git_branch: row.get(5)?,
                    created_at: row.get(6)?,
                    item_count: row.get(7)?,
                })
            })
            .optional()?;

        Ok(checkpoint)
    }

    /// Delete a checkpoint.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn delete_checkpoint(&mut self, id: &str, actor: &str) -> Result<()> {
        self.mutate("delete_checkpoint", actor, |tx, ctx| {
            // Get project_path from session for sync tracking
            let project_path: Option<Option<String>> = tx
                .query_row(
                    "SELECT s.project_path FROM checkpoints c
                     JOIN sessions s ON c.session_id = s.id
                     WHERE c.id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()?;

            // Delete checkpoint items first
            tx.execute("DELETE FROM checkpoint_items WHERE checkpoint_id = ?1", [id])?;

            // Delete the checkpoint
            let rows = tx.execute("DELETE FROM checkpoints WHERE id = ?1", [id])?;

            if rows == 0 {
                return Err(Error::CheckpointNotFound { id: id.to_string() });
            }

            ctx.record_event("checkpoint", id, EventType::CheckpointDeleted);

            // Record for sync export
            if let Some(Some(path)) = project_path {
                let now = chrono::Utc::now().timestamp_millis();
                tx.execute(
                    "INSERT INTO sync_deletions (entity_type, entity_id, project_path, deleted_at, deleted_by, exported)
                     VALUES ('checkpoint', ?1, ?2, ?3, ?4, 0)
                     ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                       deleted_at = excluded.deleted_at,
                       deleted_by = excluded.deleted_by,
                       exported = 0",
                    rusqlite::params![id, path, now, ctx.actor],
                )?;
            }

            Ok(())
        })
    }

    /// Get context items in a checkpoint.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_checkpoint_items(&self, checkpoint_id: &str) -> Result<Vec<ContextItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT ci.id, ci.session_id, ci.key, ci.value, ci.category, ci.priority,
                    ci.channel, ci.tags, ci.size, ci.created_at, ci.updated_at
             FROM context_items ci
             JOIN checkpoint_items cpi ON cpi.context_item_id = ci.id
             WHERE cpi.checkpoint_id = ?1
             ORDER BY ci.priority DESC, ci.created_at DESC",
        )?;

        let rows = stmt.query_map([checkpoint_id], |row| {
            Ok(ContextItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                channel: row.get(6)?,
                tags: row.get(7)?,
                size: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Restore a checkpoint to a target session.
    ///
    /// This clears existing context items in the target session and recreates
    /// them from the checkpoint. Optional filters can limit which items are restored.
    ///
    /// # Errors
    ///
    /// Returns an error if the restore fails.
    pub fn restore_checkpoint(
        &mut self,
        checkpoint_id: &str,
        target_session_id: &str,
        restore_categories: Option<&[String]>,
        restore_tags: Option<&[String]>,
        actor: &str,
    ) -> Result<usize> {
        // Get items from checkpoint
        let mut items = self.get_checkpoint_items(checkpoint_id)?;

        // Apply category filter
        if let Some(categories) = restore_categories {
            items.retain(|item| categories.contains(&item.category));
        }

        // Apply tag filter
        if let Some(tags) = restore_tags {
            items.retain(|item| {
                // Parse tags from item (stored as JSON array or null)
                if let Some(ref item_tags) = item.tags {
                    if let Ok(parsed_tags) = serde_json::from_str::<Vec<String>>(item_tags) {
                        return tags.iter().any(|t| parsed_tags.contains(t));
                    }
                }
                false
            });
        }

        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("restore_checkpoint", actor, |tx, ctx| {
            // Clear existing context items in target session
            tx.execute(
                "DELETE FROM context_items WHERE session_id = ?1",
                [target_session_id],
            )?;

            // Restore items
            let mut restored = 0;
            for item in &items {
                let new_id = uuid::Uuid::new_v4().to_string();
                let size = item.value.len() as i64;

                tx.execute(
                    "INSERT INTO context_items (id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                    rusqlite::params![
                        new_id,
                        target_session_id,
                        item.key,
                        item.value,
                        item.category,
                        item.priority,
                        item.channel,
                        item.tags,
                        size,
                        now,
                    ],
                )?;

                ctx.record_event("context_item", &new_id, EventType::ItemCreated);
                restored += 1;
            }

            Ok(restored)
        })
    }

    /// Remove an item from a checkpoint by context item ID.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn remove_checkpoint_item(
        &mut self,
        checkpoint_id: &str,
        context_item_id: &str,
        actor: &str,
    ) -> Result<()> {
        self.mutate("remove_checkpoint_item", actor, |tx, _ctx| {
            tx.execute(
                "DELETE FROM checkpoint_items WHERE checkpoint_id = ?1 AND context_item_id = ?2",
                rusqlite::params![checkpoint_id, context_item_id],
            )?;
            Ok(())
        })
    }

    /// Add items to checkpoint by their keys (from current session).
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn add_checkpoint_items_by_keys(
        &mut self,
        checkpoint_id: &str,
        session_id: &str,
        keys: &[String],
        actor: &str,
    ) -> Result<usize> {
        let mut added = 0;

        for key in keys {
            // Find context item by key in session
            let item_id: Option<String> = self.conn.query_row(
                "SELECT id FROM context_items WHERE session_id = ?1 AND key = ?2",
                rusqlite::params![session_id, key],
                |row| row.get(0),
            ).optional()?;

            if let Some(id) = item_id {
                self.add_checkpoint_item(checkpoint_id, &id, actor)?;
                added += 1;
            }
        }

        Ok(added)
    }

    /// Remove items from checkpoint by their keys.
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    pub fn remove_checkpoint_items_by_keys(
        &mut self,
        checkpoint_id: &str,
        keys: &[String],
        actor: &str,
    ) -> Result<usize> {
        let mut removed = 0;

        for key in keys {
            // Find context item by key in checkpoint
            let item_id: Option<String> = self.conn.query_row(
                "SELECT ci.id FROM context_items ci
                 JOIN checkpoint_items cpi ON cpi.context_item_id = ci.id
                 WHERE cpi.checkpoint_id = ?1 AND ci.key = ?2",
                rusqlite::params![checkpoint_id, key],
                |row| row.get(0),
            ).optional()?;

            if let Some(id) = item_id {
                self.remove_checkpoint_item(checkpoint_id, &id, actor)?;
                removed += 1;
            }
        }

        Ok(removed)
    }

    // =================
    // Memory Operations
    // =================

    /// Save a memory item (project-level persistent storage).
    ///
    /// # Errors
    ///
    /// Returns an error if the operation fails.
    #[allow(clippy::too_many_arguments)]
    pub fn save_memory(
        &mut self,
        id: &str,
        project_path: &str,
        key: &str,
        value: &str,
        category: &str,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();

        self.mutate("save_memory", actor, |tx, ctx| {
            tx.execute(
                "INSERT INTO project_memory (id, project_path, key, value, category, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(project_path, key) DO UPDATE SET
                   value = excluded.value,
                   category = excluded.category,
                   updated_at = excluded.updated_at",
                rusqlite::params![id, project_path, key, value, category, now],
            )?;

            ctx.record_event("memory", id, EventType::MemorySaved);

            Ok(())
        })
    }

    /// Get a memory item by key.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_memory(&self, project_path: &str, key: &str) -> Result<Option<Memory>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_path, key, value, category, created_at, updated_at
             FROM project_memory WHERE project_path = ?1 AND key = ?2",
        )?;

        let memory = stmt
            .query_row(rusqlite::params![project_path, key], |row| {
                Ok(Memory {
                    id: row.get(0)?,
                    project_path: row.get(1)?,
                    key: row.get(2)?,
                    value: row.get(3)?,
                    category: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .optional()?;

        Ok(memory)
    }

    /// List memory items for a project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn list_memory(
        &self,
        project_path: &str,
        category: Option<&str>,
    ) -> Result<Vec<Memory>> {
        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<Memory> {
            Ok(Memory {
                id: row.get(0)?,
                project_path: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        };

        let rows = if let Some(cat) = category {
            let mut stmt = self.conn.prepare(
                "SELECT id, project_path, key, value, category, created_at, updated_at
                 FROM project_memory WHERE project_path = ?1 AND category = ?2
                 ORDER BY key ASC",
            )?;
            stmt.query_map(rusqlite::params![project_path, cat], map_row)?
                .collect::<std::result::Result<Vec<_>, _>>()
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, project_path, key, value, category, created_at, updated_at
                 FROM project_memory WHERE project_path = ?1
                 ORDER BY key ASC",
            )?;
            stmt.query_map(rusqlite::params![project_path], map_row)?
                .collect::<std::result::Result<Vec<_>, _>>()
        };

        rows.map_err(Error::from)
    }

    /// Delete a memory item.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn delete_memory(
        &mut self,
        project_path: &str,
        key: &str,
        actor: &str,
    ) -> Result<()> {
        let proj_path = project_path.to_string();
        self.mutate("delete_memory", actor, |tx, ctx| {
            // Get ID for event
            let id: Option<String> = tx
                .query_row(
                    "SELECT id FROM project_memory WHERE project_path = ?1 AND key = ?2",
                    rusqlite::params![proj_path, key],
                    |row| row.get(0),
                )
                .optional()?;

            let rows = tx.execute(
                "DELETE FROM project_memory WHERE project_path = ?1 AND key = ?2",
                rusqlite::params![proj_path, key],
            )?;

            if rows > 0 {
                if let Some(ref mem_id) = id {
                    ctx.record_event("memory", mem_id, EventType::MemoryDeleted);

                    // Record for sync export
                    let now = chrono::Utc::now().timestamp_millis();
                    tx.execute(
                        "INSERT INTO sync_deletions (entity_type, entity_id, project_path, deleted_at, deleted_by, exported)
                         VALUES ('memory', ?1, ?2, ?3, ?4, 0)
                         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                           deleted_at = excluded.deleted_at,
                           deleted_by = excluded.deleted_by,
                           exported = 0",
                        rusqlite::params![mem_id, proj_path, now, ctx.actor],
                    )?;
                }
            }

            Ok(())
        })
    }

    // =======================
    // Sync Support Operations
    // =======================

    /// Get IDs of all dirty sessions (pending export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_dirty_sessions(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT session_id FROM dirty_sessions ORDER BY marked_at ASC",
        )?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get IDs of all dirty issues (pending export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_dirty_issues(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT issue_id FROM dirty_issues ORDER BY marked_at ASC",
        )?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get IDs of all dirty context items (pending export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_dirty_context_items(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT item_id FROM dirty_context_items ORDER BY marked_at ASC",
        )?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Clear dirty flags for sessions after successful export.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn clear_dirty_sessions(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("DELETE FROM dirty_sessions WHERE session_id IN ({placeholders})");
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        self.conn.execute(&sql, params.as_slice())?;
        Ok(())
    }

    /// Clear dirty flags for issues after successful export.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn clear_dirty_issues(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("DELETE FROM dirty_issues WHERE issue_id IN ({placeholders})");
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        self.conn.execute(&sql, params.as_slice())?;
        Ok(())
    }

    /// Clear dirty flags for context items after successful export.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn clear_dirty_context_items(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("DELETE FROM dirty_context_items WHERE item_id IN ({placeholders})");
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        self.conn.execute(&sql, params.as_slice())?;
        Ok(())
    }

    /// Get the stored content hash for an entity (for incremental export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_export_hash(&self, entity_type: &str, entity_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT content_hash FROM export_hashes WHERE entity_type = ?1 AND entity_id = ?2",
        )?;
        let hash = stmt
            .query_row(rusqlite::params![entity_type, entity_id], |row| row.get(0))
            .optional()?;
        Ok(hash)
    }

    /// Store a content hash after successful export.
    ///
    /// # Errors
    ///
    /// Returns an error if the upsert fails.
    pub fn set_export_hash(&mut self, entity_type: &str, entity_id: &str, hash: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO export_hashes (entity_type, entity_id, content_hash, exported_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET
               content_hash = excluded.content_hash,
               exported_at = excluded.exported_at",
            rusqlite::params![entity_type, entity_id, hash, now],
        )?;
        Ok(())
    }

    // ===================
    // Deletion Tracking (for sync)
    // ===================

    /// Record a deletion for sync export.
    ///
    /// This should be called when an entity is deleted so that the deletion
    /// can be exported and applied on other machines.
    ///
    /// # Errors
    ///
    /// Returns an error if the insert fails.
    pub fn record_deletion(
        &mut self,
        entity_type: &str,
        entity_id: &str,
        project_path: &str,
        actor: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO sync_deletions (entity_type, entity_id, project_path, deleted_at, deleted_by, exported)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET
               deleted_at = excluded.deleted_at,
               deleted_by = excluded.deleted_by,
               exported = 0",
            rusqlite::params![entity_type, entity_id, project_path, now, actor],
        )?;
        Ok(())
    }

    /// Get pending deletions for a project that haven't been exported yet.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_pending_deletions(&self, project_path: &str) -> Result<Vec<SyncDeletion>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, entity_type, entity_id, project_path, deleted_at, deleted_by
             FROM sync_deletions
             WHERE project_path = ?1 AND exported = 0
             ORDER BY deleted_at ASC",
        )?;
        let rows = stmt.query_map([project_path], |row| {
            Ok(SyncDeletion {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                project_path: row.get(3)?,
                deleted_at: row.get(4)?,
                deleted_by: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all deletions for a project (for full export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_all_deletions(&self, project_path: &str) -> Result<Vec<SyncDeletion>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, entity_type, entity_id, project_path, deleted_at, deleted_by
             FROM sync_deletions
             WHERE project_path = ?1
             ORDER BY deleted_at ASC",
        )?;
        let rows = stmt.query_map([project_path], |row| {
            Ok(SyncDeletion {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                project_path: row.get(3)?,
                deleted_at: row.get(4)?,
                deleted_by: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Mark deletions as exported.
    ///
    /// # Errors
    ///
    /// Returns an error if the update fails.
    pub fn mark_deletions_exported(&mut self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("UPDATE sync_deletions SET exported = 1 WHERE id IN ({placeholders})");
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        self.conn.execute(&sql, params.as_slice())?;
        Ok(())
    }

    /// Count pending deletions for a project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn count_pending_deletions(&self, project_path: &str) -> Result<usize> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sync_deletions WHERE project_path = ?1 AND exported = 0",
            [project_path],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    /// Delete entity by ID for import (applies deletion from another machine).
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn apply_deletion(&mut self, entity_type: &str, entity_id: &str) -> Result<bool> {
        let sql = match entity_type {
            "session" => "DELETE FROM sessions WHERE id = ?1",
            "issue" => "DELETE FROM issues WHERE id = ?1",
            "context_item" => "DELETE FROM context_items WHERE id = ?1",
            "memory" => "DELETE FROM project_memory WHERE id = ?1",
            "checkpoint" => "DELETE FROM checkpoints WHERE id = ?1",
            _ => return Ok(false),
        };
        let rows = self.conn.execute(sql, [entity_id])?;
        Ok(rows > 0)
    }

    /// Get all sessions (for full export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_all_sessions(&self) -> Result<Vec<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, branch, channel, project_path, status, ended_at, created_at, updated_at
             FROM sessions ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                branch: row.get(3)?,
                channel: row.get(4)?,
                project_path: row.get(5)?,
                status: row.get(6)?,
                ended_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all issues (for full export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_all_issues(&self) -> Result<Vec<Issue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, short_id, project_path, title, description, details, status, priority, issue_type, plan_id, created_by_agent, assigned_to_agent, created_at, updated_at, closed_at
             FROM issues ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], map_issue_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all context items (for full export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_all_context_items(
        &self,
        category: Option<&str>,
        priority: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<ContextItem>> {
        let mut sql = String::from(
            "SELECT id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at
             FROM context_items WHERE 1=1",
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];

        if let Some(cat) = category {
            sql.push_str(" AND category = ?");
            params.push(Box::new(cat.to_string()));
        }

        if let Some(pri) = priority {
            sql.push_str(" AND priority = ?");
            params.push(Box::new(pri.to_string()));
        }

        sql.push_str(" ORDER BY created_at DESC");
        if let Some(lim) = limit {
            sql.push_str(" LIMIT ?");
            params.push(Box::new(lim));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();

        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(ContextItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                channel: row.get(6)?,
                tags: row.get(7)?,
                size: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all memory items (for full export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_all_memory(&self) -> Result<Vec<Memory>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_path, key, value, category, created_at, updated_at
             FROM project_memory ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Memory {
                id: row.get(0)?,
                project_path: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all issue short IDs (for Levenshtein suggestions).
    ///
    /// Returns short_ids (e.g. "SC-a1b2") for all issues, used by
    /// `find_similar_ids()` when an issue lookup fails.
    pub fn get_all_issue_short_ids(&self) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT short_id FROM issues WHERE short_id IS NOT NULL")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all session IDs (for Levenshtein suggestions).
    pub fn get_all_session_ids(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT id FROM sessions")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all checkpoint IDs (for Levenshtein suggestions).
    pub fn get_all_checkpoint_ids(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT id FROM checkpoints")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all checkpoints (for full export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_all_checkpoints(&self) -> Result<Vec<Checkpoint>> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.session_id, c.name, c.description, c.git_status, c.git_branch, c.created_at,
                    (SELECT COUNT(*) FROM checkpoint_items ci WHERE ci.checkpoint_id = c.id) as item_count
             FROM checkpoints c ORDER BY c.created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Checkpoint {
                id: row.get(0)?,
                session_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                git_status: row.get(4)?,
                git_branch: row.get(5)?,
                created_at: row.get(6)?,
                item_count: row.get(7)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get a context item by ID.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_context_item(&self, id: &str) -> Result<Option<ContextItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at
             FROM context_items WHERE id = ?1",
        )?;
        let item = stmt
            .query_row([id], |row| {
                Ok(ContextItem {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    key: row.get(2)?,
                    value: row.get(3)?,
                    category: row.get(4)?,
                    priority: row.get(5)?,
                    channel: row.get(6)?,
                    tags: row.get(7)?,
                    size: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .optional()?;
        Ok(item)
    }

    // ======================
    // Project-Scoped Queries (for sync export)
    // ======================

    /// Get all sessions for a specific project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_sessions_by_project(&self, project_path: &str) -> Result<Vec<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, branch, channel, project_path, status, ended_at, created_at, updated_at
             FROM sessions WHERE project_path = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([project_path], |row| {
            Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                branch: row.get(3)?,
                channel: row.get(4)?,
                project_path: row.get(5)?,
                status: row.get(6)?,
                ended_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all issues for a specific project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_issues_by_project(&self, project_path: &str) -> Result<Vec<Issue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, short_id, project_path, title, description, details, status, priority, issue_type, plan_id, created_by_agent, assigned_to_agent, created_at, updated_at, closed_at
             FROM issues WHERE project_path = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([project_path], map_issue_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all context items for sessions in a specific project.
    ///
    /// Context items are linked to sessions, so we join on session_id
    /// and filter by the session's project_path.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_context_items_by_project(&self, project_path: &str) -> Result<Vec<ContextItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT ci.id, ci.session_id, ci.key, ci.value, ci.category, ci.priority, ci.channel, ci.tags, ci.size, ci.created_at, ci.updated_at
             FROM context_items ci
             INNER JOIN sessions s ON ci.session_id = s.id
             WHERE s.project_path = ?1
             ORDER BY ci.created_at ASC",
        )?;
        let rows = stmt.query_map([project_path], |row| {
            Ok(ContextItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                channel: row.get(6)?,
                tags: row.get(7)?,
                size: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all memory items for a specific project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_memory_by_project(&self, project_path: &str) -> Result<Vec<Memory>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_path, key, value, category, created_at, updated_at
             FROM project_memory WHERE project_path = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([project_path], |row| {
            Ok(Memory {
                id: row.get(0)?,
                project_path: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get all checkpoints for sessions in a specific project.
    ///
    /// Checkpoints are linked to sessions, so we join on session_id
    /// and filter by the session's project_path.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_checkpoints_by_project(&self, project_path: &str) -> Result<Vec<Checkpoint>> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.session_id, c.name, c.description, c.git_status, c.git_branch, c.created_at,
                    (SELECT COUNT(*) FROM checkpoint_items ci WHERE ci.checkpoint_id = c.id) as item_count
             FROM checkpoints c
             INNER JOIN sessions s ON c.session_id = s.id
             WHERE s.project_path = ?1
             ORDER BY c.created_at ASC",
        )?;
        let rows = stmt.query_map([project_path], |row| {
            Ok(Checkpoint {
                id: row.get(0)?,
                session_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                git_status: row.get(4)?,
                git_branch: row.get(5)?,
                created_at: row.get(6)?,
                item_count: row.get(7)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get dirty session IDs for a specific project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_dirty_sessions_by_project(&self, project_path: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT ds.session_id
             FROM dirty_sessions ds
             INNER JOIN sessions s ON ds.session_id = s.id
             WHERE s.project_path = ?1",
        )?;
        let rows = stmt.query_map([project_path], |row| row.get(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get dirty issue IDs for a specific project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_dirty_issues_by_project(&self, project_path: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT di.issue_id
             FROM dirty_issues di
             INNER JOIN issues i ON di.issue_id = i.id
             WHERE i.project_path = ?1",
        )?;
        let rows = stmt.query_map([project_path], |row| row.get(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get dirty context item IDs for a specific project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_dirty_context_items_by_project(&self, project_path: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT dci.item_id
             FROM dirty_context_items dci
             INNER JOIN context_items ci ON dci.item_id = ci.id
             INNER JOIN sessions s ON ci.session_id = s.id
             WHERE s.project_path = ?1",
        )?;
        let rows = stmt.query_map([project_path], |row| row.get(0))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Backfill dirty tables with all records for a project.
    ///
    /// This is used on first sync export when no prior exports exist.
    /// It marks all existing records for the project as dirty so they
    /// get included in the initial export.
    ///
    /// # Errors
    ///
    /// Returns an error if the queries fail.
    pub fn backfill_dirty_for_project(&mut self, project_path: &str) -> Result<BackfillStats> {
        let now = chrono::Utc::now().timestamp_millis();

        // Backfill sessions
        let sessions_count = self.conn.execute(
            "INSERT OR IGNORE INTO dirty_sessions (session_id, marked_at)
             SELECT id, ?1 FROM sessions WHERE project_path = ?2",
            rusqlite::params![now, project_path],
        )?;

        // Backfill issues
        let issues_count = self.conn.execute(
            "INSERT OR IGNORE INTO dirty_issues (issue_id, marked_at)
             SELECT id, ?1 FROM issues WHERE project_path = ?2",
            rusqlite::params![now, project_path],
        )?;

        // Backfill context items (via session join)
        let context_items_count = self.conn.execute(
            "INSERT OR IGNORE INTO dirty_context_items (item_id, marked_at)
             SELECT ci.id, ?1 FROM context_items ci
             INNER JOIN sessions s ON ci.session_id = s.id
             WHERE s.project_path = ?2",
            rusqlite::params![now, project_path],
        )?;

        // Backfill plans
        let plans_count = self.conn.execute(
            "INSERT OR IGNORE INTO dirty_plans (plan_id, marked_at)
             SELECT id, ?1 FROM plans WHERE project_path = ?2",
            rusqlite::params![now, project_path],
        )?;

        Ok(BackfillStats {
            sessions: sessions_count,
            issues: issues_count,
            context_items: context_items_count,
            plans: plans_count,
        })
    }

    /// Get total record counts for a project (for status display).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_project_counts(&self, project_path: &str) -> Result<ProjectCounts> {
        let sessions: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE project_path = ?1",
            [project_path],
            |row| row.get(0),
        )?;

        let issues: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM issues WHERE project_path = ?1",
            [project_path],
            |row| row.get(0),
        )?;

        let context_items: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM context_items ci
             INNER JOIN sessions s ON ci.session_id = s.id
             WHERE s.project_path = ?1",
            [project_path],
            |row| row.get(0),
        )?;

        let memories: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM project_memory WHERE project_path = ?1",
            [project_path],
            |row| row.get(0),
        )?;

        let checkpoints: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM checkpoints c
             INNER JOIN sessions s ON c.session_id = s.id
             WHERE s.project_path = ?1",
            [project_path],
            |row| row.get(0),
        )?;

        Ok(ProjectCounts {
            sessions: sessions as usize,
            issues: issues as usize,
            context_items: context_items as usize,
            memories: memories as usize,
            checkpoints: checkpoints as usize,
        })
    }

    // ======================
    // Upsert Operations (for sync import)
    // ======================

    /// Upsert a session (for sync import).
    ///
    /// This performs an INSERT OR REPLACE, preserving all fields from the imported record.
    ///
    /// # Errors
    ///
    /// Returns an error if the upsert fails.
    pub fn upsert_session(&mut self, session: &Session) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sessions (id, name, description, branch, channel, project_path, status, ended_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               branch = excluded.branch,
               channel = excluded.channel,
               project_path = excluded.project_path,
               status = excluded.status,
               ended_at = excluded.ended_at,
               updated_at = excluded.updated_at",
            rusqlite::params![
                session.id,
                session.name,
                session.description,
                session.branch,
                session.channel,
                session.project_path,
                session.status,
                session.ended_at,
                session.created_at,
                session.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Upsert an issue (for sync import).
    ///
    /// # Errors
    ///
    /// Returns an error if the upsert fails.
    pub fn upsert_issue(&mut self, issue: &Issue) -> Result<()> {
        self.conn.execute(
            "INSERT INTO issues (id, short_id, project_path, title, description, details, status, priority, issue_type, plan_id, created_by_agent, assigned_to_agent, created_at, updated_at, closed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(id) DO UPDATE SET
               short_id = excluded.short_id,
               project_path = excluded.project_path,
               title = excluded.title,
               description = excluded.description,
               details = excluded.details,
               status = excluded.status,
               priority = excluded.priority,
               issue_type = excluded.issue_type,
               plan_id = excluded.plan_id,
               assigned_to_agent = excluded.assigned_to_agent,
               updated_at = excluded.updated_at,
               closed_at = excluded.closed_at",
            rusqlite::params![
                issue.id,
                issue.short_id,
                issue.project_path,
                issue.title,
                issue.description,
                issue.details,
                issue.status,
                issue.priority,
                issue.issue_type,
                issue.plan_id,
                issue.created_by_agent,
                issue.assigned_to_agent,
                issue.created_at,
                issue.updated_at,
                issue.closed_at,
            ],
        )?;
        Ok(())
    }

    /// Upsert a context item (for sync import).
    ///
    /// # Errors
    ///
    /// Returns an error if the upsert fails.
    pub fn upsert_context_item(&mut self, item: &ContextItem) -> Result<()> {
        self.conn.execute(
            "INSERT INTO context_items (id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               key = excluded.key,
               value = excluded.value,
               category = excluded.category,
               priority = excluded.priority,
               channel = excluded.channel,
               tags = excluded.tags,
               size = excluded.size,
               updated_at = excluded.updated_at",
            rusqlite::params![
                item.id,
                item.session_id,
                item.key,
                item.value,
                item.category,
                item.priority,
                item.channel,
                item.tags,
                item.size,
                item.created_at,
                item.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Upsert a memory item (for sync import).
    ///
    /// # Errors
    ///
    /// Returns an error if the upsert fails.
    pub fn upsert_memory(&mut self, memory: &Memory) -> Result<()> {
        self.conn.execute(
            "INSERT INTO project_memory (id, project_path, key, value, category, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               key = excluded.key,
               value = excluded.value,
               category = excluded.category,
               updated_at = excluded.updated_at",
            rusqlite::params![
                memory.id,
                memory.project_path,
                memory.key,
                memory.value,
                memory.category,
                memory.created_at,
                memory.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Upsert a checkpoint (for sync import).
    ///
    /// Note: This does not import checkpoint items - those would need separate handling.
    ///
    /// # Errors
    ///
    /// Returns an error if the upsert fails.
    pub fn upsert_checkpoint(&mut self, checkpoint: &Checkpoint) -> Result<()> {
        self.conn.execute(
            "INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               git_status = excluded.git_status,
               git_branch = excluded.git_branch",
            rusqlite::params![
                checkpoint.id,
                checkpoint.session_id,
                checkpoint.name,
                checkpoint.description,
                checkpoint.git_status,
                checkpoint.git_branch,
                checkpoint.created_at,
            ],
        )?;
        Ok(())
    }

    // ======================
    // Project Operations
    // ======================

    /// Create a new project.
    ///
    /// # Errors
    ///
    /// Returns an error if the project already exists or the insert fails.
    pub fn create_project(&mut self, project: &Project, actor: &str) -> Result<()> {
        self.mutate("create_project", actor, |tx, ctx| {
            tx.execute(
                "INSERT INTO projects (id, project_path, name, description, issue_prefix, next_issue_number, plan_prefix, next_plan_number, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    project.id,
                    project.project_path,
                    project.name,
                    project.description,
                    project.issue_prefix,
                    project.next_issue_number,
                    project.plan_prefix,
                    project.next_plan_number,
                    project.created_at,
                    project.updated_at,
                ],
            )?;

            ctx.record_event("project", &project.id, EventType::ProjectCreated);
            Ok(())
        })
    }

    /// Get a project by ID.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_project(&self, id: &str) -> Result<Option<Project>> {
        let project = self
            .conn
            .query_row(
                "SELECT id, project_path, name, description, issue_prefix, next_issue_number, plan_prefix, next_plan_number, created_at, updated_at
                 FROM projects WHERE id = ?1",
                [id],
                map_project_row,
            )
            .optional()?;
        Ok(project)
    }

    /// Get a project by path.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_project_by_path(&self, project_path: &str) -> Result<Option<Project>> {
        let project = self
            .conn
            .query_row(
                "SELECT id, project_path, name, description, issue_prefix, next_issue_number, plan_prefix, next_plan_number, created_at, updated_at
                 FROM projects WHERE project_path = ?1",
                [project_path],
                map_project_row,
            )
            .optional()?;
        Ok(project)
    }

    /// List all projects.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn list_projects(&self, limit: usize) -> Result<Vec<Project>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_path, name, description, issue_prefix, next_issue_number, plan_prefix, next_plan_number, created_at, updated_at
             FROM projects
             ORDER BY updated_at DESC
             LIMIT ?1",
        )?;

        let projects = stmt
            .query_map([limit], map_project_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(projects)
    }

    /// Update a project.
    ///
    /// # Errors
    ///
    /// Returns an error if the project doesn't exist or the update fails.
    pub fn update_project(
        &mut self,
        id: &str,
        name: Option<&str>,
        description: Option<&str>,
        issue_prefix: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        self.mutate("update_project", actor, |tx, ctx| {
            let now = chrono::Utc::now().timestamp_millis();

            // Build dynamic update query
            let mut updates = vec!["updated_at = ?1"];
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];
            let mut param_idx = 2;

            if let Some(n) = name {
                updates.push(format!("name = ?{param_idx}").leak());
                params.push(Box::new(n.to_string()));
                param_idx += 1;
            }

            if let Some(d) = description {
                updates.push(format!("description = ?{param_idx}").leak());
                params.push(Box::new(d.to_string()));
                param_idx += 1;
            }

            if let Some(p) = issue_prefix {
                updates.push(format!("issue_prefix = ?{param_idx}").leak());
                params.push(Box::new(p.to_string()));
                param_idx += 1;
            }

            // Add the WHERE clause parameter
            params.push(Box::new(id.to_string()));

            let sql = format!(
                "UPDATE projects SET {} WHERE id = ?{}",
                updates.join(", "),
                param_idx
            );

            let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let affected = tx.execute(&sql, param_refs.as_slice())?;

            if affected == 0 {
                return Err(Error::ProjectNotFound { id: id.to_string() });
            }

            ctx.record_event("project", id, EventType::ProjectUpdated);
            Ok(())
        })
    }

    /// Delete a project and all associated data.
    ///
    /// This cascades to delete:
    /// - All sessions (and their context items, checkpoints)
    /// - All issues
    /// - All plans
    /// - All project memory
    ///
    /// # Errors
    ///
    /// Returns an error if the project doesn't exist or deletion fails.
    pub fn delete_project(&mut self, id: &str, actor: &str) -> Result<()> {
        self.mutate("delete_project", actor, |tx, ctx| {
            // Get project path for cascading deletes
            let project_path: Option<String> = tx
                .query_row(
                    "SELECT project_path FROM projects WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()?;

            let project_path = project_path.ok_or_else(|| Error::ProjectNotFound { id: id.to_string() })?;

            // Delete sessions (cascades to context_items, checkpoints via FK)
            tx.execute(
                "DELETE FROM sessions WHERE project_path = ?1",
                [&project_path],
            )?;

            // Delete issues
            tx.execute(
                "DELETE FROM issues WHERE project_path = ?1",
                [&project_path],
            )?;

            // Delete plans
            tx.execute(
                "DELETE FROM plans WHERE project_path = ?1",
                [&project_path],
            )?;

            // Delete project memory
            tx.execute(
                "DELETE FROM project_memory WHERE project_path = ?1",
                [&project_path],
            )?;

            // Delete the project itself
            let affected = tx.execute("DELETE FROM projects WHERE id = ?1", [id])?;

            if affected == 0 {
                return Err(Error::ProjectNotFound { id: id.to_string() });
            }

            ctx.record_event("project", id, EventType::ProjectDeleted);
            Ok(())
        })
    }

    /// Get or create a project for the given path.
    ///
    /// If a project already exists at the path, returns it.
    /// Otherwise, creates a new project with a name derived from the path.
    ///
    /// # Errors
    ///
    /// Returns an error if the database operation fails.
    pub fn get_or_create_project(&mut self, project_path: &str, actor: &str) -> Result<Project> {
        // Check if project exists
        if let Some(project) = self.get_project_by_path(project_path)? {
            return Ok(project);
        }

        // Create new project with name from path
        let name = std::path::Path::new(project_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown Project")
            .to_string();

        let project = Project::new(project_path.to_string(), name);
        self.create_project(&project, actor)?;
        Ok(project)
    }

    /// Increment and return the next issue number for a project.
    ///
    /// # Errors
    ///
    /// Returns an error if the project doesn't exist or the update fails.
    pub fn get_next_issue_number(&mut self, project_path: &str) -> Result<i32> {
        let project = self
            .get_project_by_path(project_path)?
            .ok_or_else(|| Error::ProjectNotFound { id: project_path.to_string() })?;

        let next_num = project.next_issue_number;

        // Increment the counter
        self.conn.execute(
            "UPDATE projects SET next_issue_number = next_issue_number + 1, updated_at = ?1 WHERE project_path = ?2",
            rusqlite::params![chrono::Utc::now().timestamp_millis(), project_path],
        )?;

        Ok(next_num)
    }

    // ======================
    // Plan Operations
    // ======================

    /// Create a new plan.
    ///
    /// # Errors
    ///
    /// Returns an error if the plan already exists or the insert fails.
    pub fn create_plan(&mut self, plan: &Plan, actor: &str) -> Result<()> {
        self.mutate("create_plan", actor, |tx, ctx| {
            tx.execute(
                "INSERT INTO plans (id, short_id, project_id, project_path, title, content, status, success_criteria, session_id, created_in_session, source_path, source_hash, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    plan.id,
                    plan.short_id,
                    plan.project_id,
                    plan.project_path,
                    plan.title,
                    plan.content,
                    plan.status.as_str(),
                    plan.success_criteria,
                    plan.session_id,
                    plan.created_in_session,
                    plan.source_path,
                    plan.source_hash,
                    plan.created_at,
                    plan.updated_at,
                ],
            )?;

            ctx.record_event("plan", &plan.id, EventType::PlanCreated);
            Ok(())
        })
    }

    /// Get a plan by ID.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_plan(&self, id: &str) -> Result<Option<Plan>> {
        let plan = self
            .conn
            .query_row(
                "SELECT id, short_id, project_id, project_path, title, content, status, success_criteria, session_id, created_in_session, completed_in_session, source_path, source_hash, created_at, updated_at, completed_at
                 FROM plans WHERE id = ?1",
                [id],
                map_plan_row,
            )
            .optional()?;
        Ok(plan)
    }

    /// List plans for a project.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn list_plans(&self, project_path: &str, status: Option<&str>, limit: usize) -> Result<Vec<Plan>> {
        let sql = if let Some(status) = status {
            if status == "all" {
                "SELECT id, short_id, project_id, project_path, title, content, status, success_criteria, session_id, created_in_session, completed_in_session, source_path, source_hash, created_at, updated_at, completed_at
                 FROM plans WHERE project_path = ?1
                 ORDER BY updated_at DESC
                 LIMIT ?2".to_string()
            } else {
                format!(
                    "SELECT id, short_id, project_id, project_path, title, content, status, success_criteria, session_id, created_in_session, completed_in_session, source_path, source_hash, created_at, updated_at, completed_at
                     FROM plans WHERE project_path = ?1 AND status = '{}'
                     ORDER BY updated_at DESC
                     LIMIT ?2",
                    status
                )
            }
        } else {
            // Default: show active plans only
            "SELECT id, short_id, project_id, project_path, title, content, status, success_criteria, session_id, created_in_session, completed_in_session, source_path, source_hash, created_at, updated_at, completed_at
             FROM plans WHERE project_path = ?1 AND status = 'active'
             ORDER BY updated_at DESC
             LIMIT ?2".to_string()
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let plans = stmt
            .query_map(rusqlite::params![project_path, limit], map_plan_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(plans)
    }

    /// Update a plan.
    ///
    /// # Errors
    ///
    /// Returns an error if the plan doesn't exist or the update fails.
    pub fn update_plan(
        &mut self,
        id: &str,
        title: Option<&str>,
        content: Option<&str>,
        status: Option<&str>,
        success_criteria: Option<&str>,
        actor: &str,
    ) -> Result<()> {
        self.mutate("update_plan", actor, |tx, ctx| {
            let now = chrono::Utc::now().timestamp_millis();

            // Build dynamic update query
            let mut updates = vec!["updated_at = ?1"];
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];
            let mut param_idx = 2;

            if let Some(t) = title {
                updates.push(format!("title = ?{param_idx}").leak());
                params.push(Box::new(t.to_string()));
                param_idx += 1;
            }

            if let Some(c) = content {
                updates.push(format!("content = ?{param_idx}").leak());
                params.push(Box::new(c.to_string()));
                param_idx += 1;
            }

            if let Some(s) = status {
                updates.push(format!("status = ?{param_idx}").leak());
                params.push(Box::new(s.to_string()));
                param_idx += 1;

                // If marking completed, set completed_at
                if s == "completed" {
                    updates.push(format!("completed_at = ?{param_idx}").leak());
                    params.push(Box::new(now));
                    param_idx += 1;
                }
            }

            if let Some(sc) = success_criteria {
                updates.push(format!("success_criteria = ?{param_idx}").leak());
                params.push(Box::new(sc.to_string()));
                param_idx += 1;
            }

            // Add the WHERE clause parameter
            params.push(Box::new(id.to_string()));

            let sql = format!(
                "UPDATE plans SET {} WHERE id = ?{}",
                updates.join(", "),
                param_idx
            );

            let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let affected = tx.execute(&sql, param_refs.as_slice())?;

            if affected == 0 {
                return Err(Error::Other(format!("Plan not found: {id}")));
            }

            let event_type = if status == Some("completed") {
                EventType::PlanCompleted
            } else {
                EventType::PlanUpdated
            };
            ctx.record_event("plan", id, event_type);
            Ok(())
        })
    }

    /// Get all plans for a specific project (for JSONL sync export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_plans_by_project(&self, project_path: &str) -> Result<Vec<Plan>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, short_id, project_id, project_path, title, content, status, success_criteria, session_id, created_in_session, completed_in_session, source_path, source_hash, created_at, updated_at, completed_at
             FROM plans WHERE project_path = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([project_path], map_plan_row)?;
        let plans: Vec<Plan> = rows.collect::<std::result::Result<_, _>>()?;
        Ok(plans)
    }

    /// Find a plan by source hash (for capture deduplication).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn find_plan_by_source_hash(&self, source_hash: &str) -> Result<Option<Plan>> {
        let plan = self
            .conn
            .query_row(
                "SELECT id, short_id, project_id, project_path, title, content, status, success_criteria, session_id, created_in_session, completed_in_session, source_path, source_hash, created_at, updated_at, completed_at
                 FROM plans WHERE source_hash = ?1 LIMIT 1",
                [source_hash],
                map_plan_row,
            )
            .optional()?;
        Ok(plan)
    }

    /// Upsert a plan (for sync import).
    ///
    /// # Errors
    ///
    /// Returns an error if the upsert fails.
    pub fn upsert_plan(&mut self, plan: &Plan) -> Result<()> {
        self.conn.execute(
            "INSERT INTO plans (id, short_id, project_id, project_path, title, content, status, success_criteria, session_id, created_in_session, completed_in_session, source_path, source_hash, created_at, updated_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(id) DO UPDATE SET
               short_id = excluded.short_id,
               title = excluded.title,
               content = excluded.content,
               status = excluded.status,
               success_criteria = excluded.success_criteria,
               session_id = excluded.session_id,
               source_path = excluded.source_path,
               source_hash = excluded.source_hash,
               updated_at = excluded.updated_at,
               completed_at = excluded.completed_at",
            rusqlite::params![
                plan.id,
                plan.short_id,
                plan.project_id,
                plan.project_path,
                plan.title,
                plan.content,
                plan.status.as_str(),
                plan.success_criteria,
                plan.session_id,
                plan.created_in_session,
                plan.completed_in_session,
                plan.source_path,
                plan.source_hash,
                plan.created_at,
                plan.updated_at,
                plan.completed_at,
            ],
        )?;
        Ok(())
    }

    /// Get dirty plan IDs by project (for JSONL sync export).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_dirty_plans_by_project(&self, project_path: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT dp.plan_id
             FROM dirty_plans dp
             INNER JOIN plans p ON dp.plan_id = p.id
             WHERE p.project_path = ?1",
        )?;
        let rows = stmt.query_map([project_path], |row| row.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Clear dirty flags for plans after successful export.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn clear_dirty_plans(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("DELETE FROM dirty_plans WHERE plan_id IN ({placeholders})");
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        self.conn.execute(&sql, params.as_slice())?;
        Ok(())
    }

    // ======================
    // Embedding Operations
    // ======================

    /// Store an embedding chunk for a context item.
    ///
    /// Embeddings are stored as BLOBs (binary f32 arrays).
    /// Large items may have multiple chunks for full semantic coverage.
    ///
    /// # Errors
    ///
    /// Returns an error if the insert fails.
    pub fn store_embedding_chunk(
        &mut self,
        id: &str,
        item_id: &str,
        chunk_index: i32,
        chunk_text: &str,
        embedding: &[f32],
        provider: &str,
        model: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let dimensions = embedding.len() as i32;

        // Convert f32 slice to bytes (little-endian)
        let blob: Vec<u8> = embedding
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        self.conn.execute(
            "INSERT INTO embedding_chunks (id, item_id, chunk_index, chunk_text, embedding, dimensions, provider, model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(item_id, chunk_index) DO UPDATE SET
               chunk_text = excluded.chunk_text,
               embedding = excluded.embedding,
               dimensions = excluded.dimensions,
               provider = excluded.provider,
               model = excluded.model,
               created_at = excluded.created_at",
            rusqlite::params![id, item_id, chunk_index, chunk_text, blob, dimensions, provider, model, now],
        )?;

        // Update context_items embedding metadata
        self.conn.execute(
            "UPDATE context_items SET
               embedding_status = 'complete',
               embedding_provider = ?1,
               embedding_model = ?2,
               chunk_count = COALESCE(
                 (SELECT MAX(chunk_index) + 1 FROM embedding_chunks WHERE item_id = ?3),
                 1
               ),
               embedded_at = ?4
             WHERE id = ?3",
            rusqlite::params![provider, model, item_id, now],
        )?;

        Ok(())
    }

    /// Get embedding chunks for a context item.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_embedding_chunks(&self, item_id: &str) -> Result<Vec<EmbeddingChunk>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, item_id, chunk_index, chunk_text, embedding, dimensions, provider, model, created_at
             FROM embedding_chunks
             WHERE item_id = ?1
             ORDER BY chunk_index ASC",
        )?;

        let rows = stmt.query_map([item_id], |row| {
            let blob: Vec<u8> = row.get(4)?;
            let dimensions: i32 = row.get(5)?;

            // Convert bytes back to f32 vec
            let embedding: Vec<f32> = blob
                .chunks_exact(4)
                .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                .collect();

            Ok(EmbeddingChunk {
                id: row.get(0)?,
                item_id: row.get(1)?,
                chunk_index: row.get(2)?,
                chunk_text: row.get(3)?,
                embedding,
                dimensions: dimensions as usize,
                provider: row.get(6)?,
                model: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Get context items without embeddings (for backfill).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_items_without_embeddings(
        &self,
        session_id: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<ContextItem>> {
        let limit = limit.unwrap_or(100);

        let sql = if let Some(sid) = session_id {
            format!(
                "SELECT id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at
                 FROM context_items
                 WHERE session_id = '{}' AND (embedding_status IS NULL OR embedding_status IN ('none', 'pending', 'error'))
                 ORDER BY created_at DESC
                 LIMIT {}",
                sid, limit
            )
        } else {
            format!(
                "SELECT id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at
                 FROM context_items
                 WHERE embedding_status IS NULL OR embedding_status IN ('none', 'pending', 'error')
                 ORDER BY created_at DESC
                 LIMIT {}",
                limit
            )
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(ContextItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                channel: row.get(6)?,
                tags: row.get(7)?,
                size: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Count items with and without embeddings.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn count_embedding_status(&self, session_id: Option<&str>) -> Result<EmbeddingStats> {
        let (with_embeddings, without_embeddings) = if let Some(sid) = session_id {
            let with: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE session_id = ?1 AND embedding_status = 'complete'",
                [sid],
                |row| row.get(0),
            )?;
            let without: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE session_id = ?1 AND (embedding_status IS NULL OR embedding_status IN ('none', 'pending', 'error'))",
                [sid],
                |row| row.get(0),
            )?;
            (with, without)
        } else {
            let with: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE embedding_status = 'complete'",
                [],
                |row| row.get(0),
            )?;
            let without: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE embedding_status IS NULL OR embedding_status IN ('none', 'pending', 'error')",
                [],
                |row| row.get(0),
            )?;
            (with, without)
        };

        Ok(EmbeddingStats {
            with_embeddings: with_embeddings as usize,
            without_embeddings: without_embeddings as usize,
        })
    }

    /// Resync embedding status for items claiming 'complete' but lacking actual data.
    ///
    /// Migration 011 dropped the old vec_context_chunks table and reset statuses to
    /// 'pending', but subsequent logic set them back to 'complete' without actual
    /// embedding data. This method detects and fixes that mismatch.
    ///
    /// Returns the number of items reset.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn resync_embedding_status(&self) -> Result<usize> {
        let count = self.conn.execute(
            "UPDATE context_items SET embedding_status = 'pending'
             WHERE embedding_status = 'complete'
             AND id NOT IN (SELECT DISTINCT item_id FROM embedding_chunks)",
            [],
        )?;
        Ok(count)
    }

    /// Perform semantic search using cosine similarity.
    ///
    /// This is a brute-force search that computes cosine similarity
    /// between the query embedding and all stored embeddings.
    /// Efficient for <50K items; use Hora for larger datasets.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn semantic_search(
        &self,
        query_embedding: &[f32],
        session_id: Option<&str>,
        limit: usize,
        threshold: f32,
    ) -> Result<Vec<SemanticSearchResult>> {
        // Get all embedding chunks (optionally filtered by session)
        let sql = if let Some(sid) = session_id {
            format!(
                "SELECT ec.id, ec.item_id, ec.chunk_index, ec.chunk_text, ec.embedding, ec.dimensions,
                        ci.key, ci.value, ci.category, ci.priority
                 FROM embedding_chunks ec
                 INNER JOIN context_items ci ON ec.item_id = ci.id
                 WHERE ci.session_id = '{}'",
                sid
            )
        } else {
            "SELECT ec.id, ec.item_id, ec.chunk_index, ec.chunk_text, ec.embedding, ec.dimensions,
                    ci.key, ci.value, ci.category, ci.priority
             FROM embedding_chunks ec
             INNER JOIN context_items ci ON ec.item_id = ci.id".to_string()
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let blob: Vec<u8> = row.get(4)?;
            let embedding: Vec<f32> = blob
                .chunks_exact(4)
                .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                .collect();

            Ok((
                row.get::<_, String>(1)?, // item_id
                row.get::<_, i32>(2)?,    // chunk_index
                row.get::<_, String>(3)?, // chunk_text
                embedding,
                row.get::<_, String>(6)?, // key
                row.get::<_, String>(7)?, // value
                row.get::<_, String>(8)?, // category
                row.get::<_, String>(9)?, // priority
            ))
        })?;

        // Compute similarities and collect results
        let mut results: Vec<SemanticSearchResult> = rows
            .filter_map(|row| row.ok())
            .map(|(item_id, chunk_index, chunk_text, embedding, key, value, category, priority)| {
                let similarity = cosine_similarity(query_embedding, &embedding);
                SemanticSearchResult {
                    item_id,
                    chunk_index,
                    chunk_text,
                    similarity,
                    key,
                    value,
                    category,
                    priority,
                }
            })
            .filter(|r| r.similarity >= threshold)
            .collect();

        // Sort by similarity (highest first)
        results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));

        // Take top N results, deduplicating by item_id (keep highest similarity chunk)
        let mut seen_items = std::collections::HashSet::new();
        let deduped: Vec<SemanticSearchResult> = results
            .into_iter()
            .filter(|r| seen_items.insert(r.item_id.clone()))
            .take(limit)
            .collect();

        Ok(deduped)
    }

    /// Delete embeddings for a context item.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn delete_embeddings(&mut self, item_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM embedding_chunks WHERE item_id = ?1",
            [item_id],
        )?;

        self.conn.execute(
            "UPDATE context_items SET
               embedding_status = 'none',
               embedding_provider = NULL,
               embedding_model = NULL,
               chunk_count = 0,
               embedded_at = NULL
             WHERE id = ?1",
            [item_id],
        )?;

        Ok(())
    }

    /// Get embedding metadata (provider, model, dimensions).
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_embedding_meta(&self, key: &str) -> Result<Option<String>> {
        let value = self.conn.query_row(
            "SELECT value FROM embeddings_meta WHERE key = ?1",
            [key],
            |row| row.get(0),
        ).optional()?;
        Ok(value)
    }

    /// Set embedding metadata.
    ///
    /// # Errors
    ///
    /// Returns an error if the upsert fails.
    pub fn set_embedding_meta(&mut self, key: &str, value: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO embeddings_meta (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at",
            rusqlite::params![key, value, now],
        )?;
        Ok(())
    }

    // ========================================================================
    // Fast Tier Embeddings (2-tier architecture)
    // ========================================================================

    /// Store a fast-tier embedding chunk (Model2Vec).
    ///
    /// Fast tier embeddings are stored separately for dimension isolation.
    /// These are generated inline on save for instant semantic search.
    ///
    /// # Errors
    ///
    /// Returns an error if the insert fails.
    pub fn store_fast_embedding_chunk(
        &mut self,
        id: &str,
        item_id: &str,
        chunk_index: i32,
        chunk_text: &str,
        embedding: &[f32],
        model: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let dimensions = embedding.len() as i32;

        // Convert f32 slice to bytes (little-endian)
        let blob: Vec<u8> = embedding
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        self.conn.execute(
            "INSERT INTO embedding_chunks_fast (id, item_id, chunk_index, chunk_text, embedding, dimensions, provider, model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'model2vec', ?7, ?8)
             ON CONFLICT(item_id, chunk_index) DO UPDATE SET
               chunk_text = excluded.chunk_text,
               embedding = excluded.embedding,
               dimensions = excluded.dimensions,
               model = excluded.model,
               created_at = excluded.created_at",
            rusqlite::params![id, item_id, chunk_index, chunk_text, blob, dimensions, model, now],
        )?;

        // Update context_items fast embedding status
        self.conn.execute(
            "UPDATE context_items SET
               fast_embedding_status = 'complete',
               fast_embedded_at = ?1
             WHERE id = ?2",
            rusqlite::params![now, item_id],
        )?;

        Ok(())
    }

    /// Search fast-tier embeddings only.
    ///
    /// Returns candidates for tiered search or direct fast results.
    /// Fast tier is optimized for speed over accuracy.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn search_fast_tier(
        &self,
        query_embedding: &[f32],
        session_id: Option<&str>,
        limit: usize,
        threshold: f32,
    ) -> Result<Vec<SemanticSearchResult>> {
        // Get all fast embedding chunks (optionally filtered by session)
        let sql = if let Some(sid) = session_id {
            format!(
                "SELECT ec.id, ec.item_id, ec.chunk_index, ec.chunk_text, ec.embedding, ec.dimensions,
                        ci.key, ci.value, ci.category, ci.priority
                 FROM embedding_chunks_fast ec
                 INNER JOIN context_items ci ON ec.item_id = ci.id
                 WHERE ci.session_id = '{}'",
                sid
            )
        } else {
            "SELECT ec.id, ec.item_id, ec.chunk_index, ec.chunk_text, ec.embedding, ec.dimensions,
                    ci.key, ci.value, ci.category, ci.priority
             FROM embedding_chunks_fast ec
             INNER JOIN context_items ci ON ec.item_id = ci.id".to_string()
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let blob: Vec<u8> = row.get(4)?;
            let embedding: Vec<f32> = blob
                .chunks_exact(4)
                .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                .collect();

            Ok((
                row.get::<_, String>(1)?, // item_id
                row.get::<_, i32>(2)?,    // chunk_index
                row.get::<_, String>(3)?, // chunk_text
                embedding,
                row.get::<_, String>(6)?, // key
                row.get::<_, String>(7)?, // value
                row.get::<_, String>(8)?, // category
                row.get::<_, String>(9)?, // priority
            ))
        })?;

        // Compute similarities and collect results
        let mut results: Vec<SemanticSearchResult> = rows
            .filter_map(|row| row.ok())
            .map(|(item_id, chunk_index, chunk_text, embedding, key, value, category, priority)| {
                let similarity = cosine_similarity(query_embedding, &embedding);
                SemanticSearchResult {
                    item_id,
                    chunk_index,
                    chunk_text,
                    similarity,
                    key,
                    value,
                    category,
                    priority,
                }
            })
            .filter(|r| r.similarity >= threshold)
            .collect();

        // Sort by similarity (highest first)
        results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));

        // Take top N results, deduplicating by item_id
        let mut seen_items = std::collections::HashSet::new();
        let deduped: Vec<SemanticSearchResult> = results
            .into_iter()
            .filter(|r| seen_items.insert(r.item_id.clone()))
            .take(limit)
            .collect();

        Ok(deduped)
    }

    /// Get context items with fast embeddings but no quality embeddings.
    ///
    /// Used by background quality upgrade process.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn get_items_needing_quality_upgrade(
        &self,
        session_id: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<ContextItem>> {
        let limit = limit.unwrap_or(100);

        let sql = if let Some(sid) = session_id {
            format!(
                "SELECT id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at
                 FROM context_items
                 WHERE session_id = '{}'
                   AND fast_embedding_status = 'complete'
                   AND (embedding_status IS NULL OR embedding_status = 'none' OR embedding_status = 'pending')
                 ORDER BY created_at DESC
                 LIMIT {}",
                sid, limit
            )
        } else {
            format!(
                "SELECT id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at
                 FROM context_items
                 WHERE fast_embedding_status = 'complete'
                   AND (embedding_status IS NULL OR embedding_status = 'none' OR embedding_status = 'pending')
                 ORDER BY created_at DESC
                 LIMIT {}",
                limit
            )
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(ContextItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                channel: row.get(6)?,
                tags: row.get(7)?,
                size: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)
    }

    /// Delete fast-tier embeddings for a context item.
    ///
    /// # Errors
    ///
    /// Returns an error if the delete fails.
    pub fn delete_fast_embeddings(&mut self, item_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM embedding_chunks_fast WHERE item_id = ?1",
            [item_id],
        )?;

        self.conn.execute(
            "UPDATE context_items SET
               fast_embedding_status = 'none',
               fast_embedded_at = NULL
             WHERE id = ?1",
            [item_id],
        )?;

        Ok(())
    }

    /// Count fast embedding status.
    ///
    /// # Errors
    ///
    /// Returns an error if the query fails.
    pub fn count_fast_embedding_status(&self, session_id: Option<&str>) -> Result<EmbeddingStats> {
        let (with_embeddings, without_embeddings) = if let Some(sid) = session_id {
            let with: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE session_id = ?1 AND fast_embedding_status = 'complete'",
                [sid],
                |row| row.get(0),
            )?;
            let without: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE session_id = ?1 AND (fast_embedding_status IS NULL OR fast_embedding_status = 'none')",
                [sid],
                |row| row.get(0),
            )?;
            (with, without)
        } else {
            let with: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE fast_embedding_status = 'complete'",
                [],
                |row| row.get(0),
            )?;
            let without: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM context_items WHERE fast_embedding_status IS NULL OR fast_embedding_status = 'none'",
                [],
                |row| row.get(0),
            )?;
            (with, without)
        };

        Ok(EmbeddingStats {
            with_embeddings: with_embeddings as usize,
            without_embeddings: without_embeddings as usize,
        })
    }
}

// Helper to map plan rows
fn map_plan_row(row: &rusqlite::Row) -> rusqlite::Result<Plan> {
    let status_str: String = row.get(6)?;
    Ok(Plan {
        id: row.get(0)?,
        short_id: row.get(1)?,
        project_id: row.get(2)?,
        project_path: row.get(3)?,
        title: row.get(4)?,
        content: row.get(5)?,
        status: PlanStatus::from_str(&status_str),
        success_criteria: row.get(7)?,
        session_id: row.get(8)?,
        created_in_session: row.get(9)?,
        completed_in_session: row.get(10)?,
        source_path: row.get(11)?,
        source_hash: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        completed_at: row.get(15)?,
    })
}

// Helper to map project rows
fn map_project_row(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        project_path: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        issue_prefix: row.get(4)?,
        next_issue_number: row.get(5)?,
        plan_prefix: row.get(6)?,
        next_plan_number: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

// Helper to map issue rows
fn map_issue_row(row: &rusqlite::Row) -> rusqlite::Result<Issue> {
    Ok(Issue {
        id: row.get(0)?,
        short_id: row.get(1)?,
        project_path: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        details: row.get(5)?,
        status: row.get(6)?,
        priority: row.get(7)?,
        issue_type: row.get(8)?,
        plan_id: row.get(9)?,
        created_by_agent: row.get(10)?,
        assigned_to_agent: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        closed_at: row.get(14)?,
    })
}

// ==================
// Data Structures
// ==================

/// A session record.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub branch: Option<String>,
    pub channel: Option<String>,
    pub project_path: Option<String>,
    pub status: String,
    pub ended_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A context item record.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ContextItem {
    pub id: String,
    pub session_id: String,
    pub key: String,
    pub value: String,
    pub category: String,
    pub priority: String,
    pub channel: Option<String>,
    pub tags: Option<String>,
    pub size: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// An issue record.
/// Note: Parent-child relationships are stored in issue_dependencies table.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Issue {
    pub id: String,
    pub short_id: Option<String>,
    pub project_path: String,
    pub title: String,
    pub description: Option<String>,
    pub details: Option<String>,
    pub status: String,
    pub priority: i32,
    pub issue_type: String,
    pub plan_id: Option<String>,
    pub created_by_agent: Option<String>,
    pub assigned_to_agent: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
}

/// Progress tracking for an epic (child issue counts by status).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct EpicProgress {
    pub total: usize,
    pub closed: usize,
    pub in_progress: usize,
    pub open: usize,
    pub blocked: usize,
    pub deferred: usize,
}

/// A checkpoint record.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub description: Option<String>,
    pub git_status: Option<String>,
    pub git_branch: Option<String>,
    pub created_at: i64,
    pub item_count: i64,
}

/// A memory record (project-level persistent storage).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Memory {
    pub id: String,
    pub project_path: String,
    pub key: String,
    pub value: String,
    pub category: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A sync deletion record (tracks what was deleted for sync).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncDeletion {
    /// Internal database ID.
    pub id: i64,
    /// The type of entity that was deleted (session, issue, etc.).
    pub entity_type: String,
    /// The ID of the deleted entity.
    pub entity_id: String,
    /// The project path this deletion belongs to.
    pub project_path: String,
    /// Unix timestamp (milliseconds) when the deletion occurred.
    pub deleted_at: i64,
    /// Actor who performed the deletion.
    pub deleted_by: String,
}

/// An embedding chunk record.
///
/// Embeddings are stored as BLOB (binary f32 arrays) for efficiency.
/// Large context items may be split into multiple chunks for better semantic coverage.
#[derive(Debug, Clone, serde::Serialize)]
pub struct EmbeddingChunk {
    /// Unique ID for this chunk.
    pub id: String,
    /// The context item this chunk belongs to.
    pub item_id: String,
    /// Chunk index (0 for single-chunk items).
    pub chunk_index: i32,
    /// The text that was embedded.
    pub chunk_text: String,
    /// The embedding vector (f32 values).
    pub embedding: Vec<f32>,
    /// Number of dimensions in the embedding.
    pub dimensions: usize,
    /// Provider that generated this embedding (e.g., "ollama").
    pub provider: String,
    /// Model used for embedding (e.g., "nomic-embed-text").
    pub model: String,
    /// Unix timestamp (milliseconds) when created.
    pub created_at: i64,
}

/// Embedding statistics for a session or globally.
#[derive(Debug, Clone, serde::Serialize)]
pub struct EmbeddingStats {
    /// Number of items with embeddings.
    pub with_embeddings: usize,
    /// Number of items without embeddings.
    pub without_embeddings: usize,
}

/// A semantic search result.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SemanticSearchResult {
    /// The context item ID.
    pub item_id: String,
    /// Which chunk matched (0 for single-chunk items).
    pub chunk_index: i32,
    /// The text that was matched.
    pub chunk_text: String,
    /// Cosine similarity score (0.0 to 1.0).
    pub similarity: f32,
    /// Context item key.
    pub key: String,
    /// Context item value.
    pub value: String,
    /// Context item category.
    pub category: String,
    /// Context item priority.
    pub priority: String,
}

/// Compute cosine similarity between two vectors.
///
/// Returns a value between -1.0 and 1.0, where:
/// - 1.0 means identical direction
/// - 0.0 means orthogonal (no similarity)
/// - -1.0 means opposite direction
///
/// For normalized embeddings (which most models produce), this is equivalent
/// to the dot product.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot_product = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for (x, y) in a.iter().zip(b.iter()) {
        dot_product += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    let magnitude = (norm_a * norm_b).sqrt();
    if magnitude == 0.0 {
        0.0
    } else {
        dot_product / magnitude
    }
}

/// Generate a short ID (4 hex chars based on timestamp).
fn generate_short_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{:04x}", (now & 0xFFFF) as u16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_memory() {
        let storage = SqliteStorage::open_memory();
        assert!(storage.is_ok());
    }

    #[test]
    fn test_session_crud() {
        let mut storage = SqliteStorage::open_memory().unwrap();

        // Create
        storage
            .create_session(
                "sess_1",
                "Test Session",
                Some("A test session"),
                Some("/test/project"),
                Some("main"),
                "test-actor",
            )
            .unwrap();

        // Read
        let session = storage.get_session("sess_1").unwrap();
        assert!(session.is_some());
        let session = session.unwrap();
        assert_eq!(session.name, "Test Session");
        assert_eq!(session.status, "active");

        // List
        let sessions = storage
            .list_sessions(Some("/test/project"), None, None)
            .unwrap();
        assert_eq!(sessions.len(), 1);

        // Update status
        storage
            .update_session_status("sess_1", "completed", "test-actor")
            .unwrap();
        let session = storage.get_session("sess_1").unwrap().unwrap();
        assert_eq!(session.status, "completed");
        assert!(session.ended_at.is_some());
    }

    #[test]
    fn test_context_item_crud() {
        let mut storage = SqliteStorage::open_memory().unwrap();

        // Create session first
        storage
            .create_session("sess_1", "Test", None, None, None, "actor")
            .unwrap();

        // Save item
        storage
            .save_context_item(
                "item_1",
                "sess_1",
                "test-key",
                "test value",
                Some("note"),
                Some("high"),
                "actor",
            )
            .unwrap();

        // Get items
        let items = storage.get_context_items("sess_1", None, None, None).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].key, "test-key");
        assert_eq!(items[0].priority, "high");

        // Update (upsert)
        storage
            .save_context_item(
                "item_1",
                "sess_1",
                "test-key",
                "updated value",
                Some("decision"),
                None,
                "actor",
            )
            .unwrap();

        let items = storage.get_context_items("sess_1", None, None, None).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].value, "updated value");

        // Delete
        storage
            .delete_context_item("sess_1", "test-key", "actor")
            .unwrap();
        let items = storage.get_context_items("sess_1", None, None, None).unwrap();
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn test_issue_crud() {
        let mut storage = SqliteStorage::open_memory().unwrap();

        // Create
        storage
            .create_issue(
                "issue_1",
                Some("TST-1"),
                "/test/project",
                "Test Issue",
                Some("Description"),
                None,         // details
                Some("task"), // issue_type
                Some(3),      // priority
                None,         // plan_id
                "actor",
            )
            .unwrap();

        // Get by full ID
        let issue = storage.get_issue("issue_1", None).unwrap();
        assert!(issue.is_some());
        let issue = issue.unwrap();
        assert_eq!(issue.title, "Test Issue");
        assert_eq!(issue.priority, 3);

        // Get by short ID
        let issue = storage
            .get_issue("TST-1", Some("/test/project"))
            .unwrap();
        assert!(issue.is_some());

        // List
        let issues = storage
            .list_issues("/test/project", None, None, None)
            .unwrap();
        assert_eq!(issues.len(), 1);

        // Claim
        storage.claim_issue("issue_1", "agent-1").unwrap();
        let issue = storage.get_issue("issue_1", None).unwrap().unwrap();
        assert_eq!(issue.assigned_to_agent, Some("agent-1".to_string()));
        assert_eq!(issue.status, "in_progress");

        // Release
        storage.release_issue("issue_1", "agent-1").unwrap();
        let issue = storage.get_issue("issue_1", None).unwrap().unwrap();
        assert!(issue.assigned_to_agent.is_none());
        assert_eq!(issue.status, "open");

        // Close
        storage
            .update_issue_status("issue_1", "closed", "actor")
            .unwrap();
        let issue = storage.get_issue("issue_1", None).unwrap().unwrap();
        assert_eq!(issue.status, "closed");
        assert!(issue.closed_at.is_some());
    }

    // --- Embeddings storage tests ---

    #[test]
    fn test_get_items_without_embeddings_includes_pending() {
        let mut storage = SqliteStorage::open_memory().unwrap();
        storage
            .create_session("sess_1", "Test", None, None, None, "actor")
            .unwrap();

        // Create items with different embedding statuses
        for (id, key, status) in [
            ("item_1", "none-status", "none"),
            ("item_2", "pending-status", "pending"),
            ("item_3", "error-status", "error"),
            ("item_4", "complete-status", "complete"),
        ] {
            storage
                .save_context_item(id, "sess_1", key, "test value", Some("note"), Some("normal"), "actor")
                .unwrap();
            storage.conn.execute(
                "UPDATE context_items SET embedding_status = ?1 WHERE id = ?2",
                rusqlite::params![status, id],
            ).unwrap();
        }

        // Also create one with NULL status (never processed)
        storage
            .save_context_item("item_5", "sess_1", "null-status", "test", Some("note"), Some("normal"), "actor")
            .unwrap();
        storage.conn.execute(
            "UPDATE context_items SET embedding_status = NULL WHERE id = 'item_5'",
            [],
        ).unwrap();

        let items = storage.get_items_without_embeddings(None, None).unwrap();
        let keys: Vec<&str> = items.iter().map(|i| i.key.as_str()).collect();

        // Should include: none, pending, error, NULL
        assert!(keys.contains(&"none-status"), "missing 'none' status");
        assert!(keys.contains(&"pending-status"), "missing 'pending' status");
        assert!(keys.contains(&"error-status"), "missing 'error' status");
        assert!(keys.contains(&"null-status"), "missing NULL status");

        // Should NOT include: complete
        assert!(!keys.contains(&"complete-status"), "'complete' should be excluded");
        assert_eq!(items.len(), 4);
    }

    #[test]
    fn test_get_items_without_embeddings_session_filter() {
        let mut storage = SqliteStorage::open_memory().unwrap();
        storage.create_session("sess_1", "Session 1", None, None, None, "actor").unwrap();
        storage.create_session("sess_2", "Session 2", None, None, None, "actor").unwrap();

        storage.save_context_item("item_1", "sess_1", "s1-item", "val", Some("note"), Some("normal"), "actor").unwrap();
        storage.save_context_item("item_2", "sess_2", "s2-item", "val", Some("note"), Some("normal"), "actor").unwrap();

        // Reset both to pending
        storage.conn.execute("UPDATE context_items SET embedding_status = 'pending'", []).unwrap();

        // Filter by session
        let s1_items = storage.get_items_without_embeddings(Some("sess_1"), None).unwrap();
        assert_eq!(s1_items.len(), 1);
        assert_eq!(s1_items[0].key, "s1-item");

        // No filter returns both
        let all_items = storage.get_items_without_embeddings(None, None).unwrap();
        assert_eq!(all_items.len(), 2);
    }

    #[test]
    fn test_resync_embedding_status() {
        let mut storage = SqliteStorage::open_memory().unwrap();
        storage.create_session("sess_1", "Test", None, None, None, "actor").unwrap();

        // Create items
        storage.save_context_item("item_1", "sess_1", "phantom", "val", Some("note"), Some("normal"), "actor").unwrap();
        storage.save_context_item("item_2", "sess_1", "real", "val", Some("note"), Some("normal"), "actor").unwrap();
        storage.save_context_item("item_3", "sess_1", "pending-already", "val", Some("note"), Some("normal"), "actor").unwrap();

        // Mark all as complete
        storage.conn.execute("UPDATE context_items SET embedding_status = 'complete'", []).unwrap();
        // Mark item_3 as pending (shouldn't be touched)
        storage.conn.execute("UPDATE context_items SET embedding_status = 'pending' WHERE id = 'item_3'", []).unwrap();

        // Add actual embedding data ONLY for item_2
        storage.conn.execute(
            "INSERT INTO embedding_chunks (id, item_id, chunk_index, chunk_text, embedding, dimensions, provider, model, created_at)
             VALUES ('ec_1', 'item_2', 0, 'test', X'00000000', 1, 'test', 'test-model', 1000)",
            [],
        ).unwrap();

        // Resync: item_1 claims complete but has no data -> should reset to pending
        let count = storage.resync_embedding_status().unwrap();
        assert_eq!(count, 1, "only item_1 should be reset (phantom complete)");

        // Verify states
        let status_1: String = storage.conn.query_row(
            "SELECT embedding_status FROM context_items WHERE id = 'item_1'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(status_1, "pending", "phantom complete should be reset");

        let status_2: String = storage.conn.query_row(
            "SELECT embedding_status FROM context_items WHERE id = 'item_2'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(status_2, "complete", "real complete should be untouched");

        let status_3: String = storage.conn.query_row(
            "SELECT embedding_status FROM context_items WHERE id = 'item_3'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(status_3, "pending", "already-pending should be untouched");
    }
}
