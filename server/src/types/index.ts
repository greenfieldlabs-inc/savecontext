// SaveContext Core Types
// Simple, focused types matching our database schema

// ====================
// Session Types
// ====================

export type SessionStatus_Type = 'active' | 'paused' | 'completed';

export interface Session {
  id: string;
  name: string;
  description?: string;
  branch?: string;
  channel: string;
  project_path?: string;        // Absolute path to project/repo
  status?: SessionStatus_Type;  // Session lifecycle state
  ended_at?: number;            // Timestamp when paused/completed
  created_at: number;           // Unix timestamp (ms)
  updated_at: number;

  // Cloud sync fields (optional for MVP)
  user_id?: string;
  synced_at?: number;
  is_synced?: number;
}

export interface CreateSessionArgs {
  name: string;
  description?: string;
  branch?: string;
  channel?: string;
  project_path?: string;
}

// ====================
// Context Item Types
// ====================

export type ItemCategory = 'task' | 'decision' | 'progress' | 'note';
export type ItemPriority = 'high' | 'normal' | 'low';

export interface ContextItem {
  id: string;
  session_id: string;
  key: string;
  value: string;
  category: ItemCategory;
  priority: ItemPriority;
  channel: string;
  tags: string;  // JSON array of tag strings
  size: number;
  created_at: number;
  updated_at: number;

  // Cloud sync fields (optional for MVP)
  synced_at?: number;
  is_synced?: number;
}

export interface SaveContextArgs {
  key: string;
  value: string;
  category?: ItemCategory;
  priority?: ItemPriority;
  channel?: string;
}

export interface GetContextArgs {
  key?: string;
  category?: ItemCategory;
  priority?: ItemPriority;
  channel?: string;
  limit?: number;
  offset?: number;
}

// ====================
// Checkpoint Types
// ====================

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
  item_keys: string[];
}

export interface CheckpointSplitArgs {
  source_checkpoint_id: string;
  splits: Array<{
    name: string;
    description?: string;
    include_tags?: string[];
    include_categories?: ItemCategory[];
  }>;
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

// ====================================
// View Types (for convenience queries)
// ====================================

export interface SessionSummary {
  id: string;
  name: string;
  channel: string;
  total_items: number;
  tasks: number;
  decisions: number;
  progress_items: number;
  high_priority: number;
  checkpoint_count: number;
  total_size: number;
}

export interface RecentSession {
  id: string;
  name: string;
  description?: string;
  branch?: string;
  channel: string;
  project_path?: string;
  status?: SessionStatus_Type;
  ended_at?: number;
  created_at: number;
  updated_at: number;
  item_count: number;
  total_size: number;
}

// ========================
// MCP Tool Response Types
// ========================

export interface ToolResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface SaveContextResponse {
  id: string;
  key: string;
  session_id: string;
  created_at: number;
}

export interface GetContextResponse {
  items: ContextItem[];
  total: number;
  session_id: string;
}

export interface CheckpointResponse {
  id: string;
  name: string;
  session_id: string;
  item_count: number;
  total_size: number;
  created_at: number;
}

export interface SessionResponse {
  id: string;
  name: string;
  channel: string;
  project_path?: string;
  status?: SessionStatus_Type;
  created_at: number;
  agent_id?: string;      // Agent identifier (project-branch)
  provider?: string;      // MCP client provider (claude-code, cursor, etc)
}

// ====================
// Status & Info Types
// ====================

export interface SessionStatus {
  current_session_id: string | null;
  session_name: string;
  channel: string;
  project_path?: string;
  status?: SessionStatus_Type;
  item_count: number;
  total_size: number;
  checkpoint_count: number;
  last_updated: number;
  session_duration_ms?: number;  // Time from created_at to ended_at or now
  should_compact?: boolean;
  compaction_reason?: string | null;
}

export interface ContextStats {
  total_sessions: number;
  total_items: number;
  total_checkpoints: number;
  total_size: number;
  recent_sessions: RecentSession[];
}

// ====================
// Error Types
// ====================

export class SaveContextError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SaveContextError';
  }
}

export class ValidationError extends SaveContextError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends SaveContextError {
  constructor(message: string, details?: any) {
    super(message, 'DATABASE_ERROR', details);
    this.name = 'DatabaseError';
  }
}

export class SessionError extends SaveContextError {
  constructor(message: string, details?: any) {
    super(message, 'SESSION_ERROR', details);
    this.name = 'SessionError';
  }
}
