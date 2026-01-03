// ====================
// Checkpoint Types
// ====================

import type { ItemCategory } from './context';

export interface Checkpoint {
  id: string;
  session_id: string;
  name: string;
  description?: string;
  git_status?: string;
  git_branch?: string;
  item_count: number;
  total_size: number;
  created_at: number;

  // Cloud sync fields 
  synced_at?: number;
  is_synced?: number;
}

export interface CreateCheckpointArgs {
  name: string;
  description?: string;
  include_git?: boolean;
  // Filtering options for selective checkpoints
  include_tags?: string[];
  include_keys?: string[];  // Wildcard patterns like "feature_*"
  include_categories?: ItemCategory[];
  exclude_tags?: string[];
}

export interface RestoreCheckpointArgs {
  checkpoint_id: string;
  checkpoint_name: string;
  // Filtering options for selective restoration
  restore_tags?: string[];
  restore_categories?: ItemCategory[];
}

export interface TagContextItemsArgs {
  keys?: string[];      // Specific keys to tag
  key_pattern?: string; // Wildcard pattern like "feature_*"
  tags: string[];
  action: 'add' | 'remove';
}

export interface CheckpointItemManagementArgs {
  checkpoint_id: string;
  checkpoint_name: string;
  item_keys: string[];
}

export interface CheckpointSplitArgs {
  source_checkpoint_id: string;
  source_checkpoint_name: string;
  splits: Array<{
    name: string;
    description?: string;
    include_tags?: string[];
    include_categories?: ItemCategory[];
  }>;
}

export interface DeleteCheckpointArgs {
  checkpoint_id: string;
  checkpoint_name: string;
}

export interface ListCheckpointsArgs {
  search?: string;
  session_id?: string;
  project_path?: string;
  include_all_projects?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetCheckpointArgs {
  checkpoint_id: string;
}

// ====================
// File Cache Types
// ====================

export interface FileCache {
  id: string;
  session_id: string;
  file_path: string;
  content?: string;
  hash?: string;
  size: number;
  last_read: number;
  updated_at: number;
}

export interface CacheFileArgs {
  file_path: string;
  content: string;
}

export interface FileChangedArgs {
  file_path: string;
  current_content: string;
}

