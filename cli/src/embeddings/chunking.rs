//! Text chunking for embeddings.
//!
//! Splits large text into overlapping chunks for embedding generation.
//! This ensures full semantic coverage while respecting model token limits.
//!
//! # Design Decisions
//!
//! - **Character-based chunking**: Simple, predictable, works with any language.
//!   Token-based would be more accurate but requires the model's tokenizer.
//! - **Word boundary splitting**: Avoids breaking mid-word which can confuse embeddings.
//! - **Overlapping windows**: Maintains context at chunk boundaries for better retrieval.
//! - **Configurable parameters**: Different models have different optimal chunk sizes.

/// Configuration for text chunking.
#[derive(Debug, Clone)]
pub struct ChunkConfig {
    /// Maximum characters per chunk.
    /// Default: 2000 (~500 tokens for most models).
    pub max_chars: usize,

    /// Number of characters to overlap between chunks.
    /// Default: 200 (~50 tokens) for context continuity.
    pub overlap: usize,

    /// Minimum chunk size (avoids tiny trailing chunks).
    /// Default: 100 characters.
    pub min_chunk_size: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            max_chars: 2000,
            overlap: 200,
            min_chunk_size: 100,
        }
    }
}

impl ChunkConfig {
    /// Create a config optimized for Ollama nomic-embed-text.
    ///
    /// nomic-embed-text has an 8192 token context window.
    /// We use conservative chunking to stay well under the limit.
    #[must_use]
    pub fn for_ollama() -> Self {
        Self {
            max_chars: 2000,
            overlap: 200,
            min_chunk_size: 100,
        }
    }

    /// Create a config for HuggingFace MiniLM models.
    ///
    /// MiniLM models have a 256 token limit, so we use smaller chunks.
    #[must_use]
    pub fn for_minilm() -> Self {
        Self {
            max_chars: 800,
            overlap: 100,
            min_chunk_size: 50,
        }
    }
}

/// A text chunk with its index.
#[derive(Debug, Clone)]
pub struct TextChunk {
    /// The chunk text.
    pub text: String,
    /// Zero-based index of this chunk.
    pub index: usize,
    /// Character offset in the original text.
    pub start_offset: usize,
    /// Character offset where this chunk ends.
    pub end_offset: usize,
}

/// Split text into overlapping chunks.
///
/// Uses word boundaries to avoid splitting mid-word.
///
/// # Examples
///
/// ```rust,ignore
/// use sc::embeddings::chunking::{chunk_text, ChunkConfig};
///
/// let config = ChunkConfig::default();
/// let chunks = chunk_text("This is a test.", &config);
/// assert_eq!(chunks.len(), 1);
/// assert_eq!(chunks[0].text, "This is a test.");
/// ```
#[must_use]
pub fn chunk_text(text: &str, config: &ChunkConfig) -> Vec<TextChunk> {
    let text = text.trim();

    if text.is_empty() {
        return vec![];
    }

    // Small text: return as single chunk
    if text.len() <= config.max_chars {
        return vec![TextChunk {
            text: text.to_string(),
            index: 0,
            start_offset: 0,
            end_offset: text.len(),
        }];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let mut index = 0;

    while start < text.len() {
        // Calculate end position
        let mut end = (start + config.max_chars).min(text.len());

        // If we're not at the end, find a word boundary
        if end < text.len() {
            end = find_word_boundary(text, end, start + config.min_chunk_size);
        }

        let chunk_text = &text[start..end];

        // Skip if chunk is too small (unless it's the last one)
        if chunk_text.len() >= config.min_chunk_size || start + chunk_text.len() >= text.len() {
            chunks.push(TextChunk {
                text: chunk_text.to_string(),
                index,
                start_offset: start,
                end_offset: end,
            });
            index += 1;
        }

        // Move start forward, accounting for overlap
        let next_start = end.saturating_sub(config.overlap);

        // Ensure we make progress
        if next_start <= start {
            start = end;
        } else {
            start = next_start;
        }

        // Break if we've processed everything
        if end >= text.len() {
            break;
        }
    }

    chunks
}

/// Find a word boundary near the target position.
///
/// Searches backward from `target` to find a space or punctuation boundary.
/// Won't go further back than `min_pos`.
fn find_word_boundary(text: &str, target: usize, min_pos: usize) -> usize {
    let bytes = text.as_bytes();

    // Search backward for a word boundary
    for i in (min_pos..=target).rev() {
        if i >= bytes.len() {
            continue;
        }

        let c = bytes[i] as char;
        if c.is_whitespace() || matches!(c, '.' | '!' | '?' | ';' | ',' | '\n') {
            // Include the boundary character
            return (i + 1).min(text.len());
        }
    }

    // No boundary found, just use target
    target
}

/// Prepare text for embedding by concatenating key and value.
///
/// Creates a searchable representation of a context item.
#[must_use]
pub fn prepare_item_text(key: &str, value: &str, category: Option<&str>) -> String {
    let mut text = String::new();

    // Add category prefix if present
    if let Some(cat) = category {
        text.push_str(&format!("[{cat}] "));
    }

    // Add key as a title
    text.push_str(key);
    text.push_str(": ");

    // Add value
    text.push_str(value);

    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_chunk() {
        let config = ChunkConfig::default();
        let chunks = chunk_text("Hello world", &config);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "Hello world");
        assert_eq!(chunks[0].index, 0);
    }

    #[test]
    fn test_empty_text() {
        let config = ChunkConfig::default();
        let chunks = chunk_text("", &config);

        assert!(chunks.is_empty());
    }

    #[test]
    fn test_whitespace_only() {
        let config = ChunkConfig::default();
        let chunks = chunk_text("   \n\t  ", &config);

        assert!(chunks.is_empty());
    }

    #[test]
    fn test_multiple_chunks() {
        let config = ChunkConfig {
            max_chars: 50,
            overlap: 10,
            min_chunk_size: 10,
        };

        let text = "The quick brown fox jumps over the lazy dog. This is a test sentence that should be split into multiple chunks.";
        let chunks = chunk_text(text, &config);

        assert!(chunks.len() > 1);

        // Verify each chunk is within size limit
        for chunk in &chunks {
            assert!(chunk.text.len() <= config.max_chars);
        }

        // Verify indices are sequential
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.index, i);
        }
    }

    #[test]
    fn test_overlap() {
        let config = ChunkConfig {
            max_chars: 20,
            overlap: 5,
            min_chunk_size: 5,
        };

        let text = "one two three four five six seven eight";
        let chunks = chunk_text(text, &config);

        // With overlap, later chunks should contain some text from previous chunks
        if chunks.len() >= 2 {
            // The overlap means chunks share some content
            // (end of first chunk is after start of second)
            assert!(chunks[0].end_offset > chunks[1].start_offset);
        }
    }

    #[test]
    fn test_prepare_item_text() {
        let text = prepare_item_text("auth-decision", "Use JWT tokens", Some("decision"));
        assert_eq!(text, "[decision] auth-decision: Use JWT tokens");

        let text_no_category = prepare_item_text("key", "value", None);
        assert_eq!(text_no_category, "key: value");
    }
}
