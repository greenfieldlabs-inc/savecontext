-- Migration 012: Add tiered embedding support
--
-- Implements 2-tier embedding architecture:
-- - Fast tier: Model2Vec (256d) for instant embeddings on save
-- - Quality tier: Existing providers (384-768d) for background refinement
--
-- Fast embeddings stored separately to avoid dimension mixing in searches.

-- Create fast embedding table (dimension-isolated from quality tier)
CREATE TABLE IF NOT EXISTS embedding_chunks_fast (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    chunk_text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    dimensions INTEGER NOT NULL DEFAULT 256,
    provider TEXT NOT NULL DEFAULT 'model2vec',
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (item_id) REFERENCES context_items(id) ON DELETE CASCADE,
    UNIQUE(item_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_embedding_chunks_fast_item
    ON embedding_chunks_fast(item_id);
CREATE INDEX IF NOT EXISTS idx_embedding_chunks_fast_provider
    ON embedding_chunks_fast(provider, model);

-- Track fast embedding status on context items
-- Uses separate columns from existing embedding_status to allow independent tracking
ALTER TABLE context_items ADD COLUMN fast_embedding_status TEXT DEFAULT 'none';
ALTER TABLE context_items ADD COLUMN fast_embedded_at INTEGER;

-- Record tier dimensions in metadata
INSERT OR REPLACE INTO embeddings_meta (key, value, updated_at)
VALUES
    ('tier_fast_dimensions', '256', strftime('%s', 'now') * 1000),
    ('tier_fast_provider', 'model2vec', strftime('%s', 'now') * 1000),
    ('tier_fast_model', 'minishlab/potion-base-8M', strftime('%s', 'now') * 1000),
    ('tiered_embeddings_enabled', 'true', strftime('%s', 'now') * 1000);
