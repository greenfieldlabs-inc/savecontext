/**
 * SaveContext Cloud Client
 * Proxies MCP tool calls to cloud API endpoints
 */

import {
  ToolResponse,
  SaveContextResponse,
  GetContextResponse,
  CheckpointResponse,
  SessionResponse,
  SessionStatus,
  CreateSessionArgs,
  ResumeSessionArgs,
  SwitchSessionArgs,
  DeleteSessionArgs,
  RenameSessionArgs,
  ListSessionsArgs,
  AddSessionPathArgs,
  SaveContextArgs,
  GetContextArgs,
  UpdateContextArgs,
  DeleteContextArgs,
  SaveMemoryArgs,
  GetMemoryArgs,
  ListMemoryArgs,
  DeleteMemoryArgs,
  CreateTaskArgs,
  UpdateTaskArgs,
  ListTasksArgs,
  CompleteTaskArgs,
  CreateCheckpointArgs,
  RestoreCheckpointArgs,
  TagContextItemsArgs,
  CheckpointItemManagementArgs,
  CheckpointSplitArgs,
  DeleteCheckpointArgs,
  ListCheckpointsArgs,
  GetCheckpointArgs,
  CloudConfig,
  AgentMetadata,
  ErrorResponse,
} from './types/index.js';

export class CloudClient {
  private config: CloudConfig;
  private currentAgentMetadata: AgentMetadata | null = null;
  private currentSessionId: string | null = null;

  constructor(apiKey: string, baseUrl: string) {
    this.config = {
      apiKey,
      baseUrl,
    };
  }

  setAgentMetadata(agentId: string, projectPath: string, gitBranch: string | null, provider: string): void {
    this.currentAgentMetadata = {
      agentId,
      projectPath,
      gitBranch,
      provider,
    };
  }

  private async makeRequest<T = unknown>(endpoint: string, method: string = 'GET', body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };

    // Add agent metadata headers if available
    if (this.currentAgentMetadata) {
      headers['X-Agent-ID'] = this.currentAgentMetadata.agentId;
      headers['X-Project-Path'] = this.currentAgentMetadata.projectPath;
      headers['X-Git-Branch'] = this.currentAgentMetadata.gitBranch || '';
      headers['X-Provider'] = this.currentAgentMetadata.provider;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch((): ErrorResponse => ({ error: 'Request failed' }));
      const errorMessage = (errorData as ErrorResponse).error || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage);
    }

    return response.json().catch(() => ({ success: true })) as Promise<T>;
  }

  // ====================
  // Health Check
  // ====================

  async ping(): Promise<ToolResponse> {
    return this.makeRequest('/ping');
  }

  // ====================
  // Session Methods
  // ====================

  async startSession(args: CreateSessionArgs): Promise<ToolResponse<SessionResponse>> {
    const response: ToolResponse<SessionResponse> = await this.makeRequest('/session/start', 'POST', args);
    if (response.success && response.data?.id) {
      this.currentSessionId = response.data.id;
    }
    return response;
  }

  async getSessionStatus(): Promise<ToolResponse<SessionStatus>> {
    return this.makeRequest('/session/status', 'POST');
  }

  async renameSession(args: RenameSessionArgs): Promise<ToolResponse> {
    return this.makeRequest('/session/rename', 'POST', args);
  }

  async listSessions(args: ListSessionsArgs): Promise<ToolResponse> {
    return this.makeRequest('/session/list', 'POST', args);
  }

  async endSession(): Promise<ToolResponse> {
    return this.makeRequest('/session/end', 'POST');
  }

  async pauseSession(): Promise<ToolResponse> {
    const response: ToolResponse = await this.makeRequest('/session/pause', 'POST');
    if (response.success) {
      this.currentSessionId = null; // Clear session ID when paused
    }
    return response;
  }

  async resumeSession(args: ResumeSessionArgs): Promise<ToolResponse> {
    const response: ToolResponse = await this.makeRequest('/session/resume', 'POST', args);
    if (response.success) {
      this.currentSessionId = args.session_id;
    }
    return response;
  }

  async switchSession(args: SwitchSessionArgs): Promise<ToolResponse> {
    const response: ToolResponse = await this.makeRequest('/session/switch', 'POST', args);
    if (response.success) {
      this.currentSessionId = args.session_id;
    }
    return response;
  }

  async deleteSession(args: DeleteSessionArgs): Promise<ToolResponse> {
    return this.makeRequest('/session/delete', 'POST', args);
  }

  async addSessionPath(args: AddSessionPathArgs): Promise<ToolResponse> {
    return this.makeRequest('/session/add-path', 'POST', args);
  }

  // ====================
  // Context Methods
  // ====================

  async saveContext(args: SaveContextArgs): Promise<ToolResponse<SaveContextResponse>> {
    // Ensure we have a session
    if (!this.currentSessionId) {
      await this.ensureSession();
    }

    return this.makeRequest('/context/save', 'POST', {
      ...args,
      session_id: this.currentSessionId,
    });
  }

  private async ensureSession(): Promise<void> {
    try {
      const status: ToolResponse<SessionStatus> = await this.makeRequest('/session/status', 'POST');
      if (status.success && status.data?.current_session_id) {
        this.currentSessionId = status.data.current_session_id;
      }
    } catch (err) {
      // Log error but continue - API will return appropriate error if no session
      console.error('[SaveContext] Failed to ensure session:', err);
    }
  }

  async getContext(args: GetContextArgs): Promise<ToolResponse<GetContextResponse>> {
    return this.makeRequest('/context/get', 'POST', {
      ...args,
      session_id: this.currentSessionId,
    });
  }

  async updateContext(args: UpdateContextArgs): Promise<ToolResponse> {
    return this.makeRequest('/context/update', 'POST', {
      ...args,
      session_id: this.currentSessionId,
    });
  }

  async deleteContext(args: DeleteContextArgs): Promise<ToolResponse> {
    return this.makeRequest('/context/delete', 'POST', {
      ...args,
      session_id: this.currentSessionId,
    });
  }

  // ====================
  // Memory Methods
  // ====================

  async saveMemory(args: SaveMemoryArgs): Promise<ToolResponse> {
    return this.makeRequest('/memory/save', 'POST', args);
  }

  async getMemory(args: GetMemoryArgs): Promise<ToolResponse> {
    return this.makeRequest('/memory/get', 'POST', args);
  }

  async listMemory(args: ListMemoryArgs): Promise<ToolResponse> {
    return this.makeRequest('/memory/list', 'POST', args);
  }

  async deleteMemory(args: DeleteMemoryArgs): Promise<ToolResponse> {
    return this.makeRequest('/memory/delete', 'POST', args);
  }

  // ====================
  // Task Methods
  // ====================

  async createTask(args: CreateTaskArgs): Promise<ToolResponse> {
    return this.makeRequest('/task/create', 'POST', args);
  }

  async updateTask(args: UpdateTaskArgs): Promise<ToolResponse> {
    return this.makeRequest('/task/update', 'POST', args);
  }

  async listTasks(args: ListTasksArgs): Promise<ToolResponse> {
    return this.makeRequest('/task/list', 'POST', args);
  }

  async completeTask(args: CompleteTaskArgs): Promise<ToolResponse> {
    return this.makeRequest('/task/complete', 'POST', args);
  }

  // ====================
  // Checkpoint Methods
  // ====================

  async createCheckpoint(args: CreateCheckpointArgs): Promise<ToolResponse<CheckpointResponse>> {
    // Include session_id if we have a current session and args doesn't already have one
    const payload = { ...args } as CreateCheckpointArgs & { session_id?: string };
    if (!payload.session_id && this.currentSessionId) {
      payload.session_id = this.currentSessionId;
    }
    return this.makeRequest('/checkpoint/create', 'POST', payload);
  }

  async prepareCompaction(): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/prepare-compaction', 'POST', { session_id: this.currentSessionId });
  }

  async restoreCheckpoint(args: RestoreCheckpointArgs): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/restore', 'POST', args);
  }

  async tagContextItems(args: TagContextItemsArgs): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/tag', 'POST', args);
  }

  async addItemsToCheckpoint(args: CheckpointItemManagementArgs): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/add-items', 'POST', args);
  }

  async removeItemsFromCheckpoint(args: CheckpointItemManagementArgs): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/remove-items', 'POST', args);
  }

  async splitCheckpoint(args: CheckpointSplitArgs): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/split', 'POST', args);
  }

  async deleteCheckpoint(args: DeleteCheckpointArgs): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/delete', 'POST', args);
  }

  async listCheckpoints(args: ListCheckpointsArgs): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/list', 'POST', args);
  }

  async getCheckpoint(args: GetCheckpointArgs): Promise<ToolResponse> {
    return this.makeRequest('/checkpoint/get', 'POST', args);
  }
}
