/**
 * Database Manager
 * Simple SQLite operations with WAL mode for better concurrency
 * Learned from Memory Keeper but simplified
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  Session,
  ContextItem,
  Checkpoint,
  FileCache,
  DatabaseError,
  SessionSummary,
  RecentSession,
} from '../types/index.js';

export interface DatabaseConfig {
  filename?: string;
  dataDir?: string;
}

export class DatabaseManager {
  private db: Database.Database;
  private dataDir: string;

  constructor(config: DatabaseConfig = {}) {
    // Default to ~/.savecontext/data
    this.dataDir = config.dataDir || path.join(os.homedir(), '.savecontext', 'data');

    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const dbPath = path.join(this.dataDir, config.filename || 'savecontext.db');

    try {
      this.db = new Database(dbPath);
      this.initialize();
    } catch (error) {
      throw new DatabaseError('Failed to initialize database', {
        path: dbPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private initialize(): void {
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Set busy timeout to handle concurrent access
    this.db.pragma('busy_timeout = 5000'); // 5 seconds

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create tables
    this.createTables();
  }

  private createTables(): void {
    // Read schema from file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Execute schema
    this.db.exec(schema);
  }

  /**
   * Get the underlying database instance
   * Use for custom queries if needed
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Execute a transaction
   * All operations run atomically
   */
  transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ====================
  // Session Operations
  // ====================

  createSession(session: Omit<Session, 'id' | 'created_at' | 'updated_at'>): Session {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, name, description, branch, channel, project_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const id = this.generateId();
    stmt.run(
      id,
      session.name,
      session.description || null,
      session.branch || null,
      session.channel,
      session.project_path || null,
      session.status || 'active',
      now,
      now
    );

    return {
      id,
      ...session,
      status: session.status || 'active',
      created_at: now,
      updated_at: now,
    } as Session;
  }

  getSession(sessionId: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(sessionId) as Session | null;
  }

  listSessions(limit: number = 10, filters?: {
    project_path?: string;
    status?: string;
    include_completed?: boolean;
  }): Session[] {
    let query = 'SELECT * FROM sessions WHERE 1=1';
    const params: any[] = [];

    // Filter by project_path if provided
    if (filters?.project_path) {
      query += ' AND project_path = ?';
      params.push(filters.project_path);
    }

    // Filter by status if provided
    if (filters?.status && filters.status !== 'all') {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    // Exclude completed sessions unless explicitly included
    if (!filters?.include_completed && filters?.status !== 'completed' && filters?.status !== 'all') {
      query += ' AND status != ?';
      params.push('completed');
    }

    query += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Session[];
  }

  updateSessionTimestamp(sessionId: string): void {
    const stmt = this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
    stmt.run(Date.now(), sessionId);
  }

  /**
   * Get the active session for a specific project path
   * Returns null if no active session found
   */
  getActiveSession(projectPath: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE project_path = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    return stmt.get(projectPath) as Session | null;
  }

  /**
   * End (complete) a session
   * Sets status to 'completed' and records ended_at timestamp
   */
  endSession(sessionId: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = 'completed', ended_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, now, sessionId);
  }

  /**
   * Pause a session
   * Sets status to 'paused' and records ended_at timestamp
   * Can be resumed later
   */
  pauseSession(sessionId: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = 'paused', ended_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, now, sessionId);
  }

  /**
   * Resume a paused or active session
   * Sets status to 'active' and clears ended_at
   */
  resumeSession(sessionId: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = 'active', ended_at = NULL, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, sessionId);
  }

  /**
   * Delete a session and all related data
   * Only allows deletion if session is not active
   * CASCADE handles deletion of context_items, checkpoints, etc.
   */
  deleteSession(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    // Prevent deletion of active sessions
    if (session.status === 'active') {
      throw new DatabaseError('Cannot delete active session. Pause or end it first.', {
        sessionId,
        status: session.status,
      });
    }

    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    const result = stmt.run(sessionId);
    return result.changes > 0;
  }

  // ========================
  // Context Item Operations
  // ========================

  saveContextItem(item: Omit<ContextItem, 'id' | 'created_at' | 'updated_at'>): ContextItem {
    const now = Date.now();
    const id = this.generateId();

    // Calculate size
    const size = item.size || (item.key.length + item.value.length);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO context_items
      (id, session_id, key, value, category, priority, channel, size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      item.session_id,
      item.key,
      item.value,
      item.category,
      item.priority,
      item.channel,
      size,
      now,
      now
    );

    return {
      id,
      ...item,
      size,
      created_at: now,
      updated_at: now,
    } as ContextItem;
  }

  getContextItem(sessionId: string, key: string): ContextItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items
      WHERE session_id = ? AND key = ?
    `);
    return stmt.get(sessionId, key) as ContextItem | null;
  }

  getContextItems(
    sessionId: string,
    filters?: {
      category?: string;
      priority?: string;
      channel?: string;
      limit?: number;
      offset?: number;
    }
  ): ContextItem[] {
    let query = 'SELECT * FROM context_items WHERE session_id = ?';
    const params: any[] = [sessionId];

    if (filters?.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters?.priority) {
      query += ' AND priority = ?';
      params.push(filters.priority);
    }

    if (filters?.channel) {
      query += ' AND channel = ?';
      params.push(filters.channel);
    }

    query += ' ORDER BY created_at DESC';

    if (filters?.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);

      if (filters?.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as ContextItem[];
  }

  deleteContextItem(sessionId: string, key: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM context_items
      WHERE session_id = ? AND key = ?
    `);
    const result = stmt.run(sessionId, key);
    return result.changes > 0;
  }

  // ======================
  // Checkpoint Operations
  // ======================

  createCheckpoint(
    checkpoint: Omit<Checkpoint, 'id' | 'created_at' | 'item_count' | 'total_size'>
  ): Checkpoint {
    return this.transaction(() => {
      const now = Date.now();
      const id = this.generateId();

      // Get all context items for this session
      const items = this.getContextItems(checkpoint.session_id);

      // Calculate stats
      const item_count = items.length;
      const total_size = items.reduce((sum, item) => sum + item.size, 0);

      // Create checkpoint
      const stmt = this.db.prepare(`
        INSERT INTO checkpoints
        (id, session_id, name, description, git_status, git_branch, item_count, total_size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        checkpoint.session_id,
        checkpoint.name,
        checkpoint.description || null,
        checkpoint.git_status || null,
        checkpoint.git_branch || null,
        item_count,
        total_size,
        now
      );

      // Link all context items to checkpoint
      const linkStmt = this.db.prepare(`
        INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id)
        VALUES (?, ?, ?)
      `);

      for (const item of items) {
        linkStmt.run(this.generateId(), id, item.id);
      }

      return {
        id,
        ...checkpoint,
        item_count,
        total_size,
        created_at: now,
      } as Checkpoint;
    });
  }

  getCheckpoint(checkpointId: string): Checkpoint | null {
    const stmt = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?');
    return stmt.get(checkpointId) as Checkpoint | null;
  }

  listCheckpoints(sessionId: string): Checkpoint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM checkpoints
      WHERE session_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(sessionId) as Checkpoint[];
  }

  getCheckpointItems(checkpointId: string): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT ci.*
      FROM context_items ci
      JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
      WHERE cpi.checkpoint_id = ?
      ORDER BY ci.created_at ASC
    `);
    return stmt.all(checkpointId) as ContextItem[];
  }

  restoreCheckpoint(checkpointId: string, targetSessionId: string): number {
    return this.transaction(() => {
      // Get checkpoint items
      const items = this.getCheckpointItems(checkpointId);

      // Clear current context items in target session
      const clearStmt = this.db.prepare('DELETE FROM context_items WHERE session_id = ?');
      clearStmt.run(targetSessionId);

      // Restore items
      let restored = 0;
      for (const item of items) {
        this.saveContextItem({
          session_id: targetSessionId,
          key: item.key,
          value: item.value,
          category: item.category,
          priority: item.priority,
          channel: item.channel,
          size: item.size,
        });
        restored++;
      }

      return restored;
    });
  }

  // =====================
  // File Cache Operations
  // =====================

  cacheFile(fileCache: Omit<FileCache, 'id' | 'last_read' | 'updated_at'>): FileCache {
    const now = Date.now();
    const id = this.generateId();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO file_cache
      (id, session_id, file_path, content, hash, size, last_read, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      fileCache.session_id,
      fileCache.file_path,
      fileCache.content || null,
      fileCache.hash || null,
      fileCache.size,
      now,
      now
    );

    return {
      id,
      ...fileCache,
      last_read: now,
      updated_at: now,
    } as FileCache;
  }

  getFileCache(sessionId: string, filePath: string): FileCache | null {
    const stmt = this.db.prepare(`
      SELECT * FROM file_cache
      WHERE session_id = ? AND file_path = ?
    `);
    return stmt.get(sessionId, filePath) as FileCache | null;
  }

  // ====================
  // Stats & Utilities
  // ====================

  getSessionStats(sessionId: string): SessionSummary | undefined {
    const stmt = this.db.prepare('SELECT * FROM session_summary WHERE id = ?');
    return stmt.get(sessionId) as SessionSummary | undefined;
  }

  getRecentSessions(limit: number = 5): RecentSession[] {
    const stmt = this.db.prepare('SELECT * FROM recent_sessions LIMIT ?');
    return stmt.all(limit) as RecentSession[];
  }

  /**
   * Generate a unique ID
   * Using timestamp + random for simplicity (@DEV -- may switch to UUID if needed)
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
