/**
 * Database Adapter - Local SQLite interface
 *
 * Reads from the local SaveContext database at ~/.savecontext/data/savecontext.db
 */

import type {
  Session,
  SessionWithProjects,
  SessionWithAgents,
  SessionSummary,
  AgentInfo,
  ContextItem,
  Checkpoint,
  SessionProject,
  Stats,
  Memory,
  Issue,
  IssueStats,
  ProjectSummary,
  Plan,
  LabelInfo
} from './types';

// Local SQLite database
const sqliteDb = require('./db');

// Sessions
export async function getAllSessions(): Promise<Session[]> {
  return sqliteDb.getAllSessions();
}

export async function getAllSessionsWithProjects(): Promise<SessionWithProjects[]> {
  return sqliteDb.getAllSessionsWithProjects();
}

export async function getAllSessionsWithAgents(): Promise<SessionWithAgents[]> {
  return sqliteDb.getAllSessionsWithAgents();
}

export async function getSessionById(id: string): Promise<Session | null> {
  return sqliteDb.getSessionById(id);
}

export async function getSessionsByProject(projectPath: string): Promise<Session[]> {
  return sqliteDb.getSessionsByProject(projectPath);
}

export async function getSessionsByProjectWithProjects(projectPath: string): Promise<SessionWithProjects[]> {
  return sqliteDb.getSessionsByProjectWithProjects(projectPath);
}

export async function getSessionsByProjectWithAgents(projectPath: string): Promise<SessionWithAgents[]> {
  return sqliteDb.getSessionsByProjectWithAgents(projectPath);
}

export async function getSessionsByStatus(status: 'active' | 'paused' | 'completed'): Promise<Session[]> {
  return sqliteDb.getSessionsByStatus(status);
}

export async function getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
  return sqliteDb.getSessionSummary(sessionId);
}

export async function getAgentsForSession(sessionId: string): Promise<AgentInfo[]> {
  return sqliteDb.getAgentsForSession(sessionId);
}

// Context Items
export async function getContextItemsBySession(sessionId: string): Promise<ContextItem[]> {
  return sqliteDb.getContextItemsBySession(sessionId);
}

export async function getContextItemsByCategory(sessionId: string, category: 'reminder' | 'decision' | 'progress' | 'note'): Promise<ContextItem[]> {
  return sqliteDb.getContextItemsByCategory(sessionId, category);
}

export async function getHighPriorityItems(sessionId?: string): Promise<ContextItem[]> {
  return sqliteDb.getHighPriorityItems(sessionId);
}

export async function getContextItemsCountBySession(sessionId: string): Promise<number> {
  const items = sqliteDb.getContextItemsBySession(sessionId);
  return items?.length || 0;
}

export async function getCheckpointsCountBySession(sessionId: string): Promise<number> {
  const checkpoints = sqliteDb.getCheckpointsBySession(sessionId);
  return checkpoints?.length || 0;
}

// Checkpoints
export async function getAllCheckpoints(): Promise<Checkpoint[]> {
  return sqliteDb.getAllCheckpoints();
}

export async function getCheckpointById(id: string): Promise<Checkpoint | null> {
  return sqliteDb.getCheckpointById(id);
}

export async function getCheckpointsBySession(sessionId: string): Promise<Checkpoint[]> {
  return sqliteDb.getCheckpointsBySession(sessionId);
}

export async function getCheckpointItems(checkpointId: string): Promise<ContextItem[]> {
  return sqliteDb.getCheckpointItems(checkpointId);
}

export async function getCheckpointsByProject(projectPath: string): Promise<Checkpoint[]> {
  return sqliteDb.getCheckpointsByProject(projectPath);
}

export async function searchCheckpoints(query: string): Promise<Checkpoint[]> {
  return sqliteDb.searchCheckpoints(query);
}

// Projects
export async function getAllProjects(): Promise<ProjectSummary[]> {
  return sqliteDb.getAllProjects();
}

export async function getSessionProjects(sessionId: string): Promise<SessionProject[]> {
  return sqliteDb.getSessionProjects(sessionId);
}

// Stats
export async function getStats(): Promise<Stats> {
  return sqliteDb.getStats();
}

export async function getSessionsOverTime(days?: number): Promise<Array<{ date: string; count: number }>> {
  return sqliteDb.getSessionsOverTime(days);
}

export async function getItemsByCategory(): Promise<Array<{ category: string; count: number }>> {
  return sqliteDb.getItemsByCategory();
}

export async function getItemsByPriority(): Promise<Array<{ priority: string; count: number }>> {
  return sqliteDb.getItemsByPriority();
}

// Memory
export async function getMemoryItems(projectPath?: string, category?: string): Promise<Memory[]> {
  return sqliteDb.getMemoryItems(projectPath, category);
}

export async function getMemoryByKey(projectPath: string, key: string): Promise<Memory | null> {
  return sqliteDb.getMemoryByKey(projectPath, key);
}

export async function getMemoryCount(projectPath: string): Promise<number> {
  return sqliteDb.getMemoryCount(projectPath);
}

export async function deleteMemoryItem(projectPath: string, key: string): Promise<number> {
  return sqliteDb.deleteMemoryItem(projectPath, key);
}

// Issues
export async function getIssues(
  projectPath?: string,
  status?: string,
  timeFilter?: { createdAfter?: number; updatedAfter?: number }
): Promise<Issue[]> {
  return sqliteDb.getIssues
    ? sqliteDb.getIssues(projectPath, status, timeFilter)
    : sqliteDb.getTasks(projectPath, status);
}

export async function getIssueById(id: string): Promise<Issue | null> {
  return sqliteDb.getIssueById ? sqliteDb.getIssueById(id) : sqliteDb.getTaskById(id);
}

export async function getIssueStats(projectPath?: string): Promise<IssueStats> {
  if (sqliteDb.getIssueStats) {
    return sqliteDb.getIssueStats(projectPath);
  }
  // Fallback for old schema
  // Note: "duplicate" is not a status - it's a relation type (duplicate-of dependency)
  const oldStats = sqliteDb.getTaskStats?.(projectPath) || { total: 0 };
  return {
    backlog: oldStats.backlog || 0,
    open: oldStats.todo || oldStats.open || 0,
    in_progress: oldStats.in_progress || 0,
    blocked: oldStats.blocked || 0,
    closed: oldStats.done || oldStats.closed || 0,
    deferred: oldStats.deferred || 0,
    total: oldStats.total || 0,
    by_priority: oldStats.by_priority || {},
    by_type: oldStats.by_type || {}
  };
}

// Plans
export async function getPlans(projectPath?: string, status?: string): Promise<Plan[]> {
  return sqliteDb.getPlans(projectPath, status);
}

export async function getPlanById(id: string): Promise<Plan | null> {
  return sqliteDb.getPlanById(id);
}

export async function getPlanStats(projectPath?: string): Promise<{ total: number; draft: number; active: number; completed: number }> {
  return sqliteDb.getPlanStats(projectPath);
}

// Labels
export async function getAllLabels(projectPath?: string, search?: string): Promise<LabelInfo[]> {
  return sqliteDb.getAllLabels(projectPath, search);
}

export async function getIssueLabels(issueId: string): Promise<string[]> {
  return sqliteDb.getIssueLabels(issueId);
}

export async function addIssueLabels(issueId: string, labels: string[]): Promise<number> {
  return sqliteDb.addIssueLabels(issueId, labels);
}

export async function removeIssueLabels(issueId: string, labels: string[]): Promise<number> {
  return sqliteDb.removeIssueLabels(issueId, labels);
}

export async function setIssueLabels(issueId: string, labels: string[]): Promise<void> {
  return sqliteDb.setIssueLabels(issueId, labels);
}
