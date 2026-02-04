/**
 * Type mapping utilities for CliBridge
 *
 * Converts between Rust CLI conventions (snake_case) and
 * TypeScript/MCP conventions (camelCase).
 */

// ============================================================================
// Generic Case Conversion
// ============================================================================

/**
 * Convert snake_case string to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase string to snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Recursively convert all keys in an object from snake_case to camelCase
 */
export function mapSnakeToCamel<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => mapSnakeToCamel(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = mapSnakeToCamel(value);
    }
    return result as T;
  }

  return obj as T;
}

/**
 * Recursively convert all keys in an object from camelCase to snake_case
 */
export function mapCamelToSnake<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => mapCamelToSnake(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = camelToSnake(key);
      result[snakeKey] = mapCamelToSnake(value);
    }
    return result as T;
  }

  return obj as T;
}

// ============================================================================
// Session Types & Mappers
// ============================================================================

export interface SessionResponse {
  id: string;
  name: string;
  description?: string;
  status: string;
  channel?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  projectPaths?: string[];
}

export function mapSessionResponse(cliResponse: unknown): SessionResponse {
  return mapSnakeToCamel<SessionResponse>(cliResponse);
}

export function mapSessionListResponse(cliResponse: unknown): SessionResponse[] {
  if (!Array.isArray(cliResponse)) {
    return [];
  }
  return cliResponse.map(mapSessionResponse);
}

// ============================================================================
// Context Item Types & Mappers
// ============================================================================

export interface ContextItemResponse {
  id: string;
  key: string;
  value: string;
  category: string;
  priority: string;
  sessionId: string;
  channel?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export function mapContextItemResponse(cliResponse: unknown): ContextItemResponse {
  return mapSnakeToCamel<ContextItemResponse>(cliResponse);
}

export function mapContextGetResponse(cliResponse: unknown): {
  items: ContextItemResponse[];
  count: number;
} {
  const mapped = mapSnakeToCamel<{ items: unknown[]; count: number }>(cliResponse);
  return {
    items: mapped.items?.map(mapContextItemResponse) ?? [],
    count: mapped.count ?? 0,
  };
}

// ============================================================================
// Issue Types & Mappers
// ============================================================================

export interface IssueResponse {
  id: string;
  shortId: string;
  title: string;
  description?: string;
  details?: string;
  status: string;
  issueType: string;
  priority: number;
  parentId?: string;
  planId?: string;
  assignee?: string;
  labels?: string[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export function mapIssueResponse(cliResponse: unknown): IssueResponse {
  const mapped = mapSnakeToCamel<IssueResponse>(cliResponse);
  // Handle special case: CLI returns 'issue_type', maps to 'issueType'
  return mapped;
}

export function mapIssueListResponse(cliResponse: unknown): IssueResponse[] {
  if (!Array.isArray(cliResponse)) {
    return [];
  }
  return cliResponse.map(mapIssueResponse);
}

export interface IssueBatchResponse {
  issues: IssueResponse[];
  dependencies: Array<{
    issueShortId: string;
    dependsOnShortId: string;
    dependencyType: string;
  }>;
  count: number;
  dependencyCount: number;
}

export function mapIssueBatchResponse(cliResponse: unknown): IssueBatchResponse {
  return mapSnakeToCamel<IssueBatchResponse>(cliResponse);
}

// ============================================================================
// Checkpoint Types & Mappers
// ============================================================================

export interface CheckpointResponse {
  id: string;
  name: string;
  description?: string;
  sessionId: string;
  gitBranch?: string;
  gitStatus?: string;
  itemCount: number;
  createdAt: number;
}

export function mapCheckpointResponse(cliResponse: unknown): CheckpointResponse {
  return mapSnakeToCamel<CheckpointResponse>(cliResponse);
}

export function mapCheckpointListResponse(cliResponse: unknown): CheckpointResponse[] {
  if (!Array.isArray(cliResponse)) {
    return [];
  }
  return cliResponse.map(mapCheckpointResponse);
}

export interface CheckpointDetailResponse extends CheckpointResponse {
  items: ContextItemResponse[];
}

export function mapCheckpointDetailResponse(cliResponse: unknown): CheckpointDetailResponse {
  const mapped = mapSnakeToCamel<CheckpointDetailResponse>(cliResponse);
  if (mapped.items) {
    mapped.items = mapped.items.map(mapContextItemResponse);
  }
  return mapped;
}

// ============================================================================
// Memory Types & Mappers
// ============================================================================

export interface MemoryResponse {
  id: string;
  key: string;
  value: string;
  category: string;
  projectPath: string;
  createdAt: number;
  updatedAt: number;
}

export function mapMemoryResponse(cliResponse: unknown): MemoryResponse {
  return mapSnakeToCamel<MemoryResponse>(cliResponse);
}

export function mapMemoryListResponse(cliResponse: unknown): MemoryResponse[] {
  if (!Array.isArray(cliResponse)) {
    return [];
  }
  return cliResponse.map(mapMemoryResponse);
}

// ============================================================================
// Project Types & Mappers
// ============================================================================

export interface ProjectResponse {
  id: string;
  path: string;
  name: string;
  description?: string;
  issuePrefix: string;
  createdAt: number;
  updatedAt: number;
}

export function mapProjectResponse(cliResponse: unknown): ProjectResponse {
  return mapSnakeToCamel<ProjectResponse>(cliResponse);
}

export function mapProjectListResponse(cliResponse: unknown): ProjectResponse[] {
  if (!Array.isArray(cliResponse)) {
    return [];
  }
  return cliResponse.map(mapProjectResponse);
}

// ============================================================================
// Plan Types & Mappers
// ============================================================================

export interface PlanResponse {
  id: string;
  title: string;
  content: string;
  status: string;
  successCriteria?: string;
  projectPath: string;
  createdAt: number;
  updatedAt: number;
}

export function mapPlanResponse(cliResponse: unknown): PlanResponse {
  return mapSnakeToCamel<PlanResponse>(cliResponse);
}

export function mapPlanListResponse(cliResponse: unknown): PlanResponse[] {
  if (!Array.isArray(cliResponse)) {
    return [];
  }
  return cliResponse.map(mapPlanResponse);
}

// ============================================================================
// Status Types & Mappers
// ============================================================================

export interface StatusResponse {
  session: SessionResponse | null;
  projectPath: string | null;
  gitBranch: string | null;
  itemCount: number;
  highPriorityCount: number;
}

export function mapStatusResponse(cliResponse: unknown): StatusResponse {
  const mapped = mapSnakeToCamel<StatusResponse>(cliResponse);
  if (mapped.session) {
    mapped.session = mapSessionResponse(mapped.session);
  }
  return mapped;
}

// ============================================================================
// Compaction Types & Mappers
// ============================================================================

export interface CompactionResponse {
  checkpointId: string;
  checkpointName: string;
  summary: string;
  highPriorityItems: ContextItemResponse[];
  recentDecisions: ContextItemResponse[];
  activeProgress: ContextItemResponse[];
  nextSteps: string[];
  restorationPrompt: string;
}

export function mapCompactionResponse(cliResponse: unknown): CompactionResponse {
  const mapped = mapSnakeToCamel<CompactionResponse>(cliResponse);
  if (mapped.highPriorityItems) {
    mapped.highPriorityItems = mapped.highPriorityItems.map(mapContextItemResponse);
  }
  if (mapped.recentDecisions) {
    mapped.recentDecisions = mapped.recentDecisions.map(mapContextItemResponse);
  }
  if (mapped.activeProgress) {
    mapped.activeProgress = mapped.activeProgress.map(mapContextItemResponse);
  }
  return mapped;
}

// ============================================================================
// Tag Types & Mappers
// ============================================================================

export interface TagResponse {
  tagged: number;
  keys: string[];
}

export function mapTagResponse(cliResponse: unknown): TagResponse {
  return mapSnakeToCamel<TagResponse>(cliResponse);
}

// ============================================================================
// Dependency Types & Mappers
// ============================================================================

export interface DependencyResponse {
  issueId: string;
  dependsOnId: string;
  dependencyType: string;
  createdAt: number;
}

export function mapDependencyResponse(cliResponse: unknown): DependencyResponse {
  return mapSnakeToCamel<DependencyResponse>(cliResponse);
}
