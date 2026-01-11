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
