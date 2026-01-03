// ====================
// Cloud Client Types
// ====================

export interface CloudConfig {
  apiKey: string;
  baseUrl: string;
}

export interface AgentMetadata {
  agentId: string;
  projectPath: string;
  gitBranch: string | null;
  provider: string;
}

export interface ErrorResponse {
  error?: string;
}

