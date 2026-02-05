-- Migration 007: Add embeddings support for local semantic search
-- Uses sqlite-vec for vector storage and k-NN similarity search
-- Chunked architecture: large content split into multiple embeddings

-- Step 1: Create virtual table for chunked vector embeddings
-- Using 768 dimensions (nomic-embed-text default)
-- Each item can have multiple chunks for full content coverage
CREATE VIRTUAL TABLE IF NOT EXISTS vec_context_chunks USING vec0(
  embedding float[768] distance_metric=cosine,
  item_id TEXT,
  chunk_index INTEGER
);

-- Step 2: Add embedding metadata to context_items
ALTER TABLE context_items ADD COLUMN embedding_status TEXT DEFAULT 'none';
ALTER TABLE context_items ADD COLUMN embedding_provider TEXT;
ALTER TABLE context_items ADD COLUMN embedding_model TEXT;
ALTER TABLE context_items ADD COLUMN chunk_count INTEGER DEFAULT 0;
ALTER TABLE context_items ADD COLUMN embedded_at INTEGER;

-- Step 3: Index for finding items needing embeddings
CREATE INDEX IF NOT EXISTS idx_context_items_embedding_status ON context_items(embedding_status);
