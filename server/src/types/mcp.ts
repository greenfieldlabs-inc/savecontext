// ========================
// MCP Tool Response Types
// ========================

import type { ContextItem } from './context';
import type { SessionStatus_Type } from './session';

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
  session_name: string;
  project_path: string;
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
