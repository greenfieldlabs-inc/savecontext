//! Input validation and intent detection for agent ergonomics.
//!
//! Provides O(1) validation sets and synonym maps so agents can use
//! natural language for statuses, types, and priorities. Three-tier
//! resolution: exact match → synonym lookup → error with suggestion.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

// ── Valid value sets (O(1) lookups) ──────────────────────────

pub static VALID_STATUSES: LazyLock<HashSet<&str>> = LazyLock::new(|| {
    ["backlog", "open", "in_progress", "blocked", "closed", "deferred"]
        .into_iter()
        .collect()
});

pub static VALID_TYPES: LazyLock<HashSet<&str>> = LazyLock::new(|| {
    ["task", "bug", "feature", "epic", "chore"]
        .into_iter()
        .collect()
});

// ── Synonym maps (agent typo recovery) ───────────────────────

pub static STATUS_SYNONYMS: LazyLock<HashMap<&str, &str>> = LazyLock::new(|| {
    [
        ("done", "closed"),
        ("complete", "closed"),
        ("completed", "closed"),
        ("finished", "closed"),
        ("resolved", "closed"),
        ("wontfix", "closed"),
        ("wip", "in_progress"),
        ("working", "in_progress"),
        ("active", "in_progress"),
        ("started", "in_progress"),
        ("new", "open"),
        ("todo", "open"),
        ("pending", "open"),
        ("waiting", "blocked"),
        ("hold", "deferred"),
        ("later", "deferred"),
        ("postponed", "deferred"),
    ]
    .into_iter()
    .collect()
});

pub static TYPE_SYNONYMS: LazyLock<HashMap<&str, &str>> = LazyLock::new(|| {
    [
        ("story", "feature"),
        ("enhancement", "feature"),
        ("improvement", "feature"),
        ("issue", "bug"),
        ("defect", "bug"),
        ("problem", "bug"),
        ("ticket", "task"),
        ("item", "task"),
        ("work", "task"),
        ("cleanup", "chore"),
        ("refactor", "chore"),
        ("maintenance", "chore"),
        ("parent", "epic"),
        ("initiative", "epic"),
    ]
    .into_iter()
    .collect()
});

/// Priority synonyms map to string digits.
/// SaveContext: 0=lowest, 4=critical.
pub static PRIORITY_SYNONYMS: LazyLock<HashMap<&str, &str>> = LazyLock::new(|| {
    [
        ("critical", "4"),
        ("crit", "4"),
        ("urgent", "4"),
        ("highest", "4"),
        ("high", "3"),
        ("important", "3"),
        ("medium", "2"),
        ("normal", "2"),
        ("default", "2"),
        ("low", "1"),
        ("minor", "1"),
        ("backlog", "0"),
        ("lowest", "0"),
        ("trivial", "0"),
    ]
    .into_iter()
    .collect()
});

/// Normalize a status string via exact match or synonym lookup.
///
/// Returns the canonical status, or an error with the original input
/// and an optional suggestion.
pub fn normalize_status(input: &str) -> Result<String, (String, Option<String>)> {
    let lower = input.to_lowercase();

    // Tier 1: exact match
    if VALID_STATUSES.contains(lower.as_str()) {
        return Ok(lower);
    }

    // Tier 2: synonym lookup
    if let Some(&canonical) = STATUS_SYNONYMS.get(lower.as_str()) {
        return Ok(canonical.to_string());
    }

    // Tier 3: find closest suggestion
    let suggestion = find_closest_match(&lower, &VALID_STATUSES, &STATUS_SYNONYMS);
    Err((input.to_string(), suggestion))
}

/// Normalize an issue type string via exact match or synonym lookup.
pub fn normalize_type(input: &str) -> Result<String, (String, Option<String>)> {
    let lower = input.to_lowercase();

    if VALID_TYPES.contains(lower.as_str()) {
        return Ok(lower);
    }

    if let Some(&canonical) = TYPE_SYNONYMS.get(lower.as_str()) {
        return Ok(canonical.to_string());
    }

    let suggestion = find_closest_match(&lower, &VALID_TYPES, &TYPE_SYNONYMS);
    Err((input.to_string(), suggestion))
}

/// Normalize a priority value from string, integer, synonym, or P-notation.
///
/// Accepts: "0"-"4", "P0"-"P4", "high", "critical", etc.
pub fn normalize_priority(input: &str) -> Result<i32, (String, Option<String>)> {
    let lower = input.to_lowercase();

    // Tier 1: direct integer
    if let Ok(n) = lower.parse::<i32>() {
        if (0..=4).contains(&n) {
            return Ok(n);
        }
        return Err((input.to_string(), Some("Priority must be 0-4 (0=lowest, 4=critical)".to_string())));
    }

    // Tier 2: P-notation (P0, P1, ..., P4)
    if let Some(stripped) = lower.strip_prefix('p') {
        if let Ok(n) = stripped.parse::<i32>() {
            if (0..=4).contains(&n) {
                return Ok(n);
            }
        }
    }

    // Tier 3: synonym lookup
    if let Some(&digit) = PRIORITY_SYNONYMS.get(lower.as_str()) {
        return Ok(digit.parse().unwrap());
    }

    Err((
        input.to_string(),
        Some("Use 0-4, P0-P4, or: critical, high, medium, low, backlog".to_string()),
    ))
}

/// Find the closest matching value across valid set and synonyms.
fn find_closest_match(
    input: &str,
    valid: &HashSet<&str>,
    synonyms: &HashMap<&str, &str>,
) -> Option<String> {
    let mut best: Option<(&str, usize)> = None;

    for &v in valid.iter().chain(synonyms.keys()) {
        let dist = levenshtein_distance(input, v);
        if dist <= 3 {
            if best.is_none() || dist < best.unwrap().1 {
                // For synonyms, show what it maps to
                if let Some(&canonical) = synonyms.get(v) {
                    best = Some((canonical, dist));
                } else {
                    best = Some((v, dist));
                }
            }
        }
    }

    best.map(|(v, _)| v.to_string())
}

// ── Levenshtein distance ─────────────────────────────────────

/// Compute the Levenshtein edit distance between two strings.
pub fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let a_len = a.len();
    let b_len = b.len();

    if a_len == 0 {
        return b_len;
    }
    if b_len == 0 {
        return a_len;
    }

    // Use single-row optimization (O(min(m,n)) space)
    let mut prev: Vec<usize> = (0..=b_len).collect();
    let mut curr = vec![0; b_len + 1];

    for i in 1..=a_len {
        curr[0] = i;
        for j in 1..=b_len {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            curr[j] = (prev[j] + 1) // deletion
                .min(curr[j - 1] + 1) // insertion
                .min(prev[j - 1] + cost); // substitution
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    prev[b_len]
}

/// Find existing IDs similar to the searched ID.
///
/// Returns up to `max` suggestions with edit distance ≤ 3,
/// sorted by distance then alphabetically.
pub fn find_similar_ids(searched: &str, existing: &[String], max: usize) -> Vec<String> {
    let mut candidates: Vec<(usize, &str)> = existing
        .iter()
        .map(|id| (levenshtein_distance(searched, id), id.as_str()))
        .filter(|(dist, _)| *dist <= 3)
        .collect();

    candidates.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)));

    candidates
        .into_iter()
        .take(max)
        .map(|(_, id)| id.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_status() {
        assert_eq!(normalize_status("open"), Ok("open".to_string()));
        assert_eq!(normalize_status("done"), Ok("closed".to_string()));
        assert_eq!(normalize_status("wip"), Ok("in_progress".to_string()));
        assert_eq!(normalize_status("OPEN"), Ok("open".to_string()));
        assert!(normalize_status("nonsense").is_err());
    }

    #[test]
    fn test_normalize_type() {
        assert_eq!(normalize_type("bug"), Ok("bug".to_string()));
        assert_eq!(normalize_type("defect"), Ok("bug".to_string()));
        assert_eq!(normalize_type("story"), Ok("feature".to_string()));
        assert!(normalize_type("nonsense").is_err());
    }

    #[test]
    fn test_normalize_priority() {
        assert_eq!(normalize_priority("2"), Ok(2));
        assert_eq!(normalize_priority("P3"), Ok(3));
        assert_eq!(normalize_priority("high"), Ok(3));
        assert_eq!(normalize_priority("critical"), Ok(4));
        assert!(normalize_priority("nonsense").is_err());
    }

    #[test]
    fn test_levenshtein() {
        assert_eq!(levenshtein_distance("", ""), 0);
        assert_eq!(levenshtein_distance("abc", "abc"), 0);
        assert_eq!(levenshtein_distance("abc", "abd"), 1);
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
    }

    #[test]
    fn test_find_similar_ids() {
        let ids = vec!["SC-a1b2".to_string(), "SC-a1b3".to_string(), "SC-xxxx".to_string()];
        let result = find_similar_ids("SC-a1b1", &ids, 3);
        assert!(!result.is_empty());
        assert!(result.contains(&"SC-a1b2".to_string()));
    }
}
