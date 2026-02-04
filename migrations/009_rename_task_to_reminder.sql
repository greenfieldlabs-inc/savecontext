-- Migration: 009_rename_task_to_reminder
-- Rename context category 'task' to 'reminder'

-- Update existing context items
UPDATE context_items SET category = 'reminder' WHERE category = 'task';
