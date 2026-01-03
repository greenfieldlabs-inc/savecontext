// ====================
// Status & Info Types
// ====================

import type { SessionStatus_Type } from './session';
import type { RecentSession } from './views';

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
