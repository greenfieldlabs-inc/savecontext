-- Migration 011: Migrate from sqlite-vec to BLOB-based embeddings
--
-- The TypeScript MCP server used sqlite-vec (vec_context_chunks virtual table).
-- The Rust CLI uses pure SQLite BLOB storage (embedding_chunks table).
-- This migration handles the one-way transition.

-- Step 1: Create BLOB-based embedding storage
-- Uses regular SQLite BLOB columns (f32 arrays as binary)
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

-- Step 2: Drop sqlite-vec virtual table (can't read without extension)
DROP TABLE IF EXISTS vec_context_chunks;

-- Step 3: Reset embedding status for re-backfill
UPDATE context_items
SET embedding_status = 'pending', chunk_count = 0, embedded_at = NULL
WHERE embedding_status = 'complete';

-- Step 4: Record migration metadata
INSERT OR REPLACE INTO embeddings_meta (key, value, updated_at)
VALUES ('migrated_from_sqlite_vec', 'true', strftime('%s', 'now') * 1000);
