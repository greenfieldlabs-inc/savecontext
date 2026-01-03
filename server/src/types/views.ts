// ====================================
// View Types (for convenience queries)
// ====================================

import type { SessionStatus_Type } from './session';

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
