/**
 * CliBridge - Bridge between MCP server and Rust CLI
 *
 * Allows the MCP server to delegate operations to the `sc` Rust binary
 * instead of implementing logic in TypeScript. This enables:
 * - Single source of truth (business logic in Rust)
 * - Gradual migration via feature flags
 * - CLI works standalone without MCP server
 */

import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ============================================================================
// Types for CLI Responses
// ============================================================================

export interface CliResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SessionStartResult {
  id: string;
  name: string;
  status: string;
  created_at: number;
  resumed: boolean;
}

export interface SessionInfo {
  id: string;
  name: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface ContextSaveResult {
  id: string;
  key: string;
  session_id: string;
  created: boolean;
}

export interface ContextGetResult {
  items: ContextItem[];
  count: number;
}

export interface ContextItem {
  id: string;
  key: string;
  value: string;
  category: string;
  priority: string;
  session_id: string;
  created_at: number;
  updated_at: number;
}

export interface EmbeddingsStatusResult {
  enabled: boolean;
  configured_provider: string | null;
  available_providers: ProviderStatus[];
  active_provider: ActiveProviderInfo | null;
}

export interface ProviderStatus {
  name: string;
  available: boolean;
  model: string | null;
  dimensions: number | null;
}

export interface ActiveProviderInfo {
  name: string;
  model: string;
  dimensions: number;
  max_chars: number;
}

export interface EmbeddingsTestResult {
  success: boolean;
  provider: string;
  model: string;
  dimensions: number;
  input_text: string;
  embedding_sample: number[];
  error?: string;
}

export interface SyncStatusResult {
  dirty_count: number;
  export_files: ExportFileInfo[];
  needs_export: boolean;
  needs_import: boolean;
}

export interface ExportFileInfo {
  name: string;
  records: number;
  size: number;
  modified: number;
}

export interface IssueResult {
  id: string;
  short_id: string;
  title: string;
  description?: string;
  details?: string;
  status: string;
  issue_type: string;
  priority: number;
  parent_id?: string;
  plan_id?: string;
  assignee?: string;
  labels?: string[];
  created_at?: number;
  updated_at?: number;
  closed_at?: number;
}

export interface MemoryResult {
  id: string;
  key: string;
  value: string;
  category: string;
  project_path: string;
  created_at: number;
  updated_at: number;
}

export interface CheckpointResult {
  id: string;
  name: string;
  description?: string;
  session_id: string;
  git_branch?: string;
  git_status?: string;
  item_count: number;
  created_at: number;
}

export interface CheckpointDetailResult extends CheckpointResult {
  items: ContextItem[];
}

export interface ProjectResult {
  id: string;
  path: string;
  name: string;
  description?: string;
  issue_prefix: string;
  created_at: number;
  updated_at: number;
}

export interface PlanResult {
  id: string;
  title: string;
  content: string;
  status: string;
  success_criteria?: string;
  project_path: string;
  created_at: number;
  updated_at: number;
}

export interface TagResult {
  tagged: number;
  keys: string[];
}

export interface DependencyResult {
  issue_id: string;
  depends_on_id: string;
  dependency_type: string;
  created_at: number;
}

export interface IssueBatchResult {
  issues: IssueResult[];
  dependencies: Array<{
    issue_short_id: string;
    depends_on_short_id: string;
    dependency_type: string;
  }>;
  count: number;
  dependency_count: number;
}

export interface CompactionResult {
  checkpoint_id: string;
  checkpoint_name: string;
  summary: string;
  high_priority_items: ContextItem[];
  recent_decisions: ContextItem[];
  active_progress: ContextItem[];
  next_steps: string[];
  restoration_prompt: string;
}

export interface PrimeResult {
  session: {
    id: string;
    name: string;
    description?: string;
    status: string;
    branch?: string;
    project_path?: string;
  };
  git?: {
    branch: string;
    changed_files: string[];
  };
  context: {
    high_priority: ContextItem[];
    decisions: ContextItem[];
    reminders: ContextItem[];
    recent_progress: ContextItem[];
    total_items: number;
  };
  issues: {
    active: IssueResult[];
    ready: IssueResult[];
    total_open: number;
  };
  memory: Array<{ key: string; value: string; category: string }>;
  transcript?: {
    source: string;
    entries: Array<{ summary: string; timestamp?: string }>;
  };
  command_reference: Array<{ cmd: string; desc: string }>;
}

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * Check if CLI bridge is enabled globally
 * Defaults to TRUE - the Rust CLI is the primary implementation
 * Set SC_USE_CLI=false to fall back to TypeScript implementation
 */
export function isCliBridgeEnabled(): boolean {
  // Default to enabled (CLI is the primary implementation)
  // Only disable if explicitly set to 'false'
  return process.env.SC_USE_CLI !== 'false';
}

/**
 * Check if CLI bridge is enabled for a specific feature
 * Feature flags can disable specific features: SC_USE_CLI_SESSION=false
 */
export function isCliBridgeEnabledFor(feature: string): boolean {
  // Check feature-specific flag first
  const featureFlag = process.env[`SC_USE_CLI_${feature.toUpperCase()}`];
  if (featureFlag !== undefined) {
    // Explicit feature flag: only disable if explicitly 'false'
    return featureFlag !== 'false';
  }
  // Fall back to global flag
  return isCliBridgeEnabled();
}

// ============================================================================
// CliBridge Class
// ============================================================================

export class CliBridge {
  private binaryPath: string;
  private dbPath?: string;
  private actor?: string;
  private sessionId?: string;
  private timeout: number;

  constructor(options: {
    binaryPath?: string;
    dbPath?: string;
    actor?: string;
    sessionId?: string;
    timeout?: number;
  } = {}) {
    this.binaryPath = options.binaryPath ?? this.findBinary();
    this.dbPath = options.dbPath;
    this.actor = options.actor;
    this.sessionId = options.sessionId;
    this.timeout = options.timeout ?? 30000;
  }

  /**
   * Find the sc binary in common locations
   */
  private findBinary(): string {
    // Check environment variable first
    if (process.env.SC_BINARY_PATH) {
      return process.env.SC_BINARY_PATH;
    }

    // Check actual file paths first (more reliable than PATH lookup)
    const filePaths = [
      // Relative to this package (monorepo structure: dist/cli/bridge.js -> ../../../cli/target)
      join(__dirname, '../../../cli/target/release/sc'),
      join(__dirname, '../../../cli/target/debug/sc'),
      // Global install locations
      '/usr/local/bin/sc',
      join(process.env.HOME ?? '', '.cargo/bin/sc'),
      join(process.env.HOME ?? '', '.local/bin/sc'),
    ];

    for (const loc of filePaths) {
      if (existsSync(loc)) {
        return loc;
      }
    }

    // Fall back to PATH lookup (will fail with error if not found)
    return 'sc';
  }

  /**
   * Build base arguments for CLI calls
   */
  private buildBaseArgs(): string[] {
    const args = ['--json'];
    if (this.dbPath) {
      args.push('--db', this.dbPath);
    }
    if (this.actor) {
      args.push('--actor', this.actor);
    }
    if (this.sessionId) {
      args.push('--session', this.sessionId);
    }
    return args;
  }

  /**
   * Execute a CLI command and parse JSON output
   */
  async execute<T>(args: string[]): Promise<T> {
    const fullArgs = [...this.buildBaseArgs(), ...args];

    try {
      const { stdout, stderr } = await execFileAsync(this.binaryPath, fullArgs, {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
        env: { ...process.env }, // Pass through all env vars including SC_TEST_DB
      });

      if (stderr && process.env.SC_DEBUG) {
        console.error('[CliBridge stderr]', stderr);
      }

      return JSON.parse(stdout) as T;
    } catch (error: unknown) {
      const err = error as { code?: string; stderr?: string; message?: string };

      // If the binary isn't found, provide helpful error
      if (err.code === 'ENOENT') {
        throw new Error(
          `SaveContext CLI binary not found at '${this.binaryPath}'. ` +
          `Install with: cargo install --path cli` +
          (process.env.SC_BINARY_PATH ? '' : ` or set SC_BINARY_PATH environment variable`)
        );
      }

      // Try to parse error from stderr if available
      if (err.stderr) {
        let errorMessage = err.stderr;
        try {
          const errorJson = JSON.parse(err.stderr);
          // errorJson.error may be a string or an object with { code, message, hint }
          if (errorJson.error) {
            if (typeof errorJson.error === 'string') {
              errorMessage = errorJson.error;
            } else if (typeof errorJson.error === 'object') {
              // Extract message and hint for a more helpful error
              const errObj = errorJson.error;
              errorMessage = errObj.message ?? JSON.stringify(errObj);
              if (errObj.hint) {
                errorMessage += `\n\nHint: ${errObj.hint}`;
              }
            }
          }
        } catch {
          // JSON parse failed, use raw stderr
        }
        throw new Error(errorMessage);
      }

      throw new Error(err.message ?? 'Unknown CLI error');
    }
  }

  /**
   * Check if the CLI binary is available and working
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.execute(['version']);
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Session Commands
  // ==========================================================================

  async sessionStart(
    name: string,
    options?: { description?: string; projectPath?: string }
  ): Promise<SessionStartResult> {
    const args = ['session', 'start', name];
    if (options?.description) {
      args.push('-d', options.description);
    }
    if (options?.projectPath) {
      args.push('-p', options.projectPath);
    }
    return this.execute<SessionStartResult>(args);
  }

  async sessionEnd(): Promise<SessionInfo> {
    return this.execute<SessionInfo>(['session', 'end']);
  }

  async sessionList(options?: {
    status?: string;
    limit?: number;
    search?: string;
    projectPath?: string;
    allProjects?: boolean;
    includeCompleted?: boolean;
  }): Promise<SessionInfo[]> {
    const args = ['session', 'list'];

    // Determine if we need to filter completed sessions after fetching
    // MCP default: show active+paused, exclude completed unless includeCompleted=true or status='all'
    const excludeCompleted = !options?.includeCompleted &&
                             options?.status !== 'all' &&
                             options?.status !== 'completed';

    // If specific status provided (not needing post-filtering), use it directly
    // Otherwise fetch 'all' and filter in the bridge
    if (options?.status && options.status !== 'all') {
      args.push('-s', options.status);
    } else {
      // Fetch all statuses, will filter completed if needed
      args.push('-s', 'all');
    }

    // Request more if we'll filter, to ensure we return enough results
    const fetchLimit = excludeCompleted && options?.limit
      ? Math.min(options.limit * 2, 100)
      : options?.limit;
    if (fetchLimit) {
      args.push('-l', String(fetchLimit));
    }
    if (options?.search) {
      args.push('--search', options.search);
    }
    if (options?.projectPath) {
      args.push('--project', options.projectPath);
    }
    if (options?.allProjects) {
      args.push('--all-projects');
    }

    // CLI returns { sessions: [...], count: N }, extract the array
    const result = await this.execute<{ sessions: SessionInfo[]; count: number }>(args);
    let sessions = result.sessions || [];

    // Filter out completed sessions if needed (matching MCP default behavior)
    if (excludeCompleted) {
      sessions = sessions.filter(s => s.status !== 'completed');
    }

    // Apply original limit after filtering
    if (options?.limit && sessions.length > options.limit) {
      sessions = sessions.slice(0, options.limit);
    }

    return sessions;
  }

  async sessionSwitch(id: string): Promise<SessionInfo> {
    return this.execute<SessionInfo>(['session', 'switch', id]);
  }

  async sessionPause(): Promise<SessionInfo> {
    return this.execute<SessionInfo>(['session', 'pause']);
  }

  async sessionResume(id: string): Promise<SessionInfo> {
    return this.execute<SessionInfo>(['session', 'resume', id]);
  }

  async sessionRename(newName: string): Promise<SessionInfo> {
    return this.execute<SessionInfo>(['session', 'rename', newName]);
  }

  async sessionDelete(id: string): Promise<{ deleted: boolean }> {
    // Always use --force since MCP server should be able to delete any session
    // The original MCP implementation allows deletion after checking session exists
    return this.execute<{ deleted: boolean }>(['session', 'delete', id, '--force']);
  }

  async sessionAddPath(sessionId: string, path: string): Promise<SessionInfo> {
    // CLI: sc session add-path -i <ID> [PATH]
    return this.execute<SessionInfo>(['session', 'add-path', '-i', sessionId, path]);
  }

  async sessionRemovePath(sessionId: string, path: string): Promise<SessionInfo> {
    // CLI: sc session remove-path -i <ID> <PATH>
    return this.execute<SessionInfo>(['session', 'remove-path', '-i', sessionId, path]);
  }

  // ==========================================================================
  // Context Commands
  // ==========================================================================

  async contextSave(
    key: string,
    value: string,
    options?: { category?: string; priority?: string }
  ): Promise<ContextSaveResult> {
    const args = ['save', key, value];
    if (options?.category) {
      args.push('-c', options.category);
    }
    if (options?.priority) {
      args.push('-p', options.priority);
    }
    return this.execute<ContextSaveResult>(args);
  }

  async contextGet(options?: {
    query?: string;
    key?: string;
    category?: string;
    priority?: string;
    limit?: number;
  }): Promise<ContextGetResult> {
    const args = ['get'];
    if (options?.query) {
      args.push('-s', options.query);
    }
    if (options?.key) {
      args.push('-k', options.key);
    }
    if (options?.category) {
      args.push('-c', options.category);
    }
    if (options?.priority) {
      args.push('-P', options.priority);
    }
    if (options?.limit) {
      args.push('-l', String(options.limit));
    }
    return this.execute<ContextGetResult>(args);
  }

  async contextDelete(key: string): Promise<{ deleted: boolean }> {
    return this.execute<{ deleted: boolean }>(['delete', key]);
  }

  async contextUpdate(
    key: string,
    options: {
      value?: string;
      category?: string;
      priority?: string;
      channel?: string;
    }
  ): Promise<ContextItem> {
    const args = ['update', key];
    if (options.value) {
      args.push('--value', options.value);
    }
    if (options.category) {
      args.push('-c', options.category);
    }
    if (options.priority) {
      args.push('-p', options.priority);
    }
    if (options.channel) {
      args.push('--channel', options.channel);
    }
    return this.execute<ContextItem>(args);
  }

  async contextTag(
    action: 'add' | 'remove',
    tags: string[],
    options?: {
      keys?: string[];
      keyPattern?: string;
    }
  ): Promise<TagResult> {
    const args = ['tag', action, ...tags];
    if (options?.keys && options.keys.length > 0) {
      args.push('--keys', options.keys.join(','));
    }
    if (options?.keyPattern) {
      args.push('--pattern', options.keyPattern);
    }
    return this.execute<TagResult>(args);
  }

  // ==========================================================================
  // Memory Commands
  // ==========================================================================

  async memorySave(
    key: string,
    value: string,
    options?: { category?: string }
  ): Promise<MemoryResult> {
    const args = ['memory', 'save', key, value];
    if (options?.category) {
      args.push('-c', options.category);
    }
    return this.execute<MemoryResult>(args);
  }

  async memoryGet(key: string): Promise<MemoryResult> {
    return this.execute<MemoryResult>(['memory', 'get', key]);
  }

  async memoryList(options?: { category?: string }): Promise<MemoryResult[]> {
    const args = ['memory', 'list'];
    if (options?.category) {
      args.push('-c', options.category);
    }
    return this.execute<MemoryResult[]>(args);
  }

  async memoryDelete(key: string): Promise<{ deleted: boolean }> {
    return this.execute<{ deleted: boolean }>(['memory', 'delete', key]);
  }

  // ==========================================================================
  // Embeddings Commands
  // ==========================================================================

  async embeddingsStatus(): Promise<EmbeddingsStatusResult> {
    return this.execute<EmbeddingsStatusResult>(['embeddings', 'status']);
  }

  async embeddingsTest(text: string): Promise<EmbeddingsTestResult> {
    return this.execute<EmbeddingsTestResult>(['embeddings', 'test', text]);
  }

  async embeddingsConfigure(options: {
    provider?: string;
    enable?: boolean;
    disable?: boolean;
    model?: string;
    endpoint?: string;
    token?: string;
  }): Promise<EmbeddingsStatusResult> {
    const args = ['embeddings', 'configure'];
    if (options.provider) {
      args.push('-p', options.provider);
    }
    if (options.enable) {
      args.push('--enable');
    }
    if (options.disable) {
      args.push('--disable');
    }
    if (options.model) {
      args.push('-m', options.model);
    }
    if (options.endpoint) {
      args.push('--endpoint', options.endpoint);
    }
    if (options.token) {
      args.push('--token', options.token);
    }
    return this.execute<EmbeddingsStatusResult>(args);
  }

  // ==========================================================================
  // Sync Commands
  // ==========================================================================

  async syncStatus(): Promise<SyncStatusResult> {
    return this.execute<SyncStatusResult>(['sync', 'status']);
  }

  async syncExport(force?: boolean): Promise<{ exported: number }> {
    const args = ['sync', 'export'];
    if (force) {
      args.push('--force');
    }
    return this.execute<{ exported: number }>(args);
  }

  async syncImport(force?: boolean): Promise<{ imported: number }> {
    const args = ['sync', 'import'];
    if (force) {
      args.push('--force');
    }
    return this.execute<{ imported: number }>(args);
  }

  // ==========================================================================
  // Issue Commands
  // ==========================================================================

  async issueCreate(
    title: string,
    options?: {
      description?: string;
      details?: string;
      issueType?: string;
      priority?: number;
      parent?: string;
      planId?: string;
      labels?: string;
    }
  ): Promise<IssueResult> {
    const args = ['issue', 'create', title];
    if (options?.description) {
      args.push('-d', options.description);
    }
    if (options?.details) {
      args.push('--details', options.details);
    }
    if (options?.issueType) {
      args.push('-t', options.issueType);
    }
    if (options?.priority !== undefined) {
      args.push('-p', String(options.priority));
    }
    if (options?.parent) {
      args.push('--parent', options.parent);
    }
    if (options?.planId) {
      args.push('--plan-id', options.planId);
    }
    if (options?.labels) {
      args.push('-l', options.labels);
    }
    return this.execute<IssueResult>(args);
  }

  async issueList(options?: {
    id?: string;
    status?: string;
    priority?: number;
    priorityMin?: number;
    priorityMax?: number;
    issueType?: string;
    labels?: string[];
    labelsAny?: string[];
    parentId?: string;
    planId?: string;
    hasSubtasks?: boolean;
    hasDependencies?: boolean;
    sortBy?: string;
    sortOrder?: string;
    limit?: number;
    createdInLastDays?: number;
    createdInLastHours?: number;
    updatedInLastDays?: number;
    updatedInLastHours?: number;
    search?: string;
    assignee?: string;
    allProjects?: boolean;
  }): Promise<IssueResult[]> {
    const args = ['issue', 'list'];
    if (options?.id) {
      args.push('--id', options.id);
    }
    if (options?.status) {
      args.push('-s', options.status);
    }
    if (options?.priority !== undefined) {
      args.push('-p', String(options.priority));
    }
    if (options?.priorityMin !== undefined) {
      args.push('--priority-min', String(options.priorityMin));
    }
    if (options?.priorityMax !== undefined) {
      args.push('--priority-max', String(options.priorityMax));
    }
    if (options?.issueType) {
      args.push('-t', options.issueType);
    }
    if (options?.labels?.length) {
      args.push('--labels', options.labels.join(','));
    }
    if (options?.labelsAny?.length) {
      args.push('--labels-any', options.labelsAny.join(','));
    }
    if (options?.parentId) {
      args.push('--parent', options.parentId);
    }
    if (options?.planId) {
      args.push('--plan', options.planId);
    }
    if (options?.hasSubtasks !== undefined) {
      args.push(options.hasSubtasks ? '--has-subtasks' : '--no-subtasks');
    }
    if (options?.hasDependencies !== undefined) {
      args.push(options.hasDependencies ? '--has-deps' : '--no-deps');
    }
    if (options?.sortBy) {
      args.push('--sort', options.sortBy);
    }
    if (options?.sortOrder) {
      args.push('--order', options.sortOrder);
    }
    if (options?.limit) {
      args.push('-l', String(options.limit));
    }
    if (options?.createdInLastDays !== undefined) {
      args.push('--created-days', String(options.createdInLastDays));
    }
    if (options?.createdInLastHours !== undefined) {
      args.push('--created-hours', String(options.createdInLastHours));
    }
    if (options?.updatedInLastDays !== undefined) {
      args.push('--updated-days', String(options.updatedInLastDays));
    }
    if (options?.updatedInLastHours !== undefined) {
      args.push('--updated-hours', String(options.updatedInLastHours));
    }
    if (options?.search) {
      args.push('--search', options.search);
    }
    if (options?.assignee) {
      args.push('--assignee', options.assignee);
    }
    if (options?.allProjects) {
      args.push('--all-projects');
    }
    return this.execute<IssueResult[]>(args);
  }

  async issueComplete(id: string): Promise<IssueResult> {
    return this.execute<IssueResult>(['issue', 'complete', id]);
  }

  async issueClaim(id: string): Promise<IssueResult> {
    return this.execute<IssueResult>(['issue', 'claim', id]);
  }

  async issueShow(id: string): Promise<IssueResult> {
    return this.execute<IssueResult>(['issue', 'show', id]);
  }

  async issueUpdate(
    id: string,
    options: {
      title?: string;
      description?: string;
      details?: string;
      status?: string;
      issueType?: string;
      priority?: number;
      parentId?: string;
      planId?: string;
    }
  ): Promise<IssueResult> {
    const args = ['issue', 'update', id];
    if (options.title) {
      args.push('--title', options.title);
    }
    if (options.description) {
      args.push('-d', options.description);
    }
    if (options.details) {
      args.push('--details', options.details);
    }
    if (options.status) {
      args.push('-s', options.status);
    }
    if (options.issueType) {
      args.push('-t', options.issueType);
    }
    if (options.priority !== undefined) {
      args.push('-p', String(options.priority));
    }
    if (options.parentId) {
      args.push('--parent', options.parentId);
    }
    if (options.planId) {
      args.push('--plan', options.planId);
    }
    return this.execute<IssueResult>(args);
  }

  async issueDelete(id: string): Promise<{ deleted: boolean }> {
    return this.execute<{ deleted: boolean }>(['issue', 'delete', id]);
  }

  async issueRelease(id: string): Promise<IssueResult> {
    return this.execute<IssueResult>(['issue', 'release', id]);
  }

  async issueAddDependency(
    issueId: string,
    dependsOnId: string,
    options?: { dependencyType?: string }
  ): Promise<DependencyResult> {
    const args = ['issue', 'dep', 'add', issueId, '--depends-on', dependsOnId];
    if (options?.dependencyType) {
      args.push('-t', options.dependencyType);
    }
    return this.execute<DependencyResult>(args);
  }

  async issueRemoveDependency(
    issueId: string,
    dependsOnId: string
  ): Promise<{ removed: boolean }> {
    return this.execute<{ removed: boolean }>(['issue', 'dep', 'remove', issueId, '--depends-on', dependsOnId]);
  }

  async issueAddLabels(id: string, labels: string[]): Promise<IssueResult> {
    return this.execute<IssueResult>(['issue', 'label', 'add', id, '-l', labels.join(',')]);
  }

  async issueRemoveLabels(id: string, labels: string[]): Promise<IssueResult> {
    return this.execute<IssueResult>(['issue', 'label', 'remove', id, '-l', labels.join(',')]);
  }

  async issueGetReady(options?: {
    limit?: number;
    sortBy?: string;
  }): Promise<IssueResult[]> {
    const args = ['issue', 'ready'];
    if (options?.limit) {
      args.push('-l', String(options.limit));
    }
    if (options?.sortBy) {
      args.push('--sort', options.sortBy);
    }
    return this.execute<IssueResult[]>(args);
  }

  async issueGetNextBlock(options?: {
    count?: number;
    labels?: string[];
    priorityMin?: number;
  }): Promise<IssueResult[]> {
    const args = ['issue', 'next-block'];
    if (options?.count) {
      args.push('-c', String(options.count));
    }
    if (options?.labels && options.labels.length > 0) {
      args.push('-l', options.labels.join(','));
    }
    if (options?.priorityMin !== undefined) {
      args.push('--priority-min', String(options.priorityMin));
    }
    return this.execute<IssueResult[]>(args);
  }

  async issueCreateBatch(
    issues: Array<{
      title: string;
      description?: string;
      details?: string;
      issueType?: string;
      priority?: number;
      parentId?: string;
      planId?: string;
      labels?: string[];
    }>,
    options?: {
      dependencies?: Array<{
        issueIndex: number;
        dependsOnIndex: number;
        dependencyType?: string;
      }>;
      planId?: string;
    }
  ): Promise<IssueBatchResult> {
    // Batch operations typically require JSON input via stdin or file
    // For now, we'll pass as JSON argument
    const batchData = {
      issues,
      dependencies: options?.dependencies,
      planId: options?.planId,
    };
    const args = ['issue', 'batch', '--json-input', JSON.stringify(batchData)];
    return this.execute<IssueBatchResult>(args);
  }

  async issueMarkDuplicate(
    id: string,
    duplicateOfId: string
  ): Promise<IssueResult> {
    return this.execute<IssueResult>(['issue', 'duplicate', id, '--of', duplicateOfId]);
  }

  async issueClone(
    id: string,
    options?: {
      title?: string;
      status?: string;
      includeLabels?: boolean;
    }
  ): Promise<IssueResult> {
    const args = ['issue', 'clone', id];
    if (options?.title) {
      args.push('--title', options.title);
    }
    if (options?.status) {
      args.push('-s', options.status);
    }
    if (options?.includeLabels === false) {
      args.push('--no-labels');
    }
    return this.execute<IssueResult>(args);
  }

  // ==========================================================================
  // Checkpoint Commands
  // ==========================================================================

  async checkpointCreate(
    name: string,
    options?: {
      description?: string;
      includeGit?: boolean;
      includeCategories?: string[];
      includeTags?: string[];
      excludeTags?: string[];
      includeKeys?: string[];
    }
  ): Promise<CheckpointResult> {
    const args = ['checkpoint', 'create', name];
    if (options?.description) {
      args.push('-d', options.description);
    }
    if (options?.includeGit) {
      args.push('--include-git');
    }
    if (options?.includeCategories && options.includeCategories.length > 0) {
      args.push('--categories', options.includeCategories.join(','));
    }
    if (options?.includeTags && options.includeTags.length > 0) {
      args.push('--tags', options.includeTags.join(','));
    }
    if (options?.excludeTags && options.excludeTags.length > 0) {
      args.push('--exclude-tags', options.excludeTags.join(','));
    }
    if (options?.includeKeys && options.includeKeys.length > 0) {
      args.push('--keys', options.includeKeys.join(','));
    }
    return this.execute<CheckpointResult>(args);
  }

  async checkpointList(options?: {
    sessionId?: string;
    projectPath?: string;
    search?: string;
    limit?: number;
    offset?: number;
    includeAllProjects?: boolean;
  }): Promise<CheckpointResult[]> {
    const args = ['checkpoint', 'list'];
    if (options?.sessionId) {
      args.push('--session', options.sessionId);
    }
    if (options?.projectPath) {
      args.push('--project', options.projectPath);
    }
    if (options?.search) {
      args.push('-s', options.search);
    }
    if (options?.limit) {
      args.push('-l', String(options.limit));
    }
    if (options?.offset !== undefined) {
      args.push('--offset', String(options.offset));
    }
    if (options?.includeAllProjects) {
      args.push('--all-projects');
    }
    return this.execute<CheckpointResult[]>(args);
  }

  async checkpointGet(id: string): Promise<CheckpointDetailResult> {
    return this.execute<CheckpointDetailResult>(['checkpoint', 'show', id]);
  }

  async checkpointRestore(
    id: string,
    options?: {
      restoreCategories?: string[];
      restoreTags?: string[];
    }
  ): Promise<{ restored: number }> {
    const args = ['checkpoint', 'restore', id];
    if (options?.restoreCategories && options.restoreCategories.length > 0) {
      args.push('--categories', options.restoreCategories.join(','));
    }
    if (options?.restoreTags && options.restoreTags.length > 0) {
      args.push('--tags', options.restoreTags.join(','));
    }
    return this.execute<{ restored: number }>(args);
  }

  async checkpointDelete(id: string): Promise<{ deleted: boolean }> {
    return this.execute<{ deleted: boolean }>(['checkpoint', 'delete', id]);
  }

  async checkpointAddItems(id: string, keys: string[]): Promise<CheckpointResult> {
    return this.execute<CheckpointResult>(['checkpoint', 'add-items', id, ...keys]);
  }

  async checkpointRemoveItems(id: string, keys: string[]): Promise<CheckpointResult> {
    return this.execute<CheckpointResult>(['checkpoint', 'remove-items', id, ...keys]);
  }

  async checkpointSplit(
    id: string,
    splits: Array<{
      name: string;
      description?: string;
      includeTags?: string[];
      includeCategories?: string[];
    }>
  ): Promise<CheckpointResult[]> {
    // Complex operation requires JSON input
    const args = ['checkpoint', 'split', id, '--json-input', JSON.stringify(splits)];
    return this.execute<CheckpointResult[]>(args);
  }

  // ==========================================================================
  // Project Commands
  // ==========================================================================

  async projectCreate(
    path: string,
    options?: {
      name?: string;
      description?: string;
      issuePrefix?: string;
    }
  ): Promise<ProjectResult> {
    const args = ['project', 'create', path];
    if (options?.name) {
      args.push('-n', options.name);
    }
    if (options?.description) {
      args.push('-d', options.description);
    }
    if (options?.issuePrefix) {
      args.push('--issue-prefix', options.issuePrefix);
    }
    return this.execute<ProjectResult>(args);
  }

  async projectGet(path: string): Promise<ProjectResult> {
    return this.execute<ProjectResult>(['project', 'show', path]);
  }

  async projectList(options?: {
    includeSessionCount?: boolean;
    limit?: number;
  }): Promise<ProjectResult[]> {
    const args = ['project', 'list'];
    if (options?.includeSessionCount) {
      args.push('--session-count');
    }
    if (options?.limit) {
      args.push('-l', String(options.limit));
    }
    return this.execute<ProjectResult[]>(args);
  }

  async projectUpdate(
    path: string,
    options: {
      name?: string;
      description?: string;
      issuePrefix?: string;
    }
  ): Promise<ProjectResult> {
    const args = ['project', 'update', path];
    if (options.name) {
      args.push('-n', options.name);
    }
    if (options.description) {
      args.push('-d', options.description);
    }
    if (options.issuePrefix) {
      args.push('--issue-prefix', options.issuePrefix);
    }
    return this.execute<ProjectResult>(args);
  }

  async projectDelete(path: string, confirm: boolean): Promise<{ deleted: boolean }> {
    const args = ['project', 'delete', path];
    if (confirm) {
      args.push('--confirm');
    }
    return this.execute<{ deleted: boolean }>(args);
  }

  // ==========================================================================
  // Plan Commands
  // ==========================================================================

  async planCreate(
    title: string,
    content: string,
    options?: {
      status?: string;
      successCriteria?: string;
      projectPath?: string;
    }
  ): Promise<PlanResult> {
    const args = ['plan', 'create', title, '--content', content];
    if (options?.status) {
      args.push('-s', options.status);
    }
    if (options?.successCriteria) {
      args.push('--criteria', options.successCriteria);
    }
    if (options?.projectPath) {
      args.push('--project', options.projectPath);
    }
    return this.execute<PlanResult>(args);
  }

  async planGet(id: string): Promise<PlanResult> {
    return this.execute<PlanResult>(['plan', 'show', id]);
  }

  async planList(options?: {
    status?: string;
    projectPath?: string;
    limit?: number;
  }): Promise<PlanResult[]> {
    const args = ['plan', 'list'];
    if (options?.status) {
      args.push('-s', options.status);
    }
    if (options?.projectPath) {
      args.push('--project', options.projectPath);
    }
    if (options?.limit) {
      args.push('-l', String(options.limit));
    }
    return this.execute<PlanResult[]>(args);
  }

  async planUpdate(
    id: string,
    options: {
      title?: string;
      content?: string;
      status?: string;
      successCriteria?: string;
      projectPath?: string;
    }
  ): Promise<PlanResult> {
    const args = ['plan', 'update', id];
    if (options.title) {
      args.push('--title', options.title);
    }
    if (options.content) {
      args.push('--content', options.content);
    }
    if (options.status) {
      args.push('-s', options.status);
    }
    if (options.successCriteria) {
      args.push('--criteria', options.successCriteria);
    }
    if (options.projectPath) {
      args.push('--project', options.projectPath);
    }
    return this.execute<PlanResult>(args);
  }

  // ==========================================================================
  // Compaction Command
  // ==========================================================================

  async prepareCompaction(): Promise<CompactionResult> {
    return this.execute<CompactionResult>(['compaction']);
  }

  // ==========================================================================
  // Prime Command (read-only context aggregation)
  // ==========================================================================

  async prime(options?: {
    transcript?: boolean;
    transcriptLimit?: number;
  }): Promise<PrimeResult> {
    const args = ['prime'];
    if (options?.transcript) {
      args.push('--transcript');
    }
    if (options?.transcriptLimit !== undefined) {
      args.push('--transcript-limit', String(options.transcriptLimit));
    }
    return this.execute<PrimeResult>(args);
  }

  // ==========================================================================
  // Status Command
  // ==========================================================================

  async status(): Promise<{
    session: SessionInfo | null;
    project_path: string | null;
    git_branch: string | null;
    item_count: number;
    high_priority_count: number;
  }> {
    return this.execute(['status']);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultBridge: CliBridge | null = null;

/**
 * Get the default CliBridge instance (singleton)
 */
export function getCliBridge(options?: ConstructorParameters<typeof CliBridge>[0]): CliBridge {
  // If sessionId is provided, always create a fresh bridge to ensure correct session
  // (sessionId changes between MCP calls as user switches sessions)
  if (options?.sessionId) {
    return new CliBridge(options);
  }

  // For non-session operations, use singleton
  if (!defaultBridge) {
    defaultBridge = new CliBridge(options);
  }
  return defaultBridge;
}

/**
 * Reset the default bridge (for testing)
 */
export function resetCliBridge(): void {
  defaultBridge = null;
}
