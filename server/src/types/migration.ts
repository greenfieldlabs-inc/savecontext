// ====================
// Migration Types
// ====================

export interface MigrationStats {
  sessions: number;
  contextItems: number;
  checkpoints: number;
  checkpointItems: number;
  projectMemory: number;
  issues: number;
  sessionProjects: number;
  agentSessions: number;
}

export interface MigrationStatusResponse {
  canMigrate: boolean;
  stats?: {
    sessions: number;
    projectMemory: number;
    issues: number;
  };
}

export interface MigrationResult {
  error?: string;
  message?: string;
  migrated?: {
    sessions: number;
    contextItems: number;
    checkpoints: number;
    projectMemory: number;
    issues: number;
  };
}
