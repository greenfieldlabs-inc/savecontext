// Context items, checkpoints, and file cache types

export type ContextCategory = 'reminder' | 'decision' | 'progress' | 'note';
export type ContextPriority = 'high' | 'normal' | 'low';

export interface ContextItem {
  id: string;
  session_id: string;
  key: string;
  value: string;
  category: ContextCategory;
  priority: ContextPriority;
  channel: string;
  size: number;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
  is_synced: number;
}

export interface Checkpoint {
  id: string;
  session_id: string;
  name: string;
  description: string | null;
  git_status: string | null;
  git_branch: string | null;
  item_count: number;
  total_size: number;
  created_at: number;
  synced_at: number | null;
  is_synced: number;
}

export interface CheckpointItem {
  id: string;
  checkpoint_id: string;
  context_item_id: string;
}

export interface FileCache {
  id: string;
  session_id: string;
  file_path: string;
  content: string | null;
  hash: string | null;
  size: number;
  last_read: number;
  updated_at: number;
}
