-- Migration 005: Add checkpoint grouping and tagging support
-- Adds tags to context_items for selective checkpoint creation and restoration

-- Add tags column to context_items (stores JSON array of tag strings)
ALTER TABLE context_items ADD COLUMN tags TEXT DEFAULT '[]';

-- Add index for tag-based queries
CREATE INDEX idx_context_items_tags ON context_items(tags);

-- Add group metadata to checkpoint_items for better organization
ALTER TABLE checkpoint_items ADD COLUMN group_name TEXT;
ALTER TABLE checkpoint_items ADD COLUMN group_order INTEGER DEFAULT 0;

-- Add index for group-based checkpoint queries
CREATE INDEX idx_checkpoint_items_group ON checkpoint_items(checkpoint_id, group_name);
