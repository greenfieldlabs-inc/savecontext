//! Atomic file operations for sync.
//!
//! This module provides safe file operations that prevent data corruption:
//! - Atomic writes: write to temp file, sync to disk, then rename
//! - JSONL appending with fsync for durability

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;

use crate::sync::types::{SyncError, SyncRecord, SyncResult};

/// Write content to a file atomically.
///
/// This function:
/// 1. Writes content to a temporary file (same path with `.tmp` extension)
/// 2. Calls `fsync` to ensure data is on disk
/// 3. Atomically renames the temp file to the target path
///
/// If any step fails, the original file (if any) remains untouched.
///
/// # Errors
///
/// Returns an error if any file operation fails.
pub fn atomic_write(path: &Path, content: &str) -> SyncResult<()> {
    let temp_path = path.with_extension("jsonl.tmp");

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Write to temp file
    {
        let file = File::create(&temp_path)?;
        let mut writer = BufWriter::new(file);
        writer.write_all(content.as_bytes())?;
        writer.flush()?;
        // Sync to disk before rename
        writer.get_ref().sync_all()?;
    }

    // Atomic rename
    fs::rename(&temp_path, path)?;

    Ok(())
}

/// Append a sync record to a JSONL file.
///
/// Each record is serialized as a single JSON line and appended to the file.
/// The file is synced after each append for durability.
///
/// # Errors
///
/// Returns an error if the file cannot be opened or written.
pub fn append_jsonl(path: &Path, record: &SyncRecord) -> SyncResult<()> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;

    let line = serde_json::to_string(record)?;
    writeln!(file, "{line}")?;
    file.sync_all()?;

    Ok(())
}

/// Write multiple sync records to a JSONL file atomically.
///
/// This is more efficient than calling `append_jsonl` repeatedly when
/// exporting multiple records, as it writes all records in one operation.
///
/// # Errors
///
/// Returns an error if the file cannot be written.
pub fn write_jsonl(path: &Path, records: &[SyncRecord]) -> SyncResult<()> {
    let mut content = String::new();
    for record in records {
        let line = serde_json::to_string(record)?;
        content.push_str(&line);
        content.push('\n');
    }
    atomic_write(path, &content)
}

/// Read all sync records from a JSONL file.
///
/// Each line is parsed as a `SyncRecord`. Invalid lines cause an error
/// with the line number for debugging.
///
/// # Errors
///
/// Returns an error if:
/// - The file cannot be opened
/// - Any line cannot be parsed as a valid `SyncRecord`
pub fn read_jsonl(path: &Path) -> SyncResult<Vec<SyncRecord>> {
    if !path.exists() {
        return Err(SyncError::FileNotFound(path.display().to_string()));
    }

    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut records = Vec::new();

    for (line_num, line_result) in reader.lines().enumerate() {
        let line = line_result?;
        if line.trim().is_empty() {
            continue;
        }

        let record: SyncRecord = serde_json::from_str(&line).map_err(|e| {
            SyncError::InvalidRecord {
                line: line_num + 1,
                message: e.to_string(),
            }
        })?;
        records.push(record);
    }

    Ok(records)
}

/// Count the number of lines in a JSONL file.
///
/// This is useful for showing statistics without loading all records into memory.
///
/// # Errors
///
/// Returns an error if the file cannot be read.
pub fn count_lines(path: &Path) -> SyncResult<usize> {
    if !path.exists() {
        return Ok(0);
    }

    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let count = reader.lines().filter(|l| l.is_ok()).count();
    Ok(count)
}

/// Get the size of a file in bytes.
///
/// Returns 0 if the file doesn't exist.
pub fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Generate .gitignore content for the .savecontext directory.
///
/// Uses a whitelist pattern: ignore everything by default, then explicitly
/// include only the JSONL sync files that should be tracked in git.
///
/// This prevents accidentally committing:
/// - The SQLite database
/// - Temporary files
/// - Any future files that shouldn't be tracked
#[must_use]
pub fn gitignore_content() -> &'static str {
    r#"# SaveContext sync directory
# Whitelist pattern: ignore everything except JSONL export files

# Ignore everything by default
*

# Allow .gitignore itself
!.gitignore

# Allow JSONL sync files (git-friendly format)
!*.jsonl
"#
}

/// Ensure .gitignore exists in the export directory.
///
/// Creates a .gitignore file with whitelist pattern if it doesn't exist.
/// If the file already exists, it is not modified (user may have customized it).
///
/// # Errors
///
/// Returns an error if the file cannot be written.
pub fn ensure_gitignore(export_dir: &Path) -> SyncResult<()> {
    let gitignore_path = export_dir.join(".gitignore");

    if gitignore_path.exists() {
        return Ok(());
    }

    // Ensure directory exists
    fs::create_dir_all(export_dir)?;

    // Write .gitignore
    let mut file = File::create(&gitignore_path)?;
    file.write_all(gitignore_content().as_bytes())?;
    file.sync_all()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sqlite::Session;
    use crate::sync::types::SessionRecord;
    use tempfile::TempDir;

    fn make_test_session(id: &str) -> Session {
        Session {
            id: id.to_string(),
            name: "Test Session".to_string(),
            description: None,
            branch: None,
            channel: None,
            project_path: Some("/test".to_string()),
            status: "active".to_string(),
            ended_at: None,
            created_at: 1000,
            updated_at: 1000,
        }
    }

    #[test]
    fn test_atomic_write() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("test.jsonl");

        atomic_write(&path, "line 1\nline 2\n").unwrap();

        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "line 1\nline 2\n");
    }

    #[test]
    fn test_append_jsonl() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("sessions.jsonl");

        let record = SyncRecord::Session(SessionRecord {
            data: make_test_session("sess_1"),
            content_hash: "abc123".to_string(),
            exported_at: "2025-01-20T00:00:00Z".to_string(),
        });

        append_jsonl(&path, &record).unwrap();
        append_jsonl(&path, &record).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let lines: Vec<_> = content.lines().filter(|l| !l.is_empty()).collect();
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn test_read_jsonl() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("sessions.jsonl");

        let record1 = SyncRecord::Session(SessionRecord {
            data: make_test_session("sess_1"),
            content_hash: "abc123".to_string(),
            exported_at: "2025-01-20T00:00:00Z".to_string(),
        });
        let record2 = SyncRecord::Session(SessionRecord {
            data: make_test_session("sess_2"),
            content_hash: "def456".to_string(),
            exported_at: "2025-01-20T00:00:01Z".to_string(),
        });

        write_jsonl(&path, &[record1, record2]).unwrap();

        let records = read_jsonl(&path).unwrap();
        assert_eq!(records.len(), 2);
    }

    #[test]
    fn test_count_lines() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("test.jsonl");

        // Non-existent file
        assert_eq!(count_lines(&path).unwrap(), 0);

        // File with content
        fs::write(&path, "line1\nline2\nline3\n").unwrap();
        assert_eq!(count_lines(&path).unwrap(), 3);
    }

    #[test]
    fn test_file_not_found() {
        let result = read_jsonl(Path::new("/nonexistent/file.jsonl"));
        assert!(matches!(result, Err(SyncError::FileNotFound(_))));
    }

    #[test]
    fn test_gitignore_content() {
        let content = gitignore_content();

        // Should contain whitelist pattern
        assert!(content.contains("*"), "Should ignore everything by default");
        assert!(content.contains("!*.jsonl"), "Should whitelist JSONL files");
        assert!(content.contains("!.gitignore"), "Should whitelist itself");
    }

    #[test]
    fn test_ensure_gitignore_creates_file() {
        let temp_dir = TempDir::new().unwrap();
        let gitignore_path = temp_dir.path().join(".gitignore");

        // Should not exist yet
        assert!(!gitignore_path.exists());

        ensure_gitignore(temp_dir.path()).unwrap();

        // Should now exist
        assert!(gitignore_path.exists());

        // Verify content
        let content = fs::read_to_string(&gitignore_path).unwrap();
        assert!(content.contains("!*.jsonl"));
    }

    #[test]
    fn test_ensure_gitignore_does_not_overwrite() {
        let temp_dir = TempDir::new().unwrap();
        let gitignore_path = temp_dir.path().join(".gitignore");

        // Create custom gitignore
        fs::write(&gitignore_path, "# Custom content\n*.tmp\n").unwrap();

        // Should not overwrite
        ensure_gitignore(temp_dir.path()).unwrap();

        let content = fs::read_to_string(&gitignore_path).unwrap();
        assert!(content.contains("Custom content"));
        assert!(!content.contains("!*.jsonl"));
    }
}
