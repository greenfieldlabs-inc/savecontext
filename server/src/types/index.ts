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

export type ItemCategory = 'reminder' | 'decision' | 'progress' | 'note';
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
// Issue Types
// ====================

export type IssueStatus = 'open' | 'in_progress' | 'blocked' | 'closed' | 'deferred';
export type IssueType = 'task' | 'bug' | 'feature' | 'epic' | 'chore';
export type DependencyType = 'blocks' | 'related' | 'parent-child' | 'discovered-from';

export interface Issue {
  id: string;
  shortId?: string;
  projectPath: string;
  planId?: string;
  title: string;
  description?: string;
  details?: string;
  status: IssueStatus;
  priority: number;  // 0-4: lowest, low, medium, high, critical
  issueType: IssueType;
  createdByAgent?: string;
  closedByAgent?: string;
  createdInSession?: string;
  closedInSession?: string;
  assignedToAgent?: string;
  assignedAt?: number;
  assignedInSession?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  deferredAt?: number;
  labels?: string[];
  dependencyCount?: number;
  dependentCount?: number;
  subtaskCount?: number;
  parentId?: string;  // Populated from issue_dependencies with type='parent-child'
}

export interface CreateIssueArgs {
  title: string;
  description?: string;
  details?: string;
  priority?: number;  // 0-4, default 2
  issueType?: IssueType;
  parentId?: string;
  planId?: string;    // Link to a Plan (PRD/spec)
  labels?: string[];
  status?: IssueStatus;
}

export interface UpdateIssueArgs {
  id: string;
  issue_title: string;
  title?: string;
  description?: string;
  details?: string;
  status?: IssueStatus;
  priority?: number;
  issueType?: IssueType;
  parentId?: string | null;
  planId?: string | null;
  projectPath?: string;
}

export interface ListIssuesArgs {
  project_path?: string;
  status?: IssueStatus;
  priority?: number;
  priorityMin?: number;
  priorityMax?: number;
  issueType?: IssueType;
  labels?: string[];
  labelsAny?: string[];
  parentId?: string;
  planId?: string;
  hasSubtasks?: boolean;
  hasDependencies?: boolean;
  sortBy?: 'priority' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

export interface CompleteIssueArgs {
  id: string;
  issue_title: string;
}

// Dependency management
export interface AddDependencyArgs {
  issueId: string;
  dependsOnId: string;
  dependencyType?: DependencyType;
}

export interface RemoveDependencyArgs {
  issueId: string;
  dependsOnId: string;
}

// Label management
export interface AddLabelsArgs {
  id: string;
  labels: string[];
}

export interface RemoveLabelsArgs {
  id: string;
  labels: string[];
}

// Agent assignment
export interface ClaimIssuesArgs {
  issue_ids: string[];
}

export interface GetNextBlockArgs {
  count?: number;
  priority_min?: number;
  labels?: string[];
}

export interface ReleaseIssuesArgs {
  issue_ids: string[];
}

export interface GetReadyIssuesArgs {
  limit?: number;
  sortBy?: 'priority' | 'createdAt';
}

// Batch creation
export interface CreateBatchArgs {
  planId?: string;    // Link all issues in batch to a Plan (individual issues can override)
  issues: Array<{
    title: string;
    description?: string;
    details?: string;
    priority?: number;
    issueType?: IssueType;
    parentId?: string;  // Can use '$0', '$1' to reference earlier issues in batch
    planId?: string;    // Override batch-level planId for this issue
    labels?: string[];
  }>;
  dependencies?: Array<{
    issueIndex: number;
    dependsOnIndex: number;
    dependencyType?: DependencyType;
  }>;
}

// ====================
// Issue Operation Results
// ====================

export interface AddDependencyResult {
  created: boolean;
  issueId: string;
  issueShortId: string;
  dependsOnId: string;
  dependsOnShortId: string;
  dependencyType: DependencyType;
  issueBlocked: boolean;
}

export interface RemoveDependencyResult {
  removed: boolean;
  issueId: string;
  dependsOnId: string;
  issueUnblocked: boolean;
}

export interface AddLabelsResult {
  issueId: string;
  shortId: string;
  labels: string[];
  addedCount: number;
}

export interface RemoveLabelsResult {
  issueId: string;
  shortId: string;
  labels: string[];
  removedCount: number;
}

export interface ClaimIssuesResult {
  claimedIssues: Array<{
    id: string;
    shortId: string;
    title: string;
  }>;
  alreadyClaimed: string[];
  notFound: string[];
}

export interface ReleaseIssuesResult {
  releasedIssues: Array<{
    id: string;
    shortId: string;
    title: string;
  }>;
  notOwned: string[];
  notFound: string[];
}

export interface GetNextBlockResult {
  issues: Issue[];
  claimedCount: number;
  agentId: string;
}

export interface CreateBatchResult {
  issues: Array<{
    id: string;
    shortId: string;
    title: string;
    index: number;
  }>;
  dependencies: Array<{
    issueShortId: string;
    dependsOnShortId: string;
    dependencyType: DependencyType;
  }>;
  count: number;
  dependencyCount: number;
}

export interface ListIssuesResult {
  issues: Issue[];
  count: number;
  total?: number;
  filters_applied?: Record<string, unknown>;
}

export interface IssueDependencyInfo {
  id: string;
  shortId: string;
  title: string;
  status: IssueStatus;
  dependencyType: DependencyType;
}

export interface GetReadyIssuesResult {
  issues: Issue[];
  count: number;
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
// Plan Types
// ====================

export type PlanStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface Plan {
  id: string;
  short_id: string | null;
  project_path: string;
  project_id: string;
  title: string;
  status: PlanStatus;
  success_criteria: string | null;
  epic_count: number;
  linked_issue_count: number;
  linked_issue_completed_count: number;
  created_in_session: string | null;
  completed_in_session: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface ListPlansArgs {
  project_path?: string;
  status?: PlanStatus | 'all';
  limit?: number;
}

export interface GetPlanArgs {
  plan_id: string;
}

export interface CreatePlanArgs {
  title: string;
  content: string;
  status?: PlanStatus;
  successCriteria?: string;
  project_path?: string;
}

export interface UpdatePlanArgs {
  id: string;
  title?: string;
  content?: string;
  status?: PlanStatus;
  successCriteria?: string;
  project_path?: string;  // Changing this cascades to all linked issues
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

export interface IssueUpdate {
  title?: string;
  description?: string;
  status?: 'open' | 'closed';
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
// Database Param Types
// ====================

/**
 * SQLite binding parameter - the types that better-sqlite3 accepts.
 * Note: booleans are NOT supported - convert to 0/1 before binding.
 * @see https://github.com/WiseLibs/better-sqlite3/issues/209
 */
export type SqliteBindValue = string | number | bigint | Buffer | null;

// ====================
// Migration Types
// ====================

export interface MigrationStats {
  sessions: number;
  contextItems: number;
  checkpoints: number;
  checkpointItems: number;
  projectMemory: number;
  issues: number;
  sessionProjects: number;
  agentSessions: number;
}

export interface MigrationStatusResponse {
  canMigrate: boolean;
  stats?: {
    sessions: number;
    projectMemory: number;
    issues: number;
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
    issues: number;
  };
}

// ====================
// Config Types
// ====================

export type ConfigMode = 'local' | 'cloud';

export type EmbeddingProviderType = 'ollama' | 'huggingface' | 'transformers';

/**
 * Embedding configuration settings
 * Keys match environment variable names for consistency
 */
export interface EmbeddingSettings {
  enabled?: boolean;
  provider?: EmbeddingProviderType;
  HF_TOKEN?: string;
  HF_MODEL?: string;
  HF_ENDPOINT?: string;
  OLLAMA_ENDPOINT?: string;
  OLLAMA_MODEL?: string;
  TRANSFORMERS_MODEL?: string;
}

/**
 * Embedding provider interface
 * Abstraction for generating text embeddings for semantic search
 */
export interface EmbeddingProvider {
  name: string;
  model: string;
  dimensions: number;
  maxChars: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings?(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
}

/**
 * Result from embedding generation
 */
export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  provider: string;
}

/**
 * Provider-specific configuration for embedding creation
 */
export interface EmbeddingConfig {
  provider?: EmbeddingProviderType;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  transformersModel?: string;
  huggingfaceToken?: string;
  huggingfaceModel?: string;
}

/**
 * HuggingFace provider configuration
 */
export interface HuggingFaceConfig {
  /** HuggingFace API token (or set HF_TOKEN env var) */
  apiToken?: string;
  /** Model ID on HuggingFace Hub (default: sentence-transformers/all-MiniLM-L6-v2) */
  model?: string;
  /** API endpoint (default: https://router.huggingface.co/hf-inference) */
  endpoint?: string;
}

/**
 * Ollama provider configuration
 */
export interface OllamaConfig {
  /** Ollama server URL (default: http://localhost:11434) */
  endpoint?: string;
  /** Model to use (default: nomic-embed-text) */
  model?: string;
}

/**
 * Transformers.js provider configuration
 */
export interface TransformersConfig {
  /** Model to use (default: Xenova/all-MiniLM-L6-v2) */
  model?: string;
}

/**
 * Text chunking configuration for large content
 */
export interface ChunkConfig {
  maxChars: number;
  overlapChars: number;
}

/**
 * Result of text chunking
 */
export interface TextChunk {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
}

export interface SaveContextLocalConfig {
  mode: ConfigMode;
  cloudMcpUrl?: string;
  migrated?: boolean;  // True after local data migrated to cloud
  migratedAt?: string;  // ISO 8601 timestamp of migration
  embeddings?: EmbeddingSettings;  // Embedding provider configuration
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
// Skills
// ====================

/**
 * Setup skill result
 */
export interface SetupSkillResult {
  success: boolean;
  skillPath: string;
  error?: string;
}

/**
 * Skill installation record for sync config
 */
export interface SkillInstallation {
  tool: string;
  path: string;
  installedAt: number;
}

/**
 * Skill sync configuration stored in ~/.savecontext/skill-sync.json
 */
export interface SkillSyncConfig {
  installations: SkillInstallation[];
}

/**
 * Options for setupSkill function
 */
export interface SetupSkillOptions {
  tool?: string;
  path?: string;
  sync?: boolean;
}

// ====================
// Project CRUD Types
// ====================

/**
 * Project entity representing a codebase/repository
 */
export interface Project {
  id: string;
  project_path: string;
  name: string;
  description: string | null;
  issue_prefix: string | null;
  next_issue_number: number;
  plan_prefix: string | null;
  next_plan_number: number;
  created_at: number;
  updated_at: number;
}

/**
 * Arguments for creating a new project
 */
export interface CreateProjectArgs {
  project_path: string;
  name?: string;
  description?: string;
  issue_prefix?: string;
}

/**
 * Arguments for updating a project
 */
export interface UpdateProjectArgs {
  project_path: string;
  name?: string;
  description?: string;
  issue_prefix?: string;
}

/**
 * Arguments for listing projects
 */
export interface ListProjectsArgs {
  limit?: number;
  include_session_count?: boolean;
}

/**
 * Arguments for deleting a project
 */
export interface DeleteProjectArgs {
  project_path: string;
  confirm: boolean;
}
