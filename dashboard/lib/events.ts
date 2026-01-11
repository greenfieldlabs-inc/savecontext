// SQLite-based event queue for SSE broadcasts
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { SSE_CLEANUP_INTERVAL, SSE_EVENT_RETENTION } from '@/lib/constants/time';

// Singleton database connection
let dbInstance: Database | null = null;
let lastCleanup = 0;

function getDb(): Database {
  if (!dbInstance) {
    const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
    dbInstance = new Database(dbPath);

    // Create events table if not exists (only on first connection)
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS sse_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        data TEXT,
        timestamp INTEGER NOT NULL
      )
    `);
  }

  // Periodic cleanup instead of every call
  const now = Date.now();
  if (now - lastCleanup > SSE_CLEANUP_INTERVAL) {
    dbInstance.prepare(`DELETE FROM sse_events WHERE timestamp < ?`).run(now - SSE_EVENT_RETENTION);
    lastCleanup = now;
  }

  return dbInstance;
}

export function emitEvent(event: string, data?: unknown) {
  const db = getDb();
  db.prepare(
    `INSERT INTO sse_events (event, data, timestamp) VALUES (?, ?, ?)`
  ).run(event, JSON.stringify(data), Date.now());
}

export function getEventsSince(since: number): Array<{ event: string; data: unknown; timestamp: number }> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT event, data, timestamp FROM sse_events WHERE timestamp > ? ORDER BY id ASC`
  ).all(since) as Array<{ event: string; data: string; timestamp: number }>;
  return rows.map(r => ({ event: r.event, data: JSON.parse(r.data || '{}'), timestamp: r.timestamp }));
}

// Legacy exports for compatibility
export const appEvents = { emit: emitEvent };
export const issueEvents = appEvents;

// Event types
export type IssueEventType = 'created' | 'updated' | 'deleted' | 'completed';
export type SessionEventType = 'updated' | 'deleted' | 'status_changed';
export type MemoryEventType = 'saved' | 'deleted';
export type PlanEventType = 'created' | 'updated' | 'deleted';
export type ContextEventType = 'created' | 'updated' | 'deleted';

// Helper to emit issue events
export function emitIssueEvent(type: IssueEventType, issueId: string, projectPath?: string) {
  appEvents.emit('issue', { type, issueId, projectPath });
}

// Helper to emit session events
export function emitSessionEvent(type: SessionEventType, sessionId: string) {
  appEvents.emit('session', { type, sessionId });
}

// Helper to emit memory events
export function emitMemoryEvent(type: MemoryEventType, projectPath: string, key: string) {
  appEvents.emit('memory', { type, projectPath, key });
}

// Helper to emit plan events
export function emitPlanEvent(type: PlanEventType, planId: string) {
  appEvents.emit('plan', { type, planId });
}

// Helper to emit context item events
export function emitContextEvent(type: ContextEventType, sessionId: string, key: string) {
  appEvents.emit('context', { type, sessionId, key });
}
