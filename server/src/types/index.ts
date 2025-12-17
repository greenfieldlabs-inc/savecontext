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
  force_new?: boolean;
}

export interface ResumeSessionArgs {
  session_id: string;
  session_name: string;
}

export interface SwitchSessionArgs {
  session_id: string;
  session_name: string;
}

export interface DeleteSessionArgs {
  session_id: string;
  session_name: string;
}

export interface EndSessionArgs {
  session_id?: string; // Optional override for CLI targeting specific sessions
  session_name?: string;
}

export interface PauseSessionArgs {
  session_id?: string; // Optional override for CLI targeting specific sessions
  session_name?: string;
}

export interface RenameSessionArgs {
  current_name: string;
  new_name: string;
  session_id?: string; // Optional override for CLI targeting specific sessions
}

export interface ListSessionsArgs {
  limit?: number;
  project_path?: string;
  status?: 'active' | 'paused' | 'completed' | 'all';
  include_completed?: boolean;
  search?: string;
}

export interface AddSessionPathArgs {
  session_id: string;
  session_name: string;
  project_path?: string;
}

export interface RemoveSessionPathArgs {
  session_id: string;
  session_name: string;
  project_path: string;  // Required - must specify which path to remove
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

export interface UpdateContextArgs {
  key: string;
  value?: string;
  category?: ItemCategory;
  priority?: ItemPriority;
  channel?: string;
}

export interface DeleteContextArgs {
  key: string;
}

// ====================
// Memory Types
// ====================

export type MemoryCategory = 'command' | 'config' | 'note';

export interface SaveMemoryArgs {
  key: string;
  value: string;
  category?: MemoryCategory;
}

export interface GetMemoryArgs {
  key: string;
}

export interface ListMemoryArgs {
  category?: MemoryCategory;
}

export interface DeleteMemoryArgs {
  key: string;
}

// ====================
// Task Types
// ====================

export interface CreateTaskArgs {
  title: string;
  description?: string;
}

export interface UpdateTaskArgs {
  id: string;
  task_title: string;
  title?: string;
  description?: string;
  status?: 'todo' | 'done';
}

export interface ListTasksArgs {
  status?: 'todo' | 'done';
}

export interface CompleteTaskArgs {
  id: string;
  task_title: string;
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

// ====================
// Cloud Client Types
// ====================

export interface CloudConfig {
  apiKey: string;
  baseUrl: string;
}

export interface AgentMetadata {
  agentId: string;
  projectPath: string;
  gitBranch: string | null;
  provider: string;
}

export interface ErrorResponse {
  error?: string;
}

// ====================
// Server Config Types
// ====================

export interface CompactionConfig {
  threshold: number;
  mode: 'auto' | 'remind' | 'manual';
}

export interface ClientInfo {
  name: string;
  version: string;
  provider: string;  // Normalized provider name
  connectedAt: number;
}

export interface ConnectionState {
  clientInfo: ClientInfo;
  sessionId: string | null;
}

// ====================
// Update Types
// ====================

export interface ContextItemUpdate {
  value?: string;
  category?: ItemCategory;
  priority?: ItemPriority;
  channel?: string;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  status?: 'todo' | 'done';
}

// ====================
// SQLite Row Types
// ====================

export interface CheckpointItemRow {
  checkpoint_id: string;
  context_item_id: string;
  group_name: string | null;
  group_order: number | null;
}

export interface CheckpointRow {
  id: string;
  session_id: string;
  name: string;
  description: string | null;
  git_status: string | null;
  git_branch: string | null;
  item_count: number;
  total_size: number;
  created_at: number;
}

// ====================
// Migration Types
// ====================

export interface MigrationStats {
  sessions: number;
  contextItems: number;
  checkpoints: number;
  checkpointItems: number;
  projectMemory: number;
  tasks: number;
  sessionProjects: number;
  agentSessions: number;
}

export interface MigrationStatusResponse {
  canMigrate: boolean;
  stats?: {
    sessions: number;
    projectMemory: number;
    tasks: number;
  };
}

export interface MigrationResult {
  error?: string;
  message?: string;
  migrated?: {
    sessions: number;
    contextItems: number;
    checkpoints: number;
    projectMemory: number;
    tasks: number;
  };
}

// ====================
// Config Types
// ====================

export type ConfigMode = 'local' | 'cloud';

export interface SaveContextLocalConfig {
  mode: ConfigMode;
  cloudMcpUrl?: string;
  migrated?: boolean;  // True after local data migrated to cloud
  migratedAt?: string;  // ISO 8601 timestamp of migration
}

export interface SaveContextCredentials {
  apiKey: string;
  email?: string;
  provider?: string;  // OAuth provider (google, github)
  createdAt: string;  // ISO 8601 timestamp
}

/**
 * Session metadata - stored separately from API key
 * Persists authentication identity even when --no-save is used
 */
export interface SaveContextSession {
  version: 1;
  userId: string;
  email?: string;
  provider?: string;  // OAuth provider (google, github)
  authenticatedAt: string;  // ISO 8601 timestamp
  expiresAt?: string;  // ISO 8601 timestamp (optional, for future use)
  hasStoredKey: boolean;  // Whether API key is saved to credentials.json
}

/**
 * Runtime state - notices, prompts, preferences
 * Stored in ~/.savecontext/state.json
 */
export interface SaveContextState {
  schemaVersion: number;
  notices: {
    cloudPrompt?: {
      lastShownAt: string;  // ISO 8601 timestamp
    };
  };
}

// ====================
// Device Auth Types (RFC 8628)
// ====================

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token?: string;
  api_key?: string;
  key_prefix?: string;
  user_id?: string;
  email?: string;
  provider?: string;  // OAuth provider (google, github)
  error?: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied';
}

export interface DeviceAuthResult {
  success: boolean;
  apiKey?: string;
  keyPrefix?: string;
  userId?: string;
  email?: string;
  provider?: string;  // OAuth provider (google, github)
  error?: string;
}

export interface DeviceFlowOptions {
  /** Callback when device code is received */
  onCodeReceived: (userCode: string, verificationUri: string) => void;
  /** Optional callback during polling */
  onPolling?: () => void;
  /** Whether to save credentials to disk (default: true) */
  saveCredentials?: boolean;
}

// ====================
// Status Cache Types
// ====================

/**
 * Session info stored in status cache for Claude Code status line
 */
export interface StatusCacheEntry {
  sessionId: string;
  sessionName: string;
  projectPath: string;
  timestamp: number;
  provider?: string;
  itemCount?: number;
  sessionStatus?: 'active' | 'paused' | 'completed';
}

// ====================
// Claude Code Settings Types
// ====================

/**
 * Claude Code status line configuration
 */
export interface ClaudeCodeStatusLine {
  type: 'command';
  command: string;
}

/**
 * Claude Code hook configuration
 */
export interface ClaudeCodeHook {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface ClaudeCodeHookMatcher {
  matcher: string;
  hooks: ClaudeCodeHook[];
}

/**
 * Claude Code settings.json structure
 */
export interface ClaudeCodeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
  };
  statusLine?: ClaudeCodeStatusLine;
  hooks?: {
    PostToolUse?: ClaudeCodeHookMatcher[];
    PreToolUse?: ClaudeCodeHookMatcher[];
  };
}

/**
 * Setup status line result
 */
export interface SetupStatusLineResult {
  success: boolean;
  settingsPath: string;
  scriptPath: string;
  error?: string;
}

// ====================
// Skill Types
// ====================

export interface SetupSkillResult {
  success: boolean;
  skillPath: string;
  error?: string;
}

export interface SkillInstallation {
  tool: string;
  path: string;
  installedAt: number;
}

export interface SkillSyncConfig {
  installations: SkillInstallation[];
}

export interface SetupSkillOptions {
  tool?: string;
  path?: string;
  sync?: boolean;
}
