// Project-related types

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  project_path: string;
  session_count: number;
  active_sessions: number;
  total_items: number;
  created_at: number;
  updated_at: number;
}

export interface AffectedSessionRow {
  id: string;
  project_path: string | null;
}

export interface SessionPathUpdate {
  id: string;
  newPaths: string[];
}

export interface ProjectDeletionResult {
  sessions: number;
  sessionsUpdated: number;
  contexts: number;
  checkpoints: number;
  checkpointItems: number;
  tasks: number;
  memory: number;
}

export interface ProjectOperationResult {
  success: boolean;
  sessionId?: string;
  projectId?: string;
  projectIds?: string[];
  error?: string;
}
