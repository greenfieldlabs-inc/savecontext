//! Audit event storage and retrieval.
//!
//! Events track all mutations in the database for debugging and history.

use rusqlite::{Connection, Result};

/// Event types for audit logging.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventType {
    // Session events
    SessionCreated,
    SessionUpdated,
    SessionPaused,
    SessionCompleted,
    SessionDeleted,
    SessionPathAdded,
    SessionPathRemoved,

    // Context item events
    ItemCreated,
    ItemUpdated,
    ItemDeleted,

    // Issue events
    IssueCreated,
    IssueUpdated,
    IssueClosed,
    IssueClaimed,
    IssueReleased,
    IssueDeleted,

    // Checkpoint events
    CheckpointCreated,
    CheckpointRestored,
    CheckpointDeleted,

    // Plan events
    PlanCreated,
    PlanUpdated,
    PlanCompleted,

    // Memory events
    MemorySaved,
    MemoryDeleted,

    // Project events
    ProjectCreated,
    ProjectUpdated,
    ProjectDeleted,
}

impl EventType {
    /// Get the string representation for storage.
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::SessionCreated => "session_created",
            Self::SessionUpdated => "session_updated",
            Self::SessionPaused => "session_paused",
            Self::SessionCompleted => "session_completed",
            Self::SessionDeleted => "session_deleted",
            Self::SessionPathAdded => "session_path_added",
            Self::SessionPathRemoved => "session_path_removed",
            Self::ItemCreated => "item_created",
            Self::ItemUpdated => "item_updated",
            Self::ItemDeleted => "item_deleted",
            Self::IssueCreated => "issue_created",
            Self::IssueUpdated => "issue_updated",
            Self::IssueClosed => "issue_closed",
            Self::IssueClaimed => "issue_claimed",
            Self::IssueReleased => "issue_released",
            Self::IssueDeleted => "issue_deleted",
            Self::CheckpointCreated => "checkpoint_created",
            Self::CheckpointRestored => "checkpoint_restored",
            Self::CheckpointDeleted => "checkpoint_deleted",
            Self::PlanCreated => "plan_created",
            Self::PlanUpdated => "plan_updated",
            Self::PlanCompleted => "plan_completed",
            Self::MemorySaved => "memory_saved",
            Self::MemoryDeleted => "memory_deleted",
            Self::ProjectCreated => "project_created",
            Self::ProjectUpdated => "project_updated",
            Self::ProjectDeleted => "project_deleted",
        }
    }
}

/// An audit event record.
#[derive(Debug, Clone)]
pub struct Event {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub event_type: EventType,
    pub actor: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub comment: Option<String>,
    pub created_at: i64,
}

impl Event {
    /// Create a new event (id will be assigned by database).
    #[must_use]
    pub fn new(
        entity_type: &str,
        entity_id: &str,
        event_type: EventType,
        actor: &str,
    ) -> Self {
        Self {
            id: 0,
            entity_type: entity_type.to_string(),
            entity_id: entity_id.to_string(),
            event_type,
            actor: actor.to_string(),
            old_value: None,
            new_value: None,
            comment: None,
            created_at: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// Add old/new values for field change tracking.
    #[must_use]
    pub fn with_values(mut self, old: Option<String>, new: Option<String>) -> Self {
        self.old_value = old;
        self.new_value = new;
        self
    }

    /// Add a comment to the event.
    #[must_use]
    pub fn with_comment(mut self, comment: &str) -> Self {
        self.comment = Some(comment.to_string());
        self
    }
}

/// Insert an event into the database.
///
/// # Errors
///
/// Returns an error if the insert fails.
pub fn insert_event(conn: &Connection, event: &Event) -> Result<i64> {
    conn.execute(
        "INSERT INTO events (entity_type, entity_id, event_type, actor, old_value, new_value, comment, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            event.entity_type,
            event.entity_id,
            event.event_type.as_str(),
            event.actor,
            event.old_value,
            event.new_value,
            event.comment,
            event.created_at,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Get events for an entity.
///
/// # Errors
///
/// Returns an error if the query fails.
pub fn get_events(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    limit: Option<u32>,
) -> Result<Vec<Event>> {
    let limit = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        "SELECT id, entity_type, entity_id, event_type, actor, old_value, new_value, comment, created_at
         FROM events
         WHERE entity_type = ?1 AND entity_id = ?2
         ORDER BY created_at DESC
         LIMIT ?3",
    )?;

    let rows = stmt.query_map(rusqlite::params![entity_type, entity_id, limit], |row| {
        Ok(Event {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            event_type: parse_event_type(row.get::<_, String>(3)?.as_str()),
            actor: row.get(4)?,
            old_value: row.get(5)?,
            new_value: row.get(6)?,
            comment: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;

    rows.collect()
}

fn parse_event_type(s: &str) -> EventType {
    match s {
        "session_created" => EventType::SessionCreated,
        "session_updated" => EventType::SessionUpdated,
        "session_paused" => EventType::SessionPaused,
        "session_completed" => EventType::SessionCompleted,
        "session_deleted" => EventType::SessionDeleted,
        "session_path_added" => EventType::SessionPathAdded,
        "session_path_removed" => EventType::SessionPathRemoved,
        "item_created" => EventType::ItemCreated,
        "item_updated" => EventType::ItemUpdated,
        "item_deleted" => EventType::ItemDeleted,
        "issue_created" => EventType::IssueCreated,
        "issue_updated" => EventType::IssueUpdated,
        "issue_closed" => EventType::IssueClosed,
        "issue_claimed" => EventType::IssueClaimed,
        "issue_released" => EventType::IssueReleased,
        "issue_deleted" => EventType::IssueDeleted,
        "checkpoint_created" => EventType::CheckpointCreated,
        "checkpoint_restored" => EventType::CheckpointRestored,
        "checkpoint_deleted" => EventType::CheckpointDeleted,
        "plan_created" => EventType::PlanCreated,
        "plan_updated" => EventType::PlanUpdated,
        "plan_completed" => EventType::PlanCompleted,
        "memory_saved" => EventType::MemorySaved,
        "memory_deleted" => EventType::MemoryDeleted,
        "project_created" => EventType::ProjectCreated,
        "project_updated" => EventType::ProjectUpdated,
        "project_deleted" => EventType::ProjectDeleted,
        _ => EventType::SessionUpdated, // Fallback
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::schema::apply_schema;

    #[test]
    fn test_event_insert_and_get() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        let event = Event::new("session", "sess_123", EventType::SessionCreated, "test-actor")
            .with_comment("Test session created");

        let id = insert_event(&conn, &event).unwrap();
        assert!(id > 0);

        let events = get_events(&conn, "session", "sess_123", Some(10)).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].actor, "test-actor");
        assert_eq!(events[0].comment, Some("Test session created".to_string()));
    }
}
