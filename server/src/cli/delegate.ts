/**
 * CliBridge Delegation Helpers
 *
 * Provides utilities for MCP handlers to optionally delegate to
 * the Rust CLI based on feature flags. This enables gradual migration
 * using the Strangler Fig pattern.
 *
 * Usage in handlers:
 *   if (shouldUseCliBridge('session')) {
 *     return await delegateToCliBridge(() => bridge.sessionList(options));
 *   }
 *   // ... original implementation
 */

import {
  getCliBridge,
  isCliBridgeEnabledFor,
  mapSnakeToCamel,
} from './index.js';

/**
 * Check if CLI bridge should be used for a specific feature.
 * Returns false if bridge is unavailable or disabled.
 */
export function shouldUseCliBridge(feature: string): boolean {
  return isCliBridgeEnabledFor(feature);
}

/**
 * Delegate an operation to the CLI bridge with standard error handling.
 * Converts CLI response from snake_case to camelCase automatically.
 *
 * @param operation - Async function that calls the bridge
 * @param options - Optional configuration
 * @returns Tool response in standard format
 */
export async function delegateToCliBridge<T>(
  operation: () => Promise<T>,
  options: {
    /** Custom success message */
    message?: string;
    /** Skip automatic snake_case to camelCase conversion */
    skipCaseConversion?: boolean;
    /** Operation name for debug logging */
    operationName?: string;
  } = {}
): Promise<{ success: true; data: T; message?: string } | { success: false; error: string }> {
  const debug = process.env.SC_DEBUG === 'true';
  const opName = options.operationName || 'unknown';

  if (debug) {
    console.log(`[CLI Bridge] Delegating: ${opName}`);
  }

  try {
    const result = await operation();

    // Convert snake_case to camelCase unless skipped
    const data = options.skipCaseConversion ? result : mapSnakeToCamel<T>(result);

    if (debug) {
      console.log(`[CLI Bridge] Success: ${opName}`);
    }

    return {
      success: true,
      data,
      ...(options.message && { message: options.message }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (debug) {
      console.log(`[CLI Bridge] Error: ${opName} - ${message}`);
    }
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Get a configured CliBridge instance.
 * Pass dbPath, actor, and sessionId to ensure CLI uses correct context.
 *
 * @param options.dbPath - Database path
 * @param options.actor - Actor name for audit trail
 * @param options.sessionId - Current session ID (MCP server's currentSessionId)
 */
export function getBridge(options?: { dbPath?: string; actor?: string; sessionId?: string }) {
  return getCliBridge(options);
}

/**
 * Feature names for use with shouldUseCliBridge()
 */
export const Features = {
  SESSION: 'session',
  CONTEXT: 'context',
  MEMORY: 'memory',
  ISSUE: 'issue',
  CHECKPOINT: 'checkpoint',
  PROJECT: 'project',
  PLAN: 'plan',
  SYNC: 'sync',
  EMBEDDINGS: 'embeddings',
  COMPACTION: 'compaction',
  PRIME: 'prime',
  STATUS: 'status',
} as const;
