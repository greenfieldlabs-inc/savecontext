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

      return {
        id,
        ...session,
        status: session.status || 'active',
        created_at: now,
        updated_at: now,
      } as Session;
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
    }
  ): Session[] {
    if (projectPaths.length === 0) {
      return [];
    }

    const placeholders = projectPaths.map(() => '?').join(',');
    let query = `
      SELECT DISTINCT s.* FROM sessions s
      JOIN session_projects sp ON s.id = sp.session_id
      WHERE sp.project_path IN (${placeholders})
    `;
    const params: any[] = [...projectPaths];

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
    const params: any[] = [];

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

    if (options.keys) {
      // Tag specific keys
      for (const key of options.keys) {
        const item = this.getContextItem(sessionId, key);
        if (item) items.push(item);
      }
    } else if (options.key_pattern) {
      // Tag by pattern (e.g., "feature_*")
      const pattern = options.key_pattern.replace(/\*/g, '%');
      const stmt = this.db.prepare(`
        SELECT * FROM context_items
        WHERE session_id = ? AND key LIKE ?
      `);
      items = stmt.all(sessionId, pattern) as ContextItem[];
    }

    // Update tags for each item
    let updated = 0;
    for (const item of items) {
      const currentTags: string[] = JSON.parse(item.tags || '[]');
      let newTags: string[];

      if (options.action === 'add') {
        // Add tags (no duplicates)
        newTags = [...new Set([...currentTags, ...options.tags])];
      } else {
        // Remove tags
        newTags = currentTags.filter(tag => !options.tags.includes(tag));
      }

      this.updateContextItem(sessionId, item.key, {
        tags: JSON.stringify(newTags)
      });
      updated++;
    }

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
    const params: any[] = [projectPath];

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
    return result.changes > 0;
  }

  // ================
  // Task Operations
  // ================

  createTask(projectPath: string, title: string, description?: string): { id: string; title: string } {
    const now = Date.now();
    const id = this.generateId();

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, project_path, title, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'todo', ?, ?)
    `);

    stmt.run(id, projectPath, title, description || null, now, now);
    return { id, title };
  }

  updateTask(taskId: string, updates: {
    title?: string;
    description?: string;
    status?: string;
  }): boolean {
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      params.push(updates.title);
    }

    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push(updates.description);
    }

    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);

      if (updates.status === 'done') {
        fields.push('completed_at = ?');
        params.push(Date.now());
      }
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(taskId);

    const stmt = this.db.prepare(`
      UPDATE tasks SET ${fields.join(', ')}
      WHERE id = ?
    `);

    const result = stmt.run(...params);
    return result.changes > 0;
  }

  listTasks(projectPath: string, status?: string): Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
  }> {
    let query = `
      SELECT id, title, description, status, created_at, updated_at, completed_at
      FROM tasks
      WHERE project_path = ?
    `;
    const params: any[] = [projectPath];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      created_at: number;
      updated_at: number;
      completed_at: number | null;
    }>;
  }

  getTask(taskId: string): {
    id: string;
    title: string;
    description: string | null;
    status: string;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
  } | null {
    const stmt = this.db.prepare(`
      SELECT id, title, description, status, created_at, updated_at, completed_at
      FROM tasks
      WHERE id = ?
    `);
    return stmt.get(taskId) as any;
  }

  completeTask(taskId: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = 'done', completed_at = ?, updated_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(now, now, taskId);
    return result.changes > 0;
  }

  deleteTask(taskId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM tasks WHERE id = ?`);
    const result = stmt.run(taskId);
    return result.changes > 0;
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
          const itemTags: string[] = JSON.parse(item.tags || '[]');

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
          const itemTags: string[] = JSON.parse(item.tags || '[]');

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
          const itemTags: string[] = JSON.parse(item.tags || '[]');

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
          sourceCheckpoint.git_status,
          sourceCheckpoint.git_branch,
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
