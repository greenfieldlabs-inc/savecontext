-- Migration 008: Add embeddings metadata table for dynamic dimension support
-- Allows vec_context_chunks to be recreated with different dimensions when provider changes

-- Store embeddings configuration metadata
CREATE TABLE IF NOT EXISTS embeddings_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Insert initial dimensions (768 from migration 007)
INSERT OR IGNORE INTO embeddings_meta (key, value, updated_at)
VALUES ('vec_dimensions', '768', strftime('%s', 'now') * 1000);
