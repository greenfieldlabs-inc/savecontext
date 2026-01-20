/**
 * Database Manager
 * Simple SQLite operations with WAL mode for better concurrency
 * Learned from Memory Keeper but simplified
 */

import { Database } from 'bun:sqlite';
import * as sqliteVec from 'sqlite-vec';
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
  Issue,
  IssueStatus,
  IssueType,
  DependencyType,
  CreateIssueArgs,
  UpdateIssueArgs,
  ListIssuesArgs,
  AddDependencyResult,
  RemoveDependencyResult,
  AddLabelsResult,
  RemoveLabelsResult,
  ClaimIssuesResult,
  ReleaseIssuesResult,
  GetNextBlockResult,
  CreateBatchResult,
  CreateBatchArgs,
  Plan,
  PlanStatus,
  CreatePlanArgs,
  UpdatePlanArgs,
  ListPlansArgs,
  SqliteBindValue,
  Project,
  DatabaseConfig,
} from '../types/index.js';

/**
 * Safely parse tags JSON string, returning empty array on error
 */
function safeParseTagsJson(tagsJson: string | null | undefined): string[] {
  try {
    return JSON.parse(tagsJson || '[]');
  } catch {
    return [];
  }
}

// Configure custom SQLite library for macOS to enable extension loading
if (process.platform === 'darwin') {
  const sqlitePaths = [
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', // Apple Silicon Homebrew
    '/usr/local/opt/sqlite3/lib/libsqlite3.dylib',   // Intel Homebrew
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',    // Alternative Intel path
  ];

  for (const sqlitePath of sqlitePaths) {
    if (fs.existsSync(sqlitePath)) {
      Database.setCustomSQLite(sqlitePath);
      break;
    }
  }
}

export class DatabaseManager {
  private db: Database;
  private dataDir: string;

  constructor(config: DatabaseConfig = {}) {
    let dbPath: string;

    if (config.dbPath) {
      // Direct path override (used for testing)
      dbPath = config.dbPath;
      this.dataDir = path.dirname(dbPath);
    } else {
      // Default to ~/.savecontext/data
      this.dataDir = config.dataDir || path.join(os.homedir(), '.savecontext', 'data');
      dbPath = path.join(this.dataDir, config.filename || 'savecontext.db');
    }

    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

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
    // Load sqlite-vec extension for vector search
    sqliteVec.load(this.db);

    // Enable WAL mode for better concurrency
    this.db.exec('PRAGMA journal_mode = WAL');

    // Set busy timeout to handle concurrent access
    this.db.exec('PRAGMA busy_timeout = 5000'); // 5 seconds

    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON');

    // Create tables
    this.createTables();

    // Cleanup stale agent sessions (older than 24 hours)
    this.cleanupStaleAgentSessions();
  }

  /**
   * Delete agent sessions that haven't been active in 24 hours
   * Runs on startup to keep the database clean
   */
  private cleanupStaleAgentSessions(): void {
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      'DELETE FROM agent_sessions WHERE last_active_at < ?'
    ).run(twentyFourHoursAgo);

    if (result.changes > 0) {
      console.error(`[SaveContext] Cleaned up ${result.changes} stale agent sessions`);
    }
  }

  /**
   * Emit SSE event to the dashboard
   * Events are stored in sse_events table and polled by the dashboard
   */
  private emitSSEEvent(event: string, data: Record<string, unknown>): void {
    try {
      // Ensure sse_events table exists
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sse_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event TEXT NOT NULL,
          data TEXT,
          timestamp INTEGER NOT NULL
        )
      `);

      // Clean old events (keep last 5 minutes)
      this.db.prepare('DELETE FROM sse_events WHERE timestamp < ?').run(Date.now() - 300000);

      // Insert new event
      this.db.prepare(
        'INSERT INTO sse_events (event, data, timestamp) VALUES (?, ?, ?)'
      ).run(event, JSON.stringify(data), Date.now());
    } catch {
      // Silently fail - SSE is non-critical
    }
  }

  private createTables(): void {
    // Check if this is an existing database with migrations already applied
    let isExistingDb = false;
    try {
      const count = this.db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number };
      isExistingDb = count.c > 0;
    } catch {
      // Table doesn't exist - fresh database
    }

    if (!isExistingDb) {
      // Fresh database: run full schema
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      this.db.exec(schema);
    }

    // Run pending migrations
    this.runMigrations();
  }

  private runMigrations(): void {
    const migrationsDir = path.join(__dirname, 'migrations');

    if (!fs.existsSync(migrationsDir)) {
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      return;
    }

    // Get already applied migrations
    const applied = new Set<string>();
    try {
      const rows = this.db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[];
      rows.forEach(row => applied.add(row.version));
    } catch {
      // Table doesn't exist yet
    }

    // For NEW databases (no migrations recorded), schema.sql already has everything
    // Mark all migrations as applied to avoid running ALTER statements on fresh tables
    if (applied.size === 0) {
      const now = Date.now();
      const insertStmt = this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
      for (const file of files) {
        const version = file.replace('.sql', '');
        insertStmt.run(version, now);
      }
      return;
    }

    // For EXISTING databases, apply pending migrations
    for (const file of files) {
      const version = file.replace('.sql', '');

      if (applied.has(version)) {
        continue;
      }

      const migrationPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(migrationPath, 'utf-8');

      try {
        this.db.exec(sql);
        this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
      } catch (err) {
        console.error(`[SaveContext] Migration ${version} failed:`, err);
        throw err;  // Note: Propagate failure - don't continue with broken schema
      }
    }
  }

  /**
   * Get the underlying database instance
   * Use for custom queries if needed
   */
  getDatabase(): Database {
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
    const id = this.generateId();

    // Use transaction to ensure both inserts succeed or both fail
    return this.transaction(() => {
      // Insert into sessions table
      const stmt = this.db.prepare(`
        INSERT INTO sessions (id, name, description, branch, channel, project_path, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
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

      // Insert into session_projects if project_path provided
      if (session.project_path) {
        const pathStmt = this.db.prepare(`
          INSERT INTO session_projects (session_id, project_path, added_at)
          VALUES (?, ?, ?)
        `);
        pathStmt.run(id, session.project_path, now);
      }

      const created = {
        id,
        ...session,
        status: session.status || 'active',
        created_at: now,
        updated_at: now,
      } as Session;

      this.emitSSEEvent('session', { type: 'created', sessionId: id, projectPath: session.project_path });

      return created;
    });
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
    const params: SqliteBindValue[] = [];

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
   * Rename a session
   * Returns true if successful, false if session not found
   */
  renameSession(sessionId: string, newName: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    const stmt = this.db.prepare(`
      UPDATE sessions
      SET name = ?, updated_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(newName, Date.now(), sessionId);

    if (result.changes > 0) {
      this.emitSSEEvent('session', { type: 'updated', sessionId, projectPath: session.project_path });
    }

    return result.changes > 0;
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
    const session = this.getSession(sessionId);
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = 'completed', ended_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, now, sessionId);

    this.emitSSEEvent('session', { type: 'status_changed', sessionId, projectPath: session?.project_path });
  }

  /**
   * Pause a session
   * Sets status to 'paused' and records ended_at timestamp
   * Can be resumed later
   */
  pauseSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = 'paused', ended_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, now, sessionId);

    this.emitSSEEvent('session', { type: 'status_changed', sessionId, projectPath: session?.project_path });
  }

  /**
   * Resume a paused or active session
   * Sets status to 'active' and clears ended_at
   */
  resumeSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = 'active', ended_at = NULL, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, sessionId);

    this.emitSSEEvent('session', { type: 'status_changed', sessionId, projectPath: session?.project_path });
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

    if (result.changes > 0) {
      this.emitSSEEvent('session', { type: 'deleted', sessionId, projectPath: session.project_path });
    }

    return result.changes > 0;
  }

  // ===============================
  // Multi-Path Session Operations
  // ===============================

  /**
   * Get all project paths for a session
   */
  getSessionPaths(sessionId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT project_path FROM session_projects
      WHERE session_id = ?
      ORDER BY added_at ASC
    `);
    const rows = stmt.all(sessionId) as Array<{ project_path: string }>;
    return rows.map((row) => row.project_path);
  }

  /**
   * Add a project path to a session
   * Returns false if path already exists for session
   */
  addProjectPath(sessionId: string, projectPath: string): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO session_projects (session_id, project_path, added_at)
        VALUES (?, ?, ?)
      `);
      const result = stmt.run(sessionId, projectPath, Date.now());
      return result.changes > 0;
    } catch (error) {
      // If unique constraint fails, path already exists
      return false;
    }
  }

  /**
   * Remove a project path from a session
   * Returns false if path doesn't exist or is the last path (can't remove last path)
   */
  removeProjectPath(sessionId: string, projectPath: string): boolean {
    // Check if this is the last path
    const paths = this.getSessionPaths(sessionId);
    if (paths.length <= 1) {
      throw new DatabaseError('Cannot remove the last project path from a session', {
        sessionId,
        projectPath,
      });
    }

    const stmt = this.db.prepare(`
      DELETE FROM session_projects
      WHERE session_id = ? AND project_path = ?
    `);
    const result = stmt.run(sessionId, projectPath);
    return result.changes > 0;
  }

  /**
   * Get active session for any of the provided project paths
   * Returns the most recently updated session that matches any path
   */
  getActiveSessionForPaths(projectPaths: string[]): Session | null {
    if (projectPaths.length === 0) {
      return null;
    }

    const placeholders = projectPaths.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT s.* FROM sessions s
      JOIN session_projects sp ON s.id = sp.session_id
      WHERE sp.project_path IN (${placeholders})
        AND s.status = 'active'
      ORDER BY s.updated_at DESC
      LIMIT 1
    `);
    return stmt.get(...projectPaths) as Session | null;
  }

  /**
   * List sessions that match any of the provided project paths
   */
  listSessionsByPaths(
    projectPaths: string[],
    limit: number = 10,
    filters?: {
      status?: string;
      include_completed?: boolean;
      search?: string;
      all_projects?: boolean;
    }
  ): Session[] {
    // If no project paths AND no search AND not explicitly requesting all, return empty
    if (projectPaths.length === 0 && !filters?.search && !filters?.all_projects) {
      return [];
    }

    let query: string;
    const params: SqliteBindValue[] = [];

    if (projectPaths.length > 0) {
      const placeholders = projectPaths.map(() => '?').join(',');
      query = `
        SELECT DISTINCT s.* FROM sessions s
        JOIN session_projects sp ON s.id = sp.session_id
        WHERE sp.project_path IN (${placeholders})
      `;
      params.push(...projectPaths);
    } else {
      // Search all sessions when no project path specified
      query = 'SELECT * FROM sessions s WHERE 1=1';
    }

    // Text search on name and description (case-insensitive)
    if (filters?.search && filters.search.trim()) {
      const searchTerm = `%${filters.search.trim()}%`;
      query += ' AND (s.name LIKE ? COLLATE NOCASE OR s.description LIKE ? COLLATE NOCASE)';
      params.push(searchTerm, searchTerm);
    }

    // Filter by status if provided
    if (filters?.status && filters.status !== 'all') {
      query += ' AND s.status = ?';
      params.push(filters.status);
    }

    // Exclude completed sessions unless explicitly included
    if (!filters?.include_completed && filters?.status !== 'completed' && filters?.status !== 'all') {
      query += ' AND s.status != ?';
      params.push('completed');
    }

    query += ' ORDER BY s.updated_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Session[];
  }

  // ==============================================
  // Agent Session Tracking (Multi-Agent Support)
  // ==============================================

  /**
   * Set or update the current session for an agent
   * Creates new entry or updates existing one
   */
  setCurrentSessionForAgent(
    agentId: string,
    sessionId: string,
    projectPath: string,
    gitBranch: string,
    provider: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_sessions (agent_id, session_id, project_path, git_branch, provider, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        session_id = excluded.session_id,
        project_path = excluded.project_path,
        git_branch = excluded.git_branch,
        provider = excluded.provider,
        last_active_at = excluded.last_active_at
    `);
    stmt.run(agentId, sessionId, projectPath, gitBranch, provider, Date.now());
  }

  /**
   * Get the current session for an agent
   * Returns null if agent has no current session
   */
  getCurrentSessionForAgent(agentId: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT s.* FROM sessions s
      JOIN agent_sessions ag ON s.id = ag.session_id
      WHERE ag.agent_id = ?
    `);
    return stmt.get(agentId) as Session | null;
  }

  /**
   * Clear the current session for an agent
   * Removes the agent_sessions entry
   */
  clearCurrentSessionForAgent(agentId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM agent_sessions
      WHERE agent_id = ?
    `);
    stmt.run(agentId);
  }

  /**
   * Get all agents currently working on a session
   * Returns array of agent info
   */
  getAgentsForSession(sessionId: string): Array<{
    agent_id: string;
    provider: string;
    git_branch: string;
    last_active_at: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT agent_id, provider, git_branch, last_active_at
      FROM agent_sessions
      WHERE session_id = ?
      ORDER BY last_active_at DESC
    `);
    return stmt.all(sessionId) as Array<{
      agent_id: string;
      provider: string;
      git_branch: string;
      last_active_at: number;
    }>;
  }

  // ========================
  // Context Item Operations
  // ========================

  saveContextItem(item: Omit<ContextItem, 'id' | 'created_at' | 'updated_at'>): ContextItem {
    const now = Date.now();
    const id = this.generateId();

    // Calculate size
    const size = item.size || (item.key.length + item.value.length);

    // Ensure tags is a valid JSON array
    const tags = item.tags || '[]';

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO context_items
      (id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      item.session_id,
      item.key,
      item.value,
      item.category,
      item.priority,
      item.channel,
      tags,
      size,
      now,
      now
    );

    this.emitSSEEvent('context', { type: 'created', sessionId: item.session_id, key: item.key });

    return {
      id,
      ...item,
      tags,
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
    const params: SqliteBindValue[] = [sessionId];

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
    if (result.changes > 0) {
      this.emitSSEEvent('context', { type: 'deleted', sessionId, key });
    }
    return result.changes > 0;
  }

  updateContextItem(
    sessionId: string,
    key: string,
    updates: {
      value?: string;
      category?: string;
      priority?: string;
      channel?: string;
      tags?: string;
    }
  ): ContextItem | null {
    // First get the existing item
    const existing = this.getContextItem(sessionId, key);
    if (!existing) {
      return null;
    }

    // Build update query dynamically
    const fields: string[] = [];
    const params: SqliteBindValue[] = [];

    if (updates.value !== undefined) {
      fields.push('value = ?');
      params.push(updates.value);
      // Recalculate size if value changed
      fields.push('size = ?');
      params.push(key.length + updates.value.length);
    }

    if (updates.category !== undefined) {
      fields.push('category = ?');
      params.push(updates.category);
    }

    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      params.push(updates.priority);
    }

    if (updates.channel !== undefined) {
      fields.push('channel = ?');
      params.push(updates.channel);
    }

    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      params.push(updates.tags);
    }

    // Always update updated_at
    fields.push('updated_at = ?');
    params.push(Date.now());

    // Add WHERE clause params
    params.push(sessionId, key);

    const stmt = this.db.prepare(`
      UPDATE context_items
      SET ${fields.join(', ')}
      WHERE session_id = ? AND key = ?
    `);

    stmt.run(...params);

    this.emitSSEEvent('context', { type: 'updated', sessionId, key });

    // Return updated item
    return this.getContextItem(sessionId, key);
  }

  /**
   * Tag context items by keys or pattern
   * Supports wildcard patterns like "feature_*"
   */
  tagContextItems(
    sessionId: string,
    options: {
      keys?: string[];
      key_pattern?: string;
      tags: string[];
      action: 'add' | 'remove';
    }
  ): number {
    let items: ContextItem[] = [];

    if (options.keys && options.keys.length > 0) {
      // Batch fetch by keys using IN clause (fixes N+1 query)
      const placeholders = options.keys.map(() => '?').join(',');
      const stmt = this.db.prepare(`
        SELECT * FROM context_items
        WHERE session_id = ? AND key IN (${placeholders})
      `);
      items = stmt.all(sessionId, ...options.keys) as ContextItem[];
    } else if (options.key_pattern) {
      // Tag by pattern (e.g., "feature_*")
      const pattern = options.key_pattern.replace(/\*/g, '%');
      const stmt = this.db.prepare(`
        SELECT * FROM context_items
        WHERE session_id = ? AND key LIKE ?
      `);
      items = stmt.all(sessionId, pattern) as ContextItem[];
    }

    // Update tags for each item (wrapped in transaction for atomicity)
    const updateStmt = this.db.prepare(`
      UPDATE context_items
      SET tags = ?, updated_at = ?
      WHERE session_id = ? AND key = ?
    `);

    let updated = 0;
    const updateTx = this.db.transaction(() => {
      for (const item of items) {
        const currentTags: string[] = safeParseTagsJson(item.tags);
        let newTags: string[];

        if (options.action === 'add') {
          // Add tags (no duplicates)
          newTags = [...new Set([...currentTags, ...options.tags])];
        } else {
          // Remove tags
          newTags = currentTags.filter(tag => !options.tags.includes(tag));
        }

        updateStmt.run(JSON.stringify(newTags), Date.now(), sessionId, item.key);
        updated++;
      }
    });
    updateTx();

    return updated;
  }

  // ==========================
  // Project Memory Operations
  // ==========================

  saveMemory(projectPath: string, key: string, value: string, category: string = 'command'): { id: string; key: string } {
    const now = Date.now();
    const id = this.generateId();

    const stmt = this.db.prepare(`
      INSERT INTO project_memory (id, project_path, key, value, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_path, key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        updated_at = excluded.updated_at
    `);

    stmt.run(id, projectPath, key, value, category, now, now);

    this.emitSSEEvent('memory', { type: 'saved', key, projectPath });

    return { id, key };
  }

  getMemory(projectPath: string, key: string): { key: string; value: string; category: string } | null {
    const stmt = this.db.prepare(`
      SELECT key, value, category FROM project_memory
      WHERE project_path = ? AND key = ?
    `);
    return stmt.get(projectPath, key) as { key: string; value: string; category: string } | null;
  }

  listMemory(projectPath: string, category?: string): Array<{ key: string; value: string; category: string; created_at: number }> {
    let query = `
      SELECT key, value, category, created_at FROM project_memory
      WHERE project_path = ?
    `;
    const params: SqliteBindValue[] = [projectPath];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Array<{ key: string; value: string; category: string; created_at: number }>;
  }

  deleteMemory(projectPath: string, key: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM project_memory WHERE project_path = ? AND key = ?
    `);
    const result = stmt.run(projectPath, key);

    if (result.changes > 0) {
      this.emitSSEEvent('memory', { type: 'deleted', key, projectPath });
    }

    return result.changes > 0;
  }

  // ================
  // Task Operations
  // ================

  /**
   * Generate a 4-character hash for root task IDs
   */
  private generateHash(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let hash = '';
    for (let i = 0; i < 4; i++) {
      hash += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return hash;
  }

  /**
   * Get or create a project record for a project path
   */
  getOrCreateProject(projectPath: string): Project {
    const existing = this.db.prepare(`
      SELECT * FROM projects WHERE project_path = ?
    `).get(projectPath) as Project | undefined;

    if (existing) {
      return existing;
    }

    const now = Date.now();
    const id = this.generateId();
    const pathParts = projectPath.split('/').filter(Boolean);
    const projectName = pathParts[pathParts.length - 1] || 'project';
    const prefix = projectName.toUpperCase().slice(0, 4).replace(/[^A-Z0-9]/g, '') || 'PROJ';

    this.db.prepare(`
      INSERT INTO projects (id, project_path, name, issue_prefix, plan_prefix, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectPath, projectName, prefix, prefix, now, now);

    return {
      id,
      project_path: projectPath,
      name: projectName,
      description: null,
      issue_prefix: prefix,
      next_issue_number: 1,
      plan_prefix: prefix,
      next_plan_number: 1,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Get project by path
   */
  getProject(projectPath: string): Project | null {
    return this.db.prepare(`
      SELECT * FROM projects WHERE project_path = ?
    `).get(projectPath) as Project | null;
  }

  /**
   * Get project by ID
   */
  getProjectById(projectId: string): Project | null {
    return this.db.prepare(`
      SELECT * FROM projects WHERE id = ?
    `).get(projectId) as Project | null;
  }

  /**
   * List all projects with optional session counts
   */
  listProjects(options?: { limit?: number; includeSessionCount?: boolean }): { projects: (Project & { session_count?: number })[]; count: number } {
    const limit = options?.limit || 50;

    let projects: (Project & { session_count?: number })[];

    if (options?.includeSessionCount) {
      projects = this.db.prepare(`
        SELECT p.*, COUNT(DISTINCT sp.session_id) as session_count
        FROM projects p
        LEFT JOIN session_projects sp ON p.project_path = sp.project_path
        GROUP BY p.id
        ORDER BY p.updated_at DESC
        LIMIT ?
      `).all(limit) as (Project & { session_count: number })[];
    } else {
      projects = this.db.prepare(`
        SELECT * FROM projects
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(limit) as Project[];
    }

    const countResult = this.db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };

    return { projects, count: countResult.count };
  }

  /**
   * Rename a project
   */
  renameProject(projectId: string, newName: string, description?: string): boolean {
    const project = this.getProjectById(projectId);
    if (!project) {
      return false;
    }

    const now = Date.now();
    if (description !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE projects
        SET name = ?, description = ?, updated_at = ?
        WHERE id = ?
      `);
      const result = stmt.run(newName, description, now, projectId);
      return result.changes > 0;
    } else {
      const stmt = this.db.prepare(`
        UPDATE projects
        SET name = ?, updated_at = ?
        WHERE id = ?
      `);
      const result = stmt.run(newName, now, projectId);
      return result.changes > 0;
    }
  }

  /**
   * Delete a project
   * Returns number of sessions unlinked (sessions themselves are not deleted)
   */
  deleteProject(projectId: string, force?: boolean): { success: boolean; sessionsUnlinked: number } {
    const project = this.getProjectById(projectId);
    if (!project) {
      return { success: false, sessionsUnlinked: 0 };
    }

    // Count sessions linked to this project
    const sessionCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM session_projects WHERE project_path = ?
    `).get(project.project_path) as { count: number };

    if (sessionCount.count > 0 && !force) {
      return { success: false, sessionsUnlinked: 0 };
    }

    // Unlink sessions from this project
    this.db.prepare(`
      DELETE FROM session_projects WHERE project_path = ?
    `).run(project.project_path);

    // Also update sessions that have this project as primary project_path
    this.db.prepare(`
      UPDATE sessions SET project_path = NULL WHERE project_path = ?
    `).run(project.project_path);

    // Delete the project
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);

    return { success: true, sessionsUnlinked: sessionCount.count };
  }

  /**
   * Merge one project into another (moves all sessions from source to target)
   */
  mergeProjects(sourceProjectId: string, targetProjectId: string, deleteSource?: boolean): { success: boolean; sessionsMoved: number; sourceDeleted: boolean } {
    const source = this.getProjectById(sourceProjectId);
    const target = this.getProjectById(targetProjectId);

    if (!source || !target) {
      return { success: false, sessionsMoved: 0, sourceDeleted: false };
    }

    // Count sessions to move
    const sessionCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM session_projects WHERE project_path = ?
    `).get(source.project_path) as { count: number };

    // Move session_projects from source to target
    this.db.prepare(`
      UPDATE session_projects SET project_path = ? WHERE project_path = ?
    `).run(target.project_path, source.project_path);

    // Update sessions that have source as primary project_path
    this.db.prepare(`
      UPDATE sessions SET project_path = ? WHERE project_path = ?
    `).run(target.project_path, source.project_path);

    // Move issues from source to target
    this.db.prepare(`
      UPDATE issues SET project_path = ? WHERE project_path = ?
    `).run(target.project_path, source.project_path);

    // Move memory items from source to target
    this.db.prepare(`
      UPDATE project_memory SET project_path = ? WHERE project_path = ?
    `).run(target.project_path, source.project_path);

    // Move plans from source to target
    this.db.prepare(`
      UPDATE plans SET project_path = ?, project_id = ? WHERE project_path = ?
    `).run(target.project_path, target.id, source.project_path);

    let sourceDeleted = false;
    if (deleteSource !== false) {
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(sourceProjectId);
      sourceDeleted = true;
    }

    return { success: true, sessionsMoved: sessionCount.count, sourceDeleted };
  }

  /**
   * Create a new project explicitly (does not auto-create)
   * Returns null if project already exists
   */
  createProject(args: {
    project_path: string;
    name?: string;
    description?: string;
    issue_prefix?: string;
  }): Project | null {
    // Check if project already exists
    const existing = this.getProject(args.project_path);
    if (existing) {
      return null;
    }

    const now = Date.now();
    const id = this.generateId();
    const pathParts = args.project_path.split('/').filter(Boolean);
    const defaultName = pathParts[pathParts.length - 1] || 'project';
    const name = args.name || defaultName;
    const prefix = args.issue_prefix || name.toUpperCase().slice(0, 4).replace(/[^A-Z0-9]/g, '') || 'PROJ';

    this.db.prepare(`
      INSERT INTO projects (id, project_path, name, description, issue_prefix, plan_prefix, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, args.project_path, name, args.description || null, prefix, prefix, now, now);

    return {
      id,
      project_path: args.project_path,
      name,
      description: args.description || null,
      issue_prefix: prefix,
      next_issue_number: 1,
      plan_prefix: prefix,
      next_plan_number: 1,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Update a project by path
   */
  updateProject(projectPath: string, updates: {
    name?: string;
    description?: string;
    issue_prefix?: string;
  }): Project | null {
    const project = this.getProject(projectPath);
    if (!project) {
      return null;
    }

    const now = Date.now();
    const newName = updates.name ?? project.name;
    const newDescription = updates.description !== undefined ? updates.description : project.description;
    const newPrefix = updates.issue_prefix ?? project.issue_prefix;

    this.db.prepare(`
      UPDATE projects
      SET name = ?, description = ?, issue_prefix = ?, updated_at = ?
      WHERE project_path = ?
    `).run(newName, newDescription, newPrefix, now, projectPath);

    return {
      ...project,
      name: newName,
      description: newDescription,
      issue_prefix: newPrefix,
      updated_at: now,
    };
  }

  /**
   * Update project prefix and optionally cascade to all issues
   * When cascade=true, updates all issue short_ids: OLD-xxxx → NEW-xxxx
   */
  updateProjectPrefix(projectPath: string, newPrefix: string, cascade: boolean = false): {
    success: boolean;
    project?: Project;
    issuesUpdated?: number;
    oldPrefix?: string;
    error?: string;
  } {
    const project = this.getProject(projectPath);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    const oldPrefix = project.issue_prefix || 'ISSUE';
    const now = Date.now();

    // Update project prefix
    this.db.prepare(`
      UPDATE projects SET issue_prefix = ?, updated_at = ? WHERE project_path = ?
    `).run(newPrefix, now, projectPath);

    let issuesUpdated = 0;

    if (cascade && oldPrefix !== newPrefix) {
      // Get all issues for this project that start with oldPrefix
      const issues = this.db.prepare(`
        SELECT id, short_id FROM issues
        WHERE project_path = ? AND short_id LIKE ?
      `).all(projectPath, `${oldPrefix}-%`) as Array<{ id: string; short_id: string }>;

      // Update each issue's short_id
      const updateStmt = this.db.prepare(`
        UPDATE issues SET short_id = ?, updated_at = ? WHERE id = ?
      `);

      for (const issue of issues) {
        // Replace prefix: OLD-xxxx → NEW-xxxx (preserves hierarchy like OLD-xxxx.1)
        const newShortId = issue.short_id.replace(new RegExp(`^${oldPrefix}-`), `${newPrefix}-`);
        updateStmt.run(newShortId, now, issue.id);
        issuesUpdated++;
      }
    }

    const updatedProject = this.getProject(projectPath);

    return {
      success: true,
      project: updatedProject || undefined,
      issuesUpdated,
      oldPrefix,
    };
  }

  /**
   * Delete a project by path
   * Cascades to issues, plans, and memory items
   */
  deleteProjectByPath(projectPath: string, confirm: boolean): { success: boolean; error?: string; deleted?: { issues: number; plans: number; memory: number; sessionsUnlinked: number } } {
    if (!confirm) {
      return { success: false, error: 'Deletion must be confirmed' };
    }

    const project = this.getProject(projectPath);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    // Count items to be deleted
    const issueCount = (this.db.prepare('SELECT COUNT(*) as count FROM issues WHERE project_path = ?').get(projectPath) as { count: number }).count;
    const planCount = (this.db.prepare('SELECT COUNT(*) as count FROM plans WHERE project_path = ?').get(projectPath) as { count: number }).count;
    const memoryCount = (this.db.prepare('SELECT COUNT(*) as count FROM project_memory WHERE project_path = ?').get(projectPath) as { count: number }).count;
    const sessionCount = (this.db.prepare('SELECT COUNT(*) as count FROM session_projects WHERE project_path = ?').get(projectPath) as { count: number }).count;

    // Delete issues (cascade will handle labels and dependencies)
    this.db.prepare('DELETE FROM issues WHERE project_path = ?').run(projectPath);

    // Delete plans
    this.db.prepare('DELETE FROM plans WHERE project_path = ?').run(projectPath);

    // Delete memory items
    this.db.prepare('DELETE FROM project_memory WHERE project_path = ?').run(projectPath);

    // Unlink sessions
    this.db.prepare('DELETE FROM session_projects WHERE project_path = ?').run(projectPath);
    this.db.prepare('UPDATE sessions SET project_path = NULL WHERE project_path = ?').run(projectPath);

    // Delete the project
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);

    return {
      success: true,
      deleted: {
        issues: issueCount,
        plans: planCount,
        memory: memoryCount,
        sessionsUnlinked: sessionCount,
      },
    };
  }

  /**
   * Get issue prefix for a project (creates project if needed)
   */
  private getProjectPrefix(projectPath: string): string {
    const project = this.getOrCreateProject(projectPath);
    return project.issue_prefix || 'ISSUE';
  }

  /**
   * Generate a hierarchical short ID for an issue
   * - Root issues: PREFIX-hash (e.g., SC-a1b2)
   * - Child issues: parent.N (e.g., SC-a1b2.1, SC-a1b2.1.1)
   */
  private generateShortId(projectPath: string, parentId?: string, parentShortIdFromBatch?: string): string {
    if (!parentId) {
      // Root issue: PREFIX-hash
      const prefix = this.getProjectPrefix(projectPath);
      const hash = this.generateHash();
      return `${prefix}-${hash}`;
    }

    // Use in-batch parent shortId if provided (for $N references in batch creation)
    let parentShortId = parentShortIdFromBatch;

    if (!parentShortId) {
      // Look up parent from database (supports both UUID and shortId)
      const parent = this.db.prepare(`
        SELECT id, short_id FROM issues WHERE id = ? OR short_id = ?
      `).get(parentId, parentId) as { id: string; short_id: string } | undefined;
      if (parent) {
        parentShortId = parent.short_id;
        parentId = parent.id; // Use UUID for dependency query below
      }
    }

    if (!parentShortId) {
      // Parent doesn't have a shortId (legacy issue), generate root-style ID
      const prefix = this.getProjectPrefix(projectPath);
      const hash = this.generateHash();
      return `${prefix}-${hash}`;
    }

    // Count existing direct children of this parent via dependencies table (uses UUID)
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM issue_dependencies
      WHERE depends_on_id = ? AND dependency_type = 'parent-child'
    `).get(parentId) as { count: number };

    return `${parentShortId}.${result.count + 1}`;
  }

  createIssue(projectPath: string, args: CreateIssueArgs, agentId?: string, sessionId?: string): Issue {
    const now = Date.now();
    const id = this.generateId();
    const shortId = this.generateShortId(projectPath, args.parentId);

    const stmt = this.db.prepare(`
      INSERT INTO issues (
        id, short_id, project_path, plan_id, title, description, details, status,
        priority, issue_type, created_by_agent, created_in_session,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const status = args.status || 'open';
    const priority = args.priority ?? 2;
    const issueType = args.issueType || 'task';

    // Resolve planId to full UUID (may be short_id like "PLAN-xxxx")
    let resolvedPlanId: string | null = null;
    if (args.planId) {
      const plan = this.getPlan(args.planId);
      if (!plan) {
        throw new Error(`Plan not found: ${args.planId}`);
      }
      resolvedPlanId = plan.id;
    }

    stmt.run(
      id, shortId, projectPath, resolvedPlanId, args.title, args.description || null, args.details || null,
      status, priority, issueType,
      agentId || null, sessionId || null, now, now
    );

    // Create parent-child dependency via issue_dependencies table
    if (args.parentId) {
      // Resolve parentId to UUID (it might be a shortId)
      const parent = this.getIssue(args.parentId);
      if (parent) {
        this.db.prepare(`
          INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
          VALUES (?, ?, ?, 'parent-child', ?)
        `).run(this.generateId(), id, parent.id, now);
      }
    }

    // Create labels if provided
    if (args.labels && args.labels.length > 0) {
      const labelStmt = this.db.prepare(`
        INSERT OR IGNORE INTO issue_labels (id, issue_id, label) VALUES (?, ?, ?)
      `);
      for (const label of args.labels) {
        labelStmt.run(this.generateId(), id, label.trim().toLowerCase());
      }
    }

    // Emit SSE event for dashboard
    this.emitSSEEvent('issue', { type: 'created', issueId: id, projectPath });

    return {
      id,
      shortId,
      projectPath,
      planId: resolvedPlanId || undefined,
      title: args.title,
      description: args.description,
      details: args.details,
      status: status as IssueStatus,
      priority,
      issueType: issueType as IssueType,
      parentId: args.parentId,
      createdByAgent: agentId,
      createdInSession: sessionId,
      createdAt: now,
      updatedAt: now,
      labels: args.labels,
    };
  }

  updateIssue(issueId: string, updates: UpdateIssueArgs): Issue | null {
    const issue = this.getIssue(issueId);
    if (!issue) return null;

    const fields: string[] = [];
    const params: SqliteBindValue[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push(updates.description);
    }
    if (updates.details !== undefined) {
      fields.push('details = ?');
      params.push(updates.details);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);
      if (updates.status === 'closed') {
        fields.push('closed_at = ?');
        params.push(Date.now());
      } else if (updates.status === 'deferred') {
        fields.push('deferred_at = ?');
        params.push(Date.now());
      }
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      params.push(updates.priority);
    }
    if (updates.issueType !== undefined) {
      fields.push('issue_type = ?');
      params.push(updates.issueType);
    }
    if (updates.planId !== undefined) {
      fields.push('plan_id = ?');
      if (updates.planId) {
        // Resolve planId to full UUID (may be short_id like "PLAN-xxxx")
        const plan = this.getPlan(updates.planId);
        if (!plan) {
          throw new Error(`Plan not found: ${updates.planId}`);
        }
        params.push(plan.id);
      } else {
        params.push(null); // Allow unsetting planId
      }
    }
    if (updates.projectPath !== undefined) {
      fields.push('project_path = ?');
      params.push(updates.projectPath);

      // Cascade project_path to all subtasks
      const subtasks = this.db.prepare(`
        SELECT issue_id FROM issue_dependencies
        WHERE depends_on_id = ? AND dependency_type = 'parent-child'
      `).all(issueId) as Array<{ issue_id: string }>;

      if (subtasks.length > 0) {
        const cascadeStmt = this.db.prepare(`UPDATE issues SET project_path = ?, updated_at = ? WHERE id = ?`);
        const now = Date.now();
        for (const sub of subtasks) {
          cascadeStmt.run(updates.projectPath, now, sub.issue_id);
        }
      }
    }
    if (fields.length === 0 && updates.parentId === undefined) return issue;

    // Handle parentId change via dependencies table
    if (updates.parentId !== undefined) {
      const now = Date.now();

      // Remove existing parent-child dependency
      this.db.prepare(`
        DELETE FROM issue_dependencies
        WHERE issue_id = ? AND dependency_type = 'parent-child'
      `).run(issueId);

      // Add new parent-child dependency if parentId is set
      if (updates.parentId) {
        // Resolve parentId to UUID first (it may be a short_id)
        const parent = this.getIssue(updates.parentId);
        if (!parent) {
          throw new Error(`Parent issue not found: ${updates.parentId}`);
        }

        this.db.prepare(`
          INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
          VALUES (?, ?, ?, 'parent-child', ?)
        `).run(this.generateId(), issue.id, parent.id, now);

        // Update the shortId to be hierarchical under new parent
        if (parent.shortId) {
          const childCount = this.db.prepare(`
            SELECT COUNT(*) as count FROM issue_dependencies
            WHERE depends_on_id = ? AND dependency_type = 'parent-child'
          `).get(parent.id) as { count: number };

          const newShortId = `${parent.shortId}.${childCount.count}`;
          this.db.prepare(`UPDATE issues SET short_id = ?, updated_at = ? WHERE id = ?`).run(newShortId, now, issue.id);
        }
      } else {
        // Removing parent - regenerate as root-level ID
        const newShortId = this.generateShortId(issue.projectPath);
        this.db.prepare(`UPDATE issues SET short_id = ?, updated_at = ? WHERE id = ?`).run(newShortId, now, issue.id);
      }
    }

    if (fields.length === 0) return this.getIssue(issue.id);

    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(issue.id);

    const stmt = this.db.prepare(`UPDATE issues SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...params);

    // Emit SSE event for dashboard
    this.emitSSEEvent('issue', { type: 'updated', issueId: issue.id, projectPath: issue.projectPath });

    return this.getIssue(issueId);
  }

  listIssues(projectPath: string | null, args?: ListIssuesArgs): { issues: Issue[], queriedProjectPath: string | null } {
    // If id provided, resolve it to UUID for query
    let resolvedId: string | undefined;
    if (args?.id) {
      const issue = this.getIssue(args.id);
      if (issue) {
        resolvedId = issue.id;
      }
    }

    // If parentId provided, resolve it to UUID for query
    // Only use parent's project_path if not searching all projects (null means all)
    let queriedProjectPath = projectPath;
    let resolvedParentId: string | undefined;
    if (args?.parentId) {
      const parent = this.getIssue(args.parentId);
      if (parent) {
        if (projectPath !== null) {
          queriedProjectPath = parent.projectPath;
        }
        resolvedParentId = parent.id; // Use UUID for dependencies query
      }
    }

    let query = `
      SELECT t.*, GROUP_CONCAT(DISTINCT tl.label) as labels_csv,
        pd.depends_on_id as parent_id
      FROM issues t
      LEFT JOIN issue_labels tl ON t.id = tl.issue_id
      LEFT JOIN issue_dependencies pd ON t.id = pd.issue_id AND pd.dependency_type = 'parent-child'
    `;
    const params: SqliteBindValue[] = [];

    // If looking up by specific ID, bypass project filter (issue may have null project_path)
    if (resolvedId) {
      query += ' WHERE t.id = ?';
      params.push(resolvedId);
    } else if (queriedProjectPath !== null) {
      // Support querying all projects (null projectPath) or specific project
      // Check both primary project_path and issue_projects junction table
      query += ' WHERE (t.project_path = ? OR t.id IN (SELECT issue_id FROM issue_projects WHERE project_path = ?))';
      params.push(queriedProjectPath, queriedProjectPath);
    } else {
      query += ' WHERE 1=1'; // Allow filters to append with AND
    }

    if (args?.status) {
      query += ' AND t.status = ?';
      params.push(args.status);
    }
    if (args?.priority !== undefined) {
      query += ' AND t.priority = ?';
      params.push(args.priority);
    }
    if (args?.priorityMin !== undefined) {
      query += ' AND t.priority >= ?';
      params.push(args.priorityMin);
    }
    if (args?.priorityMax !== undefined) {
      query += ' AND t.priority <= ?';
      params.push(args.priorityMax);
    }
    if (args?.issueType) {
      query += ' AND t.issue_type = ?';
      params.push(args.issueType);
    }
    if (args?.planId) {
      // Resolve planId to full UUID (may be short_id like "PLAN-xxxx")
      const plan = this.getPlan(args.planId);
      if (plan) {
        query += ' AND t.plan_id = ?';
        params.push(plan.id);
      }
    }
    if (resolvedParentId) {
      // Filter by parent via dependencies table (using resolved UUID)
      query += ` AND t.id IN (
        SELECT issue_id FROM issue_dependencies
        WHERE depends_on_id = ? AND dependency_type = 'parent-child'
      )`;
      params.push(resolvedParentId);
    }
    if (args?.labels && args.labels.length > 0) {
      // All labels must match
      query += ` AND t.id IN (
        SELECT issue_id FROM issue_labels WHERE label IN (${args.labels.map(() => '?').join(',')})
        GROUP BY issue_id HAVING COUNT(DISTINCT label) = ?
      )`;
      params.push(...args.labels, args.labels.length);
    }
    if (args?.labelsAny && args.labelsAny.length > 0) {
      // Any label matches
      query += ` AND t.id IN (
        SELECT issue_id FROM issue_labels WHERE label IN (${args.labelsAny.map(() => '?').join(',')})
      )`;
      params.push(...args.labelsAny);
    }

    // Date filtering
    if (args?.createdAfter !== undefined) {
      query += ' AND t.created_at >= ?';
      params.push(args.createdAfter);
    }
    if (args?.createdBefore !== undefined) {
      query += ' AND t.created_at <= ?';
      params.push(args.createdBefore);
    }
    if (args?.updatedAfter !== undefined) {
      query += ' AND t.updated_at >= ?';
      params.push(args.updatedAfter);
    }
    if (args?.updatedBefore !== undefined) {
      query += ' AND t.updated_at <= ?';
      params.push(args.updatedBefore);
    }

    // Text search (case-insensitive)
    if (args?.search) {
      query += ' AND (t.title LIKE ? OR t.description LIKE ?)';
      const searchPattern = `%${args.search}%`;
      params.push(searchPattern, searchPattern);
    }

    // Assignee filter
    if (args?.assignee) {
      query += ' AND t.assigned_to_agent = ?';
      params.push(args.assignee);
    }

    query += ' GROUP BY t.id';

    // Sorting
    const sortBy = args?.sortBy || 'createdAt';
    const sortOrder = args?.sortOrder || 'desc';
    const sortColumn = sortBy === 'priority' ? 't.priority' :
                       sortBy === 'updatedAt' ? 't.updated_at' : 't.created_at';
    query += ` ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}`;

    if (args?.limit) {
      query += ' LIMIT ?';
      params.push(args.limit);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return {
      issues: rows.map(row => this.mapIssueRow(row)),
      queriedProjectPath,
    };
  }

  getIssue(issueId: string): Issue | null {
    const row = this.db.prepare(`
      SELECT t.*, GROUP_CONCAT(DISTINCT tl.label) as labels_csv,
        pd.depends_on_id as parent_id
      FROM issues t
      LEFT JOIN issue_labels tl ON t.id = tl.issue_id
      LEFT JOIN issue_dependencies pd ON t.id = pd.issue_id AND pd.dependency_type = 'parent-child'
      WHERE t.id = ? OR t.short_id = ?
      GROUP BY t.id
    `).get(issueId, issueId) as any;

    return row ? this.mapIssueRow(row) : null;
  }

  getIssueProjects(issueId: string): { primaryPath: string; additionalPaths: string[] } | null {
    // Resolve issueId (may be short_id)
    const issue = this.getIssue(issueId);
    if (!issue) return null;

    // Get additional paths from junction table
    const rows = this.db.prepare(`
      SELECT project_path FROM issue_projects WHERE issue_id = ? ORDER BY added_at
    `).all(issue.id) as Array<{ project_path: string }>;

    return {
      primaryPath: issue.projectPath,
      additionalPaths: rows.map(r => r.project_path),
    };
  }

  /**
   * Add an issue to an additional project (multi-project support).
   * @param issueId - Issue ID (may be short_id like "ISSUE-xxxx")
   * @param projectPath - Project path to associate with the issue
   * @returns { added: boolean; alreadyExists?: boolean } - Result of the operation
   */
  addIssueProject(issueId: string, projectPath: string): { added: boolean; alreadyExists?: boolean } {
    // Resolve issueId (may be short_id)
    const issue = this.getIssue(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    // Check if this is the primary path (no need to add to junction table)
    if (issue.projectPath === projectPath) {
      return { added: false, alreadyExists: true };
    }

    // INSERT OR IGNORE - if already exists, no error but no insert
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO issue_projects (issue_id, project_path, added_at)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(issue.id, projectPath, Date.now());

    return {
      added: result.changes > 0,
      alreadyExists: result.changes === 0,
    };
  }

  /**
   * Remove an issue from an additional project (multi-project support).
   * Cannot remove the primary project path.
   * @param issueId - Issue ID (may be short_id like "ISSUE-xxxx")
   * @param projectPath - Project path to remove from the issue
   * @returns { removed: boolean; error?: string } - Result of the operation
   */
  removeIssueProject(issueId: string, projectPath: string): { removed: boolean; error?: string } {
    // Resolve issueId (may be short_id)
    const issue = this.getIssue(issueId);
    if (!issue) {
      return { removed: false, error: `Issue not found: ${issueId}` };
    }

    // Prevent removing primary project path
    if (issue.projectPath === projectPath) {
      return { removed: false, error: 'Cannot remove primary project path. Use issue update to change the primary path.' };
    }

    // DELETE from junction table
    const stmt = this.db.prepare(`
      DELETE FROM issue_projects WHERE issue_id = ? AND project_path = ?
    `);
    const result = stmt.run(issue.id, projectPath);

    return {
      removed: result.changes > 0,
    };
  }

  private mapIssueRow(row: any): Issue {
    return {
      id: row.id,
      shortId: row.short_id,
      projectPath: row.project_path,
      title: row.title,
      description: row.description,
      details: row.details,
      status: row.status as IssueStatus,
      priority: row.priority,
      issueType: row.issue_type as IssueType,
      createdByAgent: row.created_by_agent,
      closedByAgent: row.closed_by_agent,
      createdInSession: row.created_in_session,
      closedInSession: row.closed_in_session,
      assignedToAgent: row.assigned_to_agent,
      assignedAt: row.assigned_at,
      assignedInSession: row.assigned_in_session,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      deferredAt: row.deferred_at,
      labels: row.labels_csv ? row.labels_csv.split(',') : [],
      parentId: row.parent_id || undefined,
      planId: row.plan_id || undefined,
    };
  }

  completeIssue(issueId: string, agentId?: string, sessionId?: string, force?: boolean): { issue: Issue; unblockedIssues: string[]; completedPlanId: string | null } | null {
    const issue = this.getIssue(issueId);
    if (!issue) return null;

    // Check for blocking dependencies
    if (!force) {
      const blockingDeps = this.db.prepare(`
        SELECT td.depends_on_id, t.status, t.short_id, t.title
        FROM issue_dependencies td
        JOIN issues t ON td.depends_on_id = t.id
        WHERE td.issue_id = ? AND td.dependency_type = 'blocks' AND t.status != 'closed'
      `).all(issue.id) as any[];

      if (blockingDeps.length > 0) {
        throw new DatabaseError(`Issue has ${blockingDeps.length} incomplete blocking dependencies`);
      }
    }

    const now = Date.now();
    this.db.prepare(`
      UPDATE issues SET status = 'closed', closed_at = ?, updated_at = ?,
        closed_by_agent = ?, closed_in_session = ?
      WHERE id = ?
    `).run(now, now, agentId || null, sessionId || null, issue.id);

    // Find issues that can now be unblocked
    const unblockedIssues: string[] = [];
    const dependentIssues = this.db.prepare(`
      SELECT DISTINCT td.issue_id, t.short_id
      FROM issue_dependencies td
      JOIN issues t ON td.issue_id = t.id
      WHERE td.depends_on_id = ? AND td.dependency_type = 'blocks' AND t.status = 'blocked'
    `).all(issue.id) as any[];

    for (const dep of dependentIssues) {
      // Check if all blocking deps are now closed
      const remainingBlocks = this.db.prepare(`
        SELECT COUNT(*) as count FROM issue_dependencies td
        JOIN issues t ON td.depends_on_id = t.id
        WHERE td.issue_id = ? AND td.dependency_type = 'blocks' AND t.status != 'closed'
      `).get(dep.issue_id) as { count: number };

      if (remainingBlocks.count === 0) {
        this.db.prepare(`UPDATE issues SET status = 'open', updated_at = ? WHERE id = ?`).run(now, dep.issue_id);
        unblockedIssues.push(dep.short_id || dep.issue_id);
      }
    }

    // Auto-complete plan if all linked epics are closed
    let completedPlanId: string | null = null;
    const closedIssue = this.getIssue(issueId)!;
    if (closedIssue.planId && closedIssue.issueType === 'epic') {
      const openEpics = this.db.prepare(`
        SELECT COUNT(*) as count FROM issues
        WHERE plan_id = ? AND issue_type = 'epic' AND status != 'closed'
      `).get(closedIssue.planId) as { count: number };

      if (openEpics.count === 0) {
        this.updatePlan(closedIssue.planId, { id: closedIssue.planId, status: 'completed' }, sessionId);
        completedPlanId = closedIssue.planId;
      }
    }

    // Emit SSE event for dashboard
    this.emitSSEEvent('issue', { type: 'completed', issueId: closedIssue.id, projectPath: closedIssue.projectPath });

    return { issue: closedIssue, unblockedIssues, completedPlanId };
  }

  deleteIssue(issueId: string): boolean {
    // Get issue before deletion for SSE event
    const issue = this.getIssue(issueId);

    const stmt = this.db.prepare(`DELETE FROM issues WHERE id = ? OR short_id = ?`);
    const result = stmt.run(issueId, issueId);

    if (result.changes > 0 && issue) {
      // Emit SSE event for dashboard
      this.emitSSEEvent('issue', { type: 'deleted', issueId: issue.id, projectPath: issue.projectPath });
    }

    return result.changes > 0;
  }

  /**
   * Mark an issue as a duplicate of another issue.
   * Sets status to 'closed', creates 'duplicate-of' dependency, and sets closed_at.
   * Note: "duplicate" is a relation type, not a status - tracked via the dependency.
   */
  markIssueAsDuplicate(
    issueId: string,
    duplicateOfId: string,
    agentId?: string,
    sessionId?: string
  ): { issue: Issue; dependencyCreated: boolean } | null {
    const issue = this.getIssue(issueId);
    if (!issue) return null;

    const canonicalIssue = this.getIssue(duplicateOfId);
    if (!canonicalIssue) return null;

    const now = Date.now();

    // Update the issue status to closed and set closed fields
    // Note: duplicate is tracked via the duplicate-of dependency, not the status
    this.db.prepare(`
      UPDATE issues SET status = 'closed', closed_at = ?, updated_at = ?,
        closed_by_agent = ?, closed_in_session = ?
      WHERE id = ?
    `).run(now, now, agentId || null, sessionId || null, issue.id);

    // Create the duplicate-of dependency
    let dependencyCreated = false;
    try {
      this.db.prepare(`
        INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(this.generateId(), issue.id, canonicalIssue.id, 'duplicate-of', now);
      dependencyCreated = true;
    } catch {
      // Dependency may already exist, that's okay
    }

    // Emit SSE event for dashboard
    this.emitSSEEvent('issue', { type: 'updated', issueId: issue.id, projectPath: issue.projectPath });

    const updatedIssue = this.getIssue(issueId)!;
    return { issue: updatedIssue, dependencyCreated };
  }

  /**
   * Clone an issue, creating a new issue with the same (or overridden) properties.
   * By default, copies title (with "Copy of" prefix), description, details, priority,
   * issueType, parentId, planId, and labels.
   */
  cloneIssue(
    issueId: string,
    overrides: {
      title?: string;
      description?: string;
      details?: string;
      status?: IssueStatus;
      priority?: number;
      issueType?: IssueType;
      parentId?: string;
      planId?: string;
      labels?: string[];
      include_labels?: boolean;
    } = {},
    agentId?: string,
    sessionId?: string
  ): Issue | null {
    const original = this.getIssue(issueId);
    if (!original) return null;

    // Determine final values (override or copy from original)
    const newTitle = overrides.title || `Copy of ${original.title}`;
    const newDescription = overrides.description !== undefined ? overrides.description : original.description;
    const newDetails = overrides.details !== undefined ? overrides.details : original.details;
    const newStatus = overrides.status || 'open';
    const newPriority = overrides.priority !== undefined ? overrides.priority : original.priority;
    const newIssueType = overrides.issueType || original.issueType;
    const newParentId = overrides.parentId !== undefined ? overrides.parentId : original.parentId;
    const newPlanId = overrides.planId !== undefined ? overrides.planId : original.planId;

    // Labels: use override if provided, otherwise copy from original (if include_labels !== false)
    let newLabels: string[] | undefined;
    if (overrides.labels !== undefined) {
      newLabels = overrides.labels;
    } else if (overrides.include_labels !== false && original.labels && original.labels.length > 0) {
      newLabels = [...original.labels];
    }

    // Create the new issue using the existing createIssue method
    const clonedIssue = this.createIssue(
      original.projectPath,
      {
        title: newTitle,
        description: newDescription,
        details: newDetails,
        status: newStatus,
        priority: newPriority,
        issueType: newIssueType,
        parentId: newParentId || undefined,
        planId: newPlanId || undefined,
        labels: newLabels,
      },
      agentId,
      sessionId
    );

    return clonedIssue;
  }

  // Dependency Operations
  addDependency(issueId: string, dependsOnId: string, dependencyType: DependencyType = 'blocks'): AddDependencyResult | null {
    const now = Date.now();

    // Get both issues for rich response
    const issue = this.getIssue(issueId);
    const dependsOnIssue = this.getIssue(dependsOnId);
    if (!issue || !dependsOnIssue) return null;

    try {
      // Use resolved IDs (issue.id, dependsOnIssue.id) - input may be short_id
      this.db.prepare(`
        INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(this.generateId(), issue.id, dependsOnIssue.id, dependencyType, now);

      // If blocking dependency, mark issue as blocked
      let issueBlocked = false;
      if (dependencyType === 'blocks' && dependsOnIssue.status !== 'closed') {
        this.db.prepare(`UPDATE issues SET status = 'blocked', updated_at = ? WHERE id = ?`).run(now, issue.id);
        issueBlocked = true;
      }

      // If parent-child dependency, update the child's shortId to be hierarchical
      let updatedShortId = issue.shortId || issue.id;
      if (dependencyType === 'parent-child' && dependsOnIssue.shortId) {
        // Count existing children of this parent (excluding the one we just added)
        const childCount = this.db.prepare(`
          SELECT COUNT(*) as count FROM issue_dependencies
          WHERE depends_on_id = ? AND dependency_type = 'parent-child'
        `).get(dependsOnIssue.id) as { count: number };

        updatedShortId = `${dependsOnIssue.shortId}.${childCount.count}`;
        this.db.prepare(`UPDATE issues SET short_id = ?, updated_at = ? WHERE id = ?`).run(updatedShortId, now, issue.id);
      }

      return {
        created: true,
        issueId: issue.id,
        issueShortId: updatedShortId,
        dependsOnId: dependsOnIssue.id,
        dependsOnShortId: dependsOnIssue.shortId || dependsOnIssue.id,
        dependencyType,
        issueBlocked,
      };
    } catch {
      return null; // Duplicate or constraint violation
    }
  }

  removeDependency(issueId: string, dependsOnId: string): RemoveDependencyResult {
    // Resolve IDs (input may be short_id)
    const issue = this.getIssue(issueId);
    const dependsOnIssue = this.getIssue(dependsOnId);

    const resolvedIssueId = issue?.id || issueId;
    const resolvedDependsOnId = dependsOnIssue?.id || dependsOnId;

    const result = this.db.prepare(`
      DELETE FROM issue_dependencies WHERE issue_id = ? AND depends_on_id = ?
    `).run(resolvedIssueId, resolvedDependsOnId);

    let issueUnblocked = false;
    if (result.changes > 0 && issue) {
      // Check if issue can be unblocked
      const remainingBlocks = this.db.prepare(`
        SELECT COUNT(*) as count FROM issue_dependencies td
        JOIN issues t ON td.depends_on_id = t.id
        WHERE td.issue_id = ? AND td.dependency_type = 'blocks' AND t.status != 'closed'
      `).get(resolvedIssueId) as { count: number };

      if (remainingBlocks.count === 0) {
        if (issue.status === 'blocked') {
          this.db.prepare(`UPDATE issues SET status = 'open', updated_at = ? WHERE id = ?`).run(Date.now(), resolvedIssueId);
          issueUnblocked = true;
        }
      }
    }

    return {
      removed: result.changes > 0,
      issueId: resolvedIssueId,
      dependsOnId: resolvedDependsOnId,
      issueUnblocked,
    };
  }

  // Label Operations
  addLabels(issueId: string, labels: string[]): AddLabelsResult | null {
    const issue = this.getIssue(issueId);
    if (!issue) return null;

    const stmt = this.db.prepare(`INSERT OR IGNORE INTO issue_labels (id, issue_id, label) VALUES (?, ?, ?)`);
    let added = 0;
    for (const label of labels) {
      const result = stmt.run(this.generateId(), issue.id, label.trim().toLowerCase());
      added += result.changes;
    }

    // Get updated labels
    const allLabels = this.db.prepare(`SELECT label FROM issue_labels WHERE issue_id = ?`).all(issue.id) as { label: string }[];

    return {
      issueId: issue.id,
      shortId: issue.shortId || issue.id,
      labels: allLabels.map(l => l.label),
      addedCount: added,
    };
  }

  removeLabels(issueId: string, labels: string[]): RemoveLabelsResult | null {
    const issue = this.getIssue(issueId);
    if (!issue) return null;

    const stmt = this.db.prepare(`DELETE FROM issue_labels WHERE issue_id = ? AND label = ?`);
    let removed = 0;
    for (const label of labels) {
      const result = stmt.run(issue.id, label.trim().toLowerCase());
      removed += result.changes;
    }

    // Get remaining labels
    const remainingLabels = this.db.prepare(`SELECT label FROM issue_labels WHERE issue_id = ?`).all(issue.id) as { label: string }[];

    return {
      issueId: issue.id,
      shortId: issue.shortId || issue.id,
      labels: remainingLabels.map(l => l.label),
      removedCount: removed,
    };
  }

  // Agent Assignment Operations
  claimIssues(issueIds: string[], agentId: string, sessionId?: string): ClaimIssuesResult {
    const now = Date.now();
    const claimedIssues: ClaimIssuesResult['claimedIssues'] = [];
    const alreadyClaimed: string[] = [];
    const notFound: string[] = [];

    for (const issueId of issueIds) {
      const issue = this.getIssue(issueId);
      if (!issue) {
        notFound.push(issueId);
        continue;
      }
      if (issue.status === 'closed') {
        alreadyClaimed.push(issue.shortId || issue.id);
        continue;
      }
      if (issue.assignedToAgent && issue.assignedToAgent !== agentId) {
        alreadyClaimed.push(issue.shortId || issue.id);
        continue;
      }

      this.db.prepare(`
        UPDATE issues SET assigned_to_agent = ?, assigned_at = ?, assigned_in_session = ?,
          status = 'in_progress', updated_at = ?
        WHERE id = ?
      `).run(agentId, now, sessionId || null, now, issue.id);

      // Emit SSE event for dashboard
      this.emitSSEEvent('issue', { type: 'updated', issueId: issue.id, projectPath: issue.projectPath });

      claimedIssues.push({
        id: issue.id,
        shortId: issue.shortId || issue.id,
        title: issue.title,
      });
    }

    return { claimedIssues, alreadyClaimed, notFound };
  }

  releaseIssues(issueIds: string[], agentId: string): ReleaseIssuesResult {
    const now = Date.now();
    const releasedIssues: ReleaseIssuesResult['releasedIssues'] = [];
    const notOwned: string[] = [];
    const notFound: string[] = [];

    for (const issueId of issueIds) {
      const issue = this.getIssue(issueId);
      if (!issue) {
        notFound.push(issueId);
        continue;
      }
      if (issue.assignedToAgent !== agentId) {
        notOwned.push(issue.shortId || issue.id);
        continue;
      }

      this.db.prepare(`
        UPDATE issues SET assigned_to_agent = NULL, assigned_at = NULL, assigned_in_session = NULL,
          status = 'open', updated_at = ?
        WHERE id = ?
      `).run(now, issue.id);

      // Emit SSE event for dashboard
      this.emitSSEEvent('issue', { type: 'updated', issueId: issue.id, projectPath: issue.projectPath });

      releasedIssues.push({
        id: issue.id,
        shortId: issue.shortId || issue.id,
        title: issue.title,
      });
    }

    return { releasedIssues, notOwned, notFound };
  }

  getReadyIssues(projectPath: string, limit?: number): Issue[] {
    const query = `
      SELECT t.*, GROUP_CONCAT(DISTINCT tl.label) as labels_csv,
        pd.depends_on_id as parent_id
      FROM issues t
      LEFT JOIN issue_labels tl ON t.id = tl.issue_id
      LEFT JOIN issue_dependencies pd ON t.id = pd.issue_id AND pd.dependency_type = 'parent-child'
      WHERE t.project_path = ? AND t.status = 'open' AND t.assigned_to_agent IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM issue_dependencies td
          JOIN issues dep ON td.depends_on_id = dep.id
          WHERE td.issue_id = t.id AND td.dependency_type = 'blocks' AND dep.status != 'closed'
        )
      GROUP BY t.id
      ORDER BY t.priority DESC, t.created_at ASC
      ${limit ? 'LIMIT ?' : ''}
    `;
    const params: SqliteBindValue[] = [projectPath];
    if (limit) params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => this.mapIssueRow(row));
  }

  getNextBlock(projectPath: string, count: number, agentId: string, sessionId?: string): GetNextBlockResult {
    const readyIssues = this.getReadyIssues(projectPath, count);
    if (readyIssues.length === 0) {
      return { issues: [], claimedCount: 0, agentId };
    }

    const issueIds = readyIssues.map(t => t.id);
    this.claimIssues(issueIds, agentId, sessionId);

    const claimedIssues = readyIssues.map(t => ({
      ...t,
      status: 'in_progress' as IssueStatus,
      assignedToAgent: agentId,
    }));

    return {
      issues: claimedIssues,
      claimedCount: claimedIssues.length,
      agentId,
    };
  }

  // Batch Creation
  createBatch(projectPath: string, args: CreateBatchArgs, agentId?: string, sessionId?: string): CreateBatchResult {
    const now = Date.now();
    const createdIssues: CreateBatchResult['issues'] = [];
    const createdDeps: CreateBatchResult['dependencies'] = [];

    // First pass: create all issues
    for (let i = 0; i < args.issues.length; i++) {
      const issueData = args.issues[i];
      const issueId = this.generateId();

      // Resolve parentId if it references an earlier issue in batch or is a shortId
      let resolvedParentId = issueData.parentId;
      let parentShortIdFromBatch: string | undefined;
      if (resolvedParentId && resolvedParentId.startsWith('$')) {
        const refIndex = parseInt(resolvedParentId.slice(1), 10);
        if (refIndex >= 0 && refIndex < createdIssues.length) {
          resolvedParentId = createdIssues[refIndex].id;
          parentShortIdFromBatch = createdIssues[refIndex].shortId;
        } else {
          throw new Error(`Invalid parentId reference: ${issueData.parentId}`);
        }
      } else if (resolvedParentId) {
        // Resolve shortId or UUID to actual UUID
        const parent = this.getIssue(resolvedParentId);
        if (parent) {
          parentShortIdFromBatch = parent.shortId || undefined;
          resolvedParentId = parent.id;
        }
      }

      // Generate hierarchical short ID
      const shortId = this.generateShortId(projectPath, resolvedParentId, parentShortIdFromBatch);

      // Use issue-level planId override, or batch-level planId default
      const effectivePlanId = issueData.planId || args.planId || null;

      this.db.prepare(`
        INSERT INTO issues (
          id, short_id, project_path, title, description, details,
          status, priority, issue_type, plan_id,
          created_by_agent, created_in_session, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        issueId,
        shortId,
        projectPath,
        issueData.title,
        issueData.description || null,
        issueData.details || null,
        'open',
        issueData.priority ?? 2,
        issueData.issueType || 'task',
        effectivePlanId,
        agentId || null,
        sessionId || null,
        now,
        now
      );

      // Create parent-child dependency via issue_dependencies table
      if (resolvedParentId) {
        this.db.prepare(`
          INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
          VALUES (?, ?, ?, 'parent-child', ?)
        `).run(this.generateId(), issueId, resolvedParentId, now);
      }

      // Create labels if provided
      if (issueData.labels && issueData.labels.length > 0) {
        const labelStmt = this.db.prepare(`INSERT OR IGNORE INTO issue_labels (id, issue_id, label) VALUES (?, ?, ?)`);
        for (const label of issueData.labels) {
          labelStmt.run(this.generateId(), issueId, label.trim().toLowerCase());
        }
      }

      createdIssues.push({
        id: issueId,
        shortId,
        title: issueData.title,
        index: i,
      });
    }

    // Second pass: create dependencies
    if (args.dependencies) {
      for (const dep of args.dependencies) {
        const issue = createdIssues[dep.issueIndex];
        const dependsOn = createdIssues[dep.dependsOnIndex];
        const depType = dep.dependencyType || 'blocks';

        this.db.prepare(`
          INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(this.generateId(), issue.id, dependsOn.id, depType, now);

        createdDeps.push({
          issueShortId: issue.shortId,
          dependsOnShortId: dependsOn.shortId,
          dependencyType: depType,
        });

        // If blocking dependency, mark issue as blocked
        if (depType === 'blocks') {
          this.db.prepare(`UPDATE issues SET status = 'blocked', updated_at = ? WHERE id = ?`).run(now, issue.id);
        }
      }
    }

    // Emit SSE events for all created issues
    for (const issue of createdIssues) {
      this.emitSSEEvent('issue', { type: 'created', issueId: issue.id, projectPath });
    }

    return {
      issues: createdIssues,
      dependencies: createdDeps,
      count: createdIssues.length,
      dependencyCount: createdDeps.length,
    };
  }

  // ======================
  // Checkpoint Operations
  // ======================

  createCheckpoint(
    checkpoint: Omit<Checkpoint, 'id' | 'created_at' | 'item_count' | 'total_size'>,
    filters?: {
      include_tags?: string[];
      include_keys?: string[];
      include_categories?: string[];
      exclude_tags?: string[];
    }
  ): Checkpoint {
    return this.transaction(() => {
      const now = Date.now();
      const id = this.generateId();

      // Get all context items for this session
      let items = this.getContextItems(checkpoint.session_id);

      // Apply filters if provided
      if (filters) {
        items = items.filter(item => {
          const itemTags: string[] = safeParseTagsJson(item.tags);

          // Filter by include_tags
          if (filters.include_tags && filters.include_tags.length > 0) {
            const hasIncludedTag = filters.include_tags.some(tag => itemTags.includes(tag));
            if (!hasIncludedTag) return false;
          }

          // Filter by include_keys (wildcard patterns)
          if (filters.include_keys && filters.include_keys.length > 0) {
            const matchesKey = filters.include_keys.some(pattern => {
              const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
              return regex.test(item.key);
            });
            if (!matchesKey) return false;
          }

          // Filter by include_categories
          if (filters.include_categories && filters.include_categories.length > 0) {
            if (!filters.include_categories.includes(item.category)) return false;
          }

          // Filter by exclude_tags
          if (filters.exclude_tags && filters.exclude_tags.length > 0) {
            const hasExcludedTag = filters.exclude_tags.some(tag => itemTags.includes(tag));
            if (hasExcludedTag) return false;
          }

          return true;
        });
      }

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

  restoreCheckpoint(
    checkpointId: string,
    targetSessionId: string,
    filters?: {
      restore_tags?: string[];
      restore_categories?: string[];
    }
  ): number {
    return this.transaction(() => {
      // Get checkpoint items
      let items = this.getCheckpointItems(checkpointId);

      // Apply filters if provided
      if (filters) {
        items = items.filter(item => {
          const itemTags: string[] = safeParseTagsJson(item.tags);

          // Filter by restore_tags
          if (filters.restore_tags && filters.restore_tags.length > 0) {
            const hasTag = filters.restore_tags.some(tag => itemTags.includes(tag));
            if (!hasTag) return false;
          }

          // Filter by restore_categories
          if (filters.restore_categories && filters.restore_categories.length > 0) {
            if (!filters.restore_categories.includes(item.category)) return false;
          }

          return true;
        });
      }

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
          tags: item.tags,
          size: item.size,
        });
        restored++;
      }

      return restored;
    });
  }

  /**
   * Add items to an existing checkpoint
   */
  addItemsToCheckpoint(checkpointId: string, sessionId: string, itemKeys: string[]): number {
    return this.transaction(() => {
      const linkStmt = this.db.prepare(`
        INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id)
        VALUES (?, ?, ?)
      `);

      let added = 0;
      for (const key of itemKeys) {
        const item = this.getContextItem(sessionId, key);
        if (item) {
          // Check if item is already in checkpoint
          const existsStmt = this.db.prepare(`
            SELECT 1 FROM checkpoint_items
            WHERE checkpoint_id = ? AND context_item_id = ?
          `);
          const exists = existsStmt.get(checkpointId, item.id);

          if (!exists) {
            linkStmt.run(this.generateId(), checkpointId, item.id);
            added++;
          }
        }
      }

      // Update checkpoint stats
      if (added > 0) {
        const items = this.getCheckpointItems(checkpointId);
        const updateStmt = this.db.prepare(`
          UPDATE checkpoints
          SET item_count = ?, total_size = ?
          WHERE id = ?
        `);
        updateStmt.run(
          items.length,
          items.reduce((sum, item) => sum + item.size, 0),
          checkpointId
        );
      }

      return added;
    });
  }

  /**
   * Remove items from an existing checkpoint
   */
  removeItemsFromCheckpoint(checkpointId: string, sessionId: string, itemKeys: string[]): number {
    return this.transaction(() => {
      const deleteStmt = this.db.prepare(`
        DELETE FROM checkpoint_items
        WHERE checkpoint_id = ? AND context_item_id = ?
      `);

      let removed = 0;
      for (const key of itemKeys) {
        const item = this.getContextItem(sessionId, key);
        if (item) {
          const result = deleteStmt.run(checkpointId, item.id);
          if (result.changes > 0) removed++;
        }
      }

      // Update checkpoint stats
      if (removed > 0) {
        const items = this.getCheckpointItems(checkpointId);
        const updateStmt = this.db.prepare(`
          UPDATE checkpoints
          SET item_count = ?, total_size = ?
          WHERE id = ?
        `);
        updateStmt.run(
          items.length,
          items.reduce((sum, item) => sum + item.size, 0),
          checkpointId
        );
      }

      return removed;
    });
  }

  /**
   * Split a checkpoint into multiple checkpoints based on filters
   */
  splitCheckpoint(
    sourceCheckpointId: string,
    splits: Array<{
      name: string;
      description?: string;
      include_tags?: string[];
      include_categories?: string[];
    }>
  ): Checkpoint[] {
    return this.transaction(() => {
      const sourceCheckpoint = this.getCheckpoint(sourceCheckpointId);
      if (!sourceCheckpoint) {
        throw new DatabaseError('Source checkpoint not found', { sourceCheckpointId });
      }

      const allItems = this.getCheckpointItems(sourceCheckpointId);
      const newCheckpoints: Checkpoint[] = [];

      for (const split of splits) {
        // Filter items for this split
        let items = allItems.filter(item => {
          const itemTags: string[] = safeParseTagsJson(item.tags);

          // Filter by include_tags
          if (split.include_tags && split.include_tags.length > 0) {
            const hasTag = split.include_tags.some(tag => itemTags.includes(tag));
            if (!hasTag) return false;
          }

          // Filter by include_categories
          if (split.include_categories && split.include_categories.length > 0) {
            if (!split.include_categories.includes(item.category)) return false;
          }

          return true;
        });

        // Create new checkpoint with filtered items
        const now = Date.now();
        const id = this.generateId();
        const item_count = items.length;
        const total_size = items.reduce((sum, item) => sum + item.size, 0);

        const stmt = this.db.prepare(`
          INSERT INTO checkpoints
          (id, session_id, name, description, git_status, git_branch, item_count, total_size, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          id,
          sourceCheckpoint.session_id,
          split.name,
          split.description || null,
          sourceCheckpoint.git_status ?? null,
          sourceCheckpoint.git_branch ?? null,
          item_count,
          total_size,
          now
        );

        // Link items to new checkpoint
        const linkStmt = this.db.prepare(`
          INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id)
          VALUES (?, ?, ?)
        `);

        for (const item of items) {
          linkStmt.run(this.generateId(), id, item.id);
        }

        newCheckpoints.push({
          id,
          session_id: sourceCheckpoint.session_id,
          name: split.name,
          description: split.description,
          git_status: sourceCheckpoint.git_status,
          git_branch: sourceCheckpoint.git_branch,
          item_count,
          total_size,
          created_at: now,
        } as Checkpoint);
      }

      return newCheckpoints;
    });
  }

  deleteCheckpoint(checkpointId: string): boolean {
    return this.transaction(() => {
      const checkpoint = this.getCheckpoint(checkpointId);
      if (!checkpoint) {
        return false;
      }

      // Delete checkpoint (CASCADE will delete checkpoint_items)
      const stmt = this.db.prepare('DELETE FROM checkpoints WHERE id = ?');
      const result = stmt.run(checkpointId);

      return result.changes > 0;
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

  // ================
  // Plan Operations
  // ================

  /**
   * Generate a short ID for plans
   */
  private generatePlanShortId(project: Project): string {
    const prefix = project.plan_prefix || 'PLAN';
    const hash = this.generateHash();
    return `${prefix}-${hash}`;
  }

  createPlan(projectPath: string, args: CreatePlanArgs, sessionId?: string): Plan {
    // Plans must be linked to an existing project - don't auto-create
    const project = this.getProject(projectPath);
    if (!project) {
      throw new Error(`Project not found for path: ${projectPath}. Create the project first or use an existing project path.`);
    }
    const now = Date.now();
    const id = this.generateId();
    const shortId = this.generatePlanShortId(project);

    const stmt = this.db.prepare(`
      INSERT INTO plans (
        id, short_id, project_id, project_path, title, content, status,
        success_criteria, created_in_session, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const status = args.status || 'draft';

    stmt.run(
      id, shortId, project.id, projectPath, args.title, args.content || null,
      status, args.successCriteria || null, sessionId || null, now, now
    );

    const plan = {
      id,
      short_id: shortId,
      project_path: projectPath,
      project_id: project.id,
      title: args.title,
      status: status as PlanStatus,
      success_criteria: args.successCriteria || null,
      epic_count: 0,
      linked_issue_count: 0,
      linked_issue_completed_count: 0,
      created_in_session: sessionId || null,
      completed_in_session: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };

    this.emitSSEEvent('plan', { type: 'created', planId: id, projectPath });

    return plan;
  }

  getPlan(planId: string): (Plan & { content?: string }) | null {
    const row = this.db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM issues WHERE plan_id = p.id AND issue_type = 'epic') as epic_count,
        (SELECT COUNT(*) FROM issues WHERE plan_id = p.id AND issue_type != 'epic') as linked_issue_count,
        (SELECT COUNT(*) FROM issues WHERE plan_id = p.id AND issue_type != 'epic' AND status = 'closed') as linked_issue_completed_count
      FROM plans p WHERE p.id = ? OR p.short_id = ?
    `).get(planId, planId) as any;

    return row ? this.mapPlanRow(row) : null;
  }

  listPlans(projectPath: string, args?: ListPlansArgs): Plan[] {
    let query = `
      SELECT p.*,
        (SELECT COUNT(*) FROM issues WHERE plan_id = p.id AND issue_type = 'epic') as epic_count,
        (SELECT COUNT(*) FROM issues WHERE plan_id = p.id AND issue_type != 'epic') as linked_issue_count,
        (SELECT COUNT(*) FROM issues WHERE plan_id = p.id AND issue_type != 'epic' AND status = 'closed') as linked_issue_completed_count
      FROM plans p WHERE p.project_path = ?`;
    const params: SqliteBindValue[] = [projectPath];

    if (args?.status && args.status !== 'all') {
      query += ' AND p.status = ?';
      params.push(args.status);
    }

    query += ' ORDER BY p.updated_at DESC';

    if (args?.limit) {
      query += ' LIMIT ?';
      params.push(args.limit);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => this.mapPlanRow(row));
  }

  updatePlan(planId: string, updates: UpdatePlanArgs, sessionId?: string): Plan | null {
    const plan = this.getPlan(planId);
    if (!plan) return null;

    const fields: string[] = [];
    const params: SqliteBindValue[] = [];
    let newProjectPath: string | undefined;
    let newProjectId: string | undefined;

    if (updates.title !== undefined) {
      fields.push('title = ?');
      params.push(updates.title);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      params.push(updates.content);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);
      if (updates.status === 'completed') {
        fields.push('completed_at = ?');
        params.push(Date.now());
        fields.push('completed_in_session = ?');
        params.push(sessionId || null);
      }
    }
    if (updates.successCriteria !== undefined) {
      fields.push('success_criteria = ?');
      params.push(updates.successCriteria);
    }
    if (updates.project_path !== undefined && updates.project_path !== plan.project_path) {
      // Validate new project exists
      const newProject = this.getProject(updates.project_path);
      if (!newProject) {
        throw new Error(`Project not found for path: ${updates.project_path}`);
      }
      fields.push('project_path = ?');
      params.push(updates.project_path);
      fields.push('project_id = ?');
      params.push(newProject.id);
      newProjectPath = updates.project_path;
      newProjectId = newProject.id;
    }

    if (fields.length === 0) return plan;

    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(plan.id);

    const stmt = this.db.prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...params);

    // Cascade project_path change to all linked issues
    if (newProjectPath) {
      this.db.prepare(`
        UPDATE issues
        SET project_path = ?, updated_at = ?
        WHERE plan_id = ?
      `).run(newProjectPath, Date.now(), plan.id);
    }

    this.emitSSEEvent('plan', { type: 'updated', planId: plan.id, projectPath: newProjectPath || plan.project_path });

    return this.getPlan(plan.id);
  }

  deletePlan(planId: string): boolean {
    const plan = this.getPlan(planId);
    const stmt = this.db.prepare('DELETE FROM plans WHERE id = ? OR short_id = ?');
    const result = stmt.run(planId, planId);

    if (result.changes > 0 && plan) {
      this.emitSSEEvent('plan', { type: 'deleted', planId, projectPath: plan.project_path });
    }

    return result.changes > 0;
  }

  private mapPlanRow(row: any): Plan & { content?: string } {
    return {
      id: row.id,
      short_id: row.short_id,
      project_path: row.project_path,
      project_id: row.project_id,
      title: row.title,
      content: row.content,
      status: row.status as PlanStatus,
      success_criteria: row.success_criteria,
      epic_count: row.epic_count || 0,
      linked_issue_count: row.linked_issue_count || 0,
      linked_issue_completed_count: row.linked_issue_completed_count || 0,
      created_in_session: row.created_in_session,
      completed_in_session: row.completed_in_session,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    };
  }

  // ====================
  // Embedding Operations (Chunked)
  // ====================

  /**
   * Save chunked embeddings for a context item
   * Large items are split into multiple chunks for full semantic coverage
   */
  saveChunkEmbeddings(
    itemId: string,
    chunks: Array<{ index: number; embedding: number[] }>,
    provider: string,
    model: string
  ): void {
    const now = Date.now();

    // Delete existing chunks for this item
    const deleteStmt = this.db.prepare('DELETE FROM vec_context_chunks WHERE item_id = ?');
    deleteStmt.run(itemId);

    // Insert new chunks
    const insertStmt = this.db.prepare(`
      INSERT INTO vec_context_chunks (embedding, item_id, chunk_index)
      VALUES (?, ?, ?)
    `);

    for (const chunk of chunks) {
      insertStmt.run(JSON.stringify(chunk.embedding), itemId, BigInt(chunk.index));
    }

    // Update context item with embedding metadata
    const updateStmt = this.db.prepare(`
      UPDATE context_items
      SET embedding_status = 'complete',
          embedding_provider = ?,
          embedding_model = ?,
          chunk_count = ?,
          embedded_at = ?
      WHERE id = ?
    `);
    updateStmt.run(provider, model, chunks.length, now, itemId);
  }

  /**
   * Perform semantic search using k-NN on chunked embeddings
   * Searches all chunks, deduplicates by item_id, returns best match per item
   * Pass null for sessionId to search across all sessions
   */
  semanticSearch(
    queryEmbedding: number[],
    sessionId: string | null,
    options?: {
      threshold?: number;
      limit?: number;
      category?: string;
      priority?: string;
    }
  ): Array<ContextItem & { distance: number }> {
    const threshold = options?.threshold ?? 0.5;
    const limit = options?.limit ?? 20;
    const knnLimit = limit * 10;

    let query = `
      SELECT ci.*, MIN(vec.distance) as distance
      FROM (
        SELECT item_id, distance
        FROM vec_context_chunks
        WHERE embedding MATCH ? AND k = ?
      ) vec
      JOIN context_items ci ON ci.id = vec.item_id
      WHERE vec.distance < ?
    `;
    const params: SqliteBindValue[] = [JSON.stringify(queryEmbedding), knnLimit, threshold];

    if (sessionId) {
      query += ' AND ci.session_id = ?';
      params.push(sessionId);
    }

    if (options?.category) {
      query += ' AND ci.category = ?';
      params.push(options.category);
    }

    if (options?.priority) {
      query += ' AND ci.priority = ?';
      params.push(options.priority);
    }

    query += ' GROUP BY ci.id ORDER BY distance ASC LIMIT ?';
    params.push(limit);

    try {
      const stmt = this.db.prepare(query);
      return stmt.all(...params) as Array<ContextItem & { distance: number }>;
    } catch (error) {
      // If vec table doesn't exist or other error, return empty
      console.warn('[SaveContext] Semantic search failed:', error);
      return [];
    }
  }

  /**
   * Get items that need embeddings generated (for a specific session)
   */
  getItemsNeedingEmbeddings(sessionId: string, limit: number = 50): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items
      WHERE session_id = ?
        AND (embedding_status IS NULL OR embedding_status = 'none' OR embedding_status = 'pending')
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(sessionId, limit) as ContextItem[];
  }

  /**
   * Get ALL items that need embeddings generated (across all sessions)
   * Used for backfill operations. Includes error status for retry.
   */
  getAllItemsNeedingEmbeddings(limit: number = 100): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items
      WHERE embedding_status IS NULL OR embedding_status = 'none' OR embedding_status = 'pending' OR embedding_status = 'error'
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as ContextItem[];
  }

  /**
   * Get embedding statistics for status display
   * Note: 'error' items are counted as pending since backfill retries them
   */
  getEmbeddingStats(): { total: number; embedded: number; pending: number; totalChunks: number } {
    const itemStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN embedding_status = 'complete' THEN 1 ELSE 0 END) as embedded,
        SUM(CASE WHEN embedding_status IS NULL OR embedding_status = 'none' OR embedding_status = 'pending' OR embedding_status = 'error' THEN 1 ELSE 0 END) as pending
      FROM context_items
    `).get() as { total: number; embedded: number; pending: number };

    // Get total chunk count
    let totalChunks = 0;
    try {
      const chunkStats = this.db.prepare('SELECT COUNT(*) as count FROM vec_context_chunks').get() as { count: number };
      totalChunks = chunkStats.count || 0;
    } catch {
      // Table might not exist yet
    }

    return {
      total: itemStats.total || 0,
      embedded: itemStats.embedded || 0,
      pending: itemStats.pending || 0,
      totalChunks,
    };
  }

  /**
   * Mark an item's embedding status
   */
  updateEmbeddingStatus(itemId: string, status: 'none' | 'pending' | 'complete' | 'error'): void {
    const stmt = this.db.prepare(`
      UPDATE context_items SET embedding_status = ? WHERE id = ?
    `);
    stmt.run(status, itemId);
  }

  /**
   * Delete embeddings for a context item (all chunks)
   */
  deleteEmbedding(itemId: string): void {
    const stmt = this.db.prepare('DELETE FROM vec_context_chunks WHERE item_id = ?');
    stmt.run(itemId);

    const updateStmt = this.db.prepare(`
      UPDATE context_items
      SET embedding_status = 'none', embedding_provider = NULL, embedding_model = NULL,
          chunk_count = 0, embedded_at = NULL
      WHERE id = ?
    `);
    updateStmt.run(itemId);
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

  // ====================
  // Dynamic Vec Table Dimensions
  // ====================

  /**
   * Get current vec table dimensions from metadata
   */
  getVecDimensions(): number {
    try {
      const stmt = this.db.prepare('SELECT value FROM embeddings_meta WHERE key = ?');
      const row = stmt.get('vec_dimensions') as { value: string } | undefined;
      return row ? parseInt(row.value, 10) : 768;
    } catch {
      // Table might not exist yet (pre-migration 008)
      return 768;
    }
  }

  /**
   * Set vec table dimensions in metadata
   */
  private setVecDimensions(dimensions: number): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings_meta (key, value, updated_at)
      VALUES ('vec_dimensions', ?, ?)
    `);
    stmt.run(dimensions.toString(), Date.now());
  }

  /**
   * Recreate vec_context_chunks table with new dimensions
   * Drops all existing embeddings and resets item statuses
   */
  recreateVecTable(dimensions: number): void {
    // Drop existing vec table
    this.db.exec('DROP TABLE IF EXISTS vec_context_chunks');

    // Create with new dimensions
    this.db.exec(`
      CREATE VIRTUAL TABLE vec_context_chunks USING vec0(
        embedding float[${dimensions}] distance_metric=cosine,
        item_id TEXT,
        chunk_index INTEGER
      )
    `);

    // Reset all embedding statuses
    this.db.exec(`
      UPDATE context_items
      SET embedding_status = 'none',
          embedding_provider = NULL,
          embedding_model = NULL,
          chunk_count = 0,
          embedded_at = NULL
    `);

    // Update stored dimensions
    this.setVecDimensions(dimensions);
  }

  /**
   * Ensure vec table has correct dimensions for provider
   * Recreates table if dimensions don't match
   * Returns true if table was recreated
   */
  ensureVecDimensions(providerDimensions: number): boolean {
    const currentDimensions = this.getVecDimensions();

    if (currentDimensions !== providerDimensions) {
      console.error(
        `[SaveContext] Vec table dimension mismatch: table=${currentDimensions}, provider=${providerDimensions}. Recreating...`
      );
      this.recreateVecTable(providerDimensions);
      console.error(`[SaveContext] Vec table recreated with ${providerDimensions} dimensions`);
      return true;
    }

    return false;
  }
}
