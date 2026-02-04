/**
 * CLI module exports
 *
 * Provides the CliBridge for delegating operations to the Rust CLI,
 * and feature flag utilities for gradual migration.
 */

export {
  CliBridge,
  getCliBridge,
  resetCliBridge,
  isCliBridgeEnabled,
  isCliBridgeEnabledFor,
  // Types
  type CliResult,
  type SessionStartResult,
  type SessionInfo,
  type ContextSaveResult,
  type ContextGetResult,
  type ContextItem,
  type EmbeddingsStatusResult,
  type EmbeddingsTestResult,
  type ProviderStatus,
  type ActiveProviderInfo,
  type SyncStatusResult,
  type ExportFileInfo,
  type IssueResult,
  type MemoryResult,
  type CheckpointResult,
  type ProjectResult,
  type PlanResult,
  type TagResult,
  type DependencyResult,
  type CompactionResult,
} from './bridge.js';

// Type mapping utilities
export {
  snakeToCamel,
  camelToSnake,
  mapSnakeToCamel,
  mapCamelToSnake,
  mapSessionResponse,
  mapSessionListResponse,
  mapContextItemResponse,
  mapContextGetResponse,
  mapIssueResponse,
  mapIssueListResponse,
  mapIssueBatchResponse,
  mapCheckpointResponse,
  mapCheckpointListResponse,
  mapCheckpointDetailResponse,
  mapMemoryResponse,
  mapMemoryListResponse,
  mapProjectResponse,
  mapProjectListResponse,
  mapPlanResponse,
  mapPlanListResponse,
  mapStatusResponse,
  mapCompactionResponse,
  mapTagResponse,
  mapDependencyResponse,
  // Types
  type SessionResponse,
  type ContextItemResponse,
  type IssueResponse,
  type IssueBatchResponse,
  type CheckpointResponse,
  type CheckpointDetailResponse,
  type MemoryResponse,
  type ProjectResponse,
  type PlanResponse,
  type StatusResponse,
  type CompactionResponse,
  type TagResponse,
  type DependencyResponse,
} from './mappers.js';

// Delegation helpers for MCP handlers
export {
  shouldUseCliBridge,
  delegateToCliBridge,
  getBridge,
  Features,
} from './delegate.js';
