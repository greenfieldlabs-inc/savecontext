// Project-related types

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  source_path: string | null;
  session_count: number;
  active_sessions: number;
  total_items: number;
  created_at: number;
  updated_at: number;
  // Legacy field for backwards compatibility during transition
  project_path: string;
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
