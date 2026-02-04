//! Content hashing for sync operations.
//!
//! This module provides SHA256-based content hashing for change detection.
//! By hashing the serialized JSON of a record, we can detect changes without
//! comparing every field.

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Compute a SHA256 hash of a serializable value.
///
/// The value is first serialized to JSON, then hashed. This provides a
/// deterministic fingerprint of the content that can be used for:
/// - Detecting if a record has changed since last export
/// - Comparing local vs external records during import
///
/// # Panics
///
/// Panics if the value cannot be serialized to JSON. This should never happen
/// for our data types which are all serializable.
///
/// # Example
///
/// ```ignore
/// let session = Session { id: "sess_1".into(), ... };
/// let hash = content_hash(&session);
/// // hash is something like "a1b2c3d4..."
/// ```
#[must_use]
pub fn content_hash<T: Serialize>(value: &T) -> String {
    let json = serde_json::to_string(value).expect("serialization should not fail");
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Check if an entity has changed since last export.
///
/// Returns `true` if:
/// - There is no stored hash (never exported)
/// - The current hash differs from the stored hash
///
/// Returns `false` if the hashes match (no change).
#[must_use]
pub fn has_changed(current_hash: &str, stored_hash: Option<&str>) -> bool {
    stored_hash.map_or(true, |h| h != current_hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    struct TestRecord {
        id: String,
        value: i32,
    }

    #[test]
    fn test_content_hash_deterministic() {
        let record = TestRecord {
            id: "test_1".into(),
            value: 42,
        };

        let hash1 = content_hash(&record);
        let hash2 = content_hash(&record);

        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // SHA256 produces 64 hex chars
    }

    #[test]
    fn test_content_hash_changes_with_content() {
        let record1 = TestRecord {
            id: "test_1".into(),
            value: 42,
        };
        let record2 = TestRecord {
            id: "test_1".into(),
            value: 43, // Different value
        };

        let hash1 = content_hash(&record1);
        let hash2 = content_hash(&record2);

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_has_changed_no_stored_hash() {
        assert!(has_changed("abc123", None));
    }

    #[test]
    fn test_has_changed_different_hash() {
        assert!(has_changed("abc123", Some("xyz789")));
    }

    #[test]
    fn test_has_changed_same_hash() {
        assert!(!has_changed("abc123", Some("abc123")));
    }
}
