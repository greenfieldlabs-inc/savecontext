// Session-related types

export type SessionStatus = 'active' | 'paused' | 'completed';

export interface Session {
  id: string;
  name: string;
  description: string | null;
  branch: string | null;
  channel: string;
  project_path: string | null;
  status: SessionStatus;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
  user_id: string | null;
  synced_at: number | null;
  is_synced: number;
}

export interface AgentInfo {
  agent_id: string;
  provider: string;
  git_branch: string | null;
  last_active_at: number;
}

export interface SessionWithProjects extends Session {
  all_project_paths: string[];
}

export interface SessionWithAgents extends SessionWithProjects {
  agents: AgentInfo[];
}

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

export interface SessionProject {
  session_id: string;
  project_path: string;
  added_at: number;
}

export interface AgentSession {
  agent_id: string;
  session_id: string;
  project_path: string;
  git_branch: string;
  provider: string;
  last_active_at: number;
}

export interface SessionOperationResult {
  success: boolean;
  session?: {
    id: string;
    name: string;
    status: string;
  };
  error?: string;
}

export interface DeleteSessionResult {
  success: boolean;
  deletedSessionId?: string;
  deletedSessionName?: string;
  error?: string;
}

export interface SessionProjectInfo {
  id: string;
  name: string;
  sourcePath: string | null;
  isPrimary: boolean;
}

export interface GetSessionProjectsResult {
  success: boolean;
  projects?: SessionProjectInfo[];
  error?: string;
}
