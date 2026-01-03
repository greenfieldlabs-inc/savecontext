// ====================
// Session Types
// ====================

export type SessionStatus_Type = 'active' | 'paused' | 'completed';

export interface Session {
  id: string;
  name: string;
  description?: string;
  branch?: string;
  channel: string;
  project_path?: string;        // Absolute path to project/repo
  status?: SessionStatus_Type;  // Session lifecycle state
  ended_at?: number;            // Timestamp when paused/completed
  created_at: number;           // Unix timestamp (ms)
  updated_at: number;

  // Cloud sync fields (optional for MVP)
  user_id?: string;
  synced_at?: number;
  is_synced?: number;
}

export interface CreateSessionArgs {
  name: string;
  description?: string;
  branch?: string;
  channel?: string;
  project_path?: string;
  force_new?: boolean;
}

export interface ResumeSessionArgs {
  session_id: string;
  session_name: string;
}

export interface SwitchSessionArgs {
  session_id: string;
  session_name: string;
}

export interface DeleteSessionArgs {
  session_id: string;
  session_name: string;
}

export interface EndSessionArgs {
  session_id?: string; // Optional override for CLI targeting specific sessions
  session_name?: string;
}

export interface PauseSessionArgs {
  session_id?: string; // Optional override for CLI targeting specific sessions
  session_name?: string;
}

export interface RenameSessionArgs {
  current_name: string;
  new_name: string;
  session_id?: string; // Optional override for CLI targeting specific sessions
}

export interface ListSessionsArgs {
  limit?: number;
  project_path?: string;
  status?: 'active' | 'paused' | 'completed' | 'all';
  include_completed?: boolean;
  search?: string;
}

export interface AddSessionPathArgs {
  session_id: string;
  session_name: string;
  project_path?: string;
}

export interface RemoveSessionPathArgs {
  session_id: string;
  session_name: string;
  project_path: string;  // Required - must specify which path to remove
}

