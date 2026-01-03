/**
 * Shared constants for SaveContext MCP Server
 */

// Compaction thresholds
export const COMPACTION_THRESHOLD_DEFAULT = 70;
export const COMPACTION_THRESHOLD_MIN = 50;
export const COMPACTION_THRESHOLD_MAX = 90;
export const COMPACTION_HIGH_PRIORITY_LIMIT = 50;
export const COMPACTION_DECISION_LIMIT = 20;
export const COMPACTION_REMINDER_LIMIT = 20;
export const COMPACTION_PROGRESS_LIMIT = 10;
export const COMPACTION_ITEM_COUNT_THRESHOLD = 40;

// Embedding provider
export const EMBEDDING_PROVIDER_RETRY_INTERVAL = 60000; // 1 minute between retries

// Schema constraints
export const SESSION_NAME_MAX_LENGTH = 200;
export const CONTEXT_VALUE_MAX_LENGTH = 100000;
export const CONTEXT_ITEMS_DEFAULT_LIMIT = 100;
export const CONTEXT_ITEMS_MAX_LIMIT = 300;
