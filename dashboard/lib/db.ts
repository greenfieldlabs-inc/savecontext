import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import type {
  Session,
  SessionWithProjects,
  SessionWithAgents,
  AgentSession,
  AgentInfo,
  ContextItem,
  Checkpoint,
  SessionProject,
  SessionSummary,
  ProjectSummary,
  SessionProjectInfo,
  Stats,
  Memory,
  Issue,
  IssueStats,
  Plan
} from './types';

// Database connection singletons
let db: Database | null = null;
let writeDb: Database | null = null;

/**
 * Get database path - auto-detect or use config
 */
export function getDatabasePath(): string {
  // Default: ~/.savecontext/data/savecontext.db
  const defaultPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');

  // TODO: Add config file support for custom paths
  // For now, always use default
  return defaultPath;
}

/**
 * Get database connection (singleton)
 */
export function getDatabase(): Database {
  if (!db) {
    const dbPath = getDatabasePath();

    // Check if database exists (bun:sqlite doesn't have fileMustExist option)
    if (!existsSync(dbPath)) {
      throw new Error(
        `SaveContext database not found at ${dbPath}. ` +
        `Make sure the MCP server has been run at least once.`
      );
    }

    try {
      db = new Database(dbPath, { readonly: true });

      // Enable WAL mode for better concurrent reads
      db.exec('PRAGMA journal_mode = WAL');

    } catch (error) {
      throw new Error(
        `Failed to connect to savecontext database at ${dbPath}. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return db;
}

/**
 * Get writable database connection (singleton)
 * Use this for mutations (INSERT, UPDATE, DELETE)
 */
export function getWriteDatabase(): Database {
  if (!writeDb) {
    const dbPath = getDatabasePath();

    // Check if database exists (bun:sqlite doesn't have fileMustExist option)
    if (!existsSync(dbPath)) {
      throw new Error(
        `SaveContext database not found at ${dbPath}. ` +
        `Make sure the MCP server has been run at least once.`
      );
    }

    try {
      writeDb = new Database(dbPath);

      // Enable WAL mode for better concurrent access
      writeDb.exec('PRAGMA journal_mode = WAL');

    } catch (error) {
      throw new Error(
        `Failed to connect to savecontext database at ${dbPath}. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return writeDb;
}

/**
 * Close database connections
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
  if (writeDb) {
    writeDb.close();
    writeDb = null;
  }
}

// ==================
// Session Queries
// ==================

export function getAllSessions(): Session[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Session[];
}

/**
 * Get agents for a specific session
 */
export function getAgentsForSession(sessionId: string): AgentInfo[] {
  const db = getDatabase();
  const agents = db.prepare(
    'SELECT agent_id, provider, git_branch, last_active_at FROM agent_sessions WHERE session_id = ? ORDER BY last_active_at DESC'
  ).all(sessionId) as AgentInfo[];

  return agents;
}

/**
 * Enrich sessions with all their project paths and agent information
 */
function enrichSessionsWithProjectsAndAgents(sessions: Session[]): SessionWithAgents[] {
  const db = getDatabase();

  return sessions.map(session => {
    const allPaths = new Set<string>();

    // Add primary project path
    if (session.project_path) {
      allPaths.add(session.project_path);
    }

    // Add additional project paths from session_projects
    const additionalPaths = db.prepare(
      'SELECT project_path FROM session_projects WHERE session_id = ?'
    ).all(session.id) as Array<{ project_path: string }>;

    additionalPaths.forEach(({ project_path }) => allPaths.add(project_path));

    // Get agent information
    const agents = getAgentsForSession(session.id);

    return {
      ...session,
      all_project_paths: Array.from(allPaths),
      agents
    };
  });
}

/**
 * Enrich sessions with all their project paths (without agents)
 */
function enrichSessionsWithProjects(sessions: Session[]): SessionWithProjects[] {
  const db = getDatabase();

  return sessions.map(session => {
    const allPaths = new Set<string>();

    // Add primary project path
    if (session.project_path) {
      allPaths.add(session.project_path);
    }

    // Add additional project paths from session_projects
    const additionalPaths = db.prepare(
      'SELECT project_path FROM session_projects WHERE session_id = ?'
    ).all(session.id) as Array<{ project_path: string }>;

    additionalPaths.forEach(({ project_path }) => allPaths.add(project_path));

    return {
      ...session,
      all_project_paths: Array.from(allPaths)
    };
  });
}

export function getAllSessionsWithProjects(): SessionWithProjects[] {
  return enrichSessionsWithProjects(getAllSessions());
}

export function getAllSessionsWithAgents(): SessionWithAgents[] {
  return enrichSessionsWithProjectsAndAgents(getAllSessions());
}

export function getSessionsByProjectWithProjects(projectPath: string): SessionWithProjects[] {
  return enrichSessionsWithProjects(getSessionsByProject(projectPath));
}

export function getSessionsByProjectWithAgents(projectPath: string): SessionWithAgents[] {
  return enrichSessionsWithProjectsAndAgents(getSessionsByProject(projectPath));
}

export function getSessionById(id: string): Session | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | null;
}

export function getSessionsByProject(projectPath: string): Session[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT DISTINCT s.* FROM sessions s ' +
    'LEFT JOIN session_projects sp ON s.id = sp.session_id ' +
    'WHERE s.project_path = ? OR sp.project_path = ? ' +
    'ORDER BY s.updated_at DESC'
  ).all(projectPath, projectPath) as Session[];
}

export function getSessionsByStatus(status: 'active' | 'paused' | 'completed'): Session[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC'
  ).all(status) as Session[];
}

export function getSessionSummary(sessionId: string): SessionSummary | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM session_summary WHERE id = ?').get(sessionId) as SessionSummary | null;
}

// ==================
// Context Item Queries
// ==================

export function getContextItemsBySession(sessionId: string): ContextItem[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM context_items WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as ContextItem[];
}

export function getContextItemsByCategory(
  sessionId: string,
  category: 'reminder' | 'decision' | 'progress' | 'note'
): ContextItem[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM context_items WHERE session_id = ? AND category = ? ORDER BY created_at DESC'
  ).all(sessionId, category) as ContextItem[];
}

export function getHighPriorityItems(sessionId?: string): ContextItem[] {
  const db = getDatabase();
  if (sessionId) {
    return db.prepare(
      'SELECT * FROM context_items WHERE session_id = ? AND priority = "high" ORDER BY created_at DESC'
    ).all(sessionId) as ContextItem[];
  }
  return db.prepare(
    'SELECT * FROM context_items WHERE priority = "high" ORDER BY created_at DESC'
  ).all() as ContextItem[];
}

// ==================
// Context Item Write Methods
// ==================

/**
 * Update a context item by session and key
 */
export function updateContextItem(
  sessionId: string,
  key: string,
  updates: { value?: string; category?: string; priority?: string; channel?: string }
): number {
  const db = getWriteDatabase();
  const now = Date.now();

  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number)[] = [now];

  if (updates.value !== undefined) {
    setClauses.push('value = ?');
    values.push(updates.value);
    setClauses.push('size = ?');
    values.push(updates.value.length);
  }

  if (updates.category !== undefined) {
    setClauses.push('category = ?');
    values.push(updates.category);
  }

  if (updates.priority !== undefined) {
    setClauses.push('priority = ?');
    values.push(updates.priority);
  }

  if (updates.channel !== undefined) {
    setClauses.push('channel = ?');
    values.push(updates.channel);
  }

  values.push(sessionId, key);

  const result = db.prepare(
    `UPDATE context_items SET ${setClauses.join(', ')} WHERE session_id = ? AND key = ?`
  ).run(...values);

  return result.changes;
}

/**
 * Delete a context item by session and key
 */
export function deleteContextItem(sessionId: string, key: string): number {
  const db = getWriteDatabase();
  const result = db.prepare(
    'DELETE FROM context_items WHERE session_id = ? AND key = ?'
  ).run(sessionId, key);

  return result.changes;
}

// ==================
// Checkpoint Queries
// ==================

export function getAllCheckpoints(): Checkpoint[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM checkpoints ORDER BY created_at DESC').all() as Checkpoint[];
}

export function getCheckpointById(id: string): Checkpoint | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as Checkpoint | null;
}

export function getCheckpointsBySession(sessionId: string): Checkpoint[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as Checkpoint[];
}

export function searchCheckpoints(query: string): Checkpoint[] {
  const db = getDatabase();
  const searchTerm = `%${query}%`;
  return db.prepare(
    'SELECT * FROM checkpoints ' +
    'WHERE name LIKE ? OR description LIKE ? ' +
    'ORDER BY created_at DESC'
  ).all(searchTerm, searchTerm) as Checkpoint[];
}

export function getCheckpointItems(checkpointId: string): ContextItem[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT ci.* FROM context_items ci ' +
    'JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id ' +
    'WHERE cpi.checkpoint_id = ? ' +
    'ORDER BY ci.created_at DESC'
  ).all(checkpointId) as ContextItem[];
}

export function getCheckpointsByProject(projectPath: string): Checkpoint[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT DISTINCT c.* FROM checkpoints c ' +
    'JOIN sessions s ON c.session_id = s.id ' +
    'LEFT JOIN session_projects sp ON s.id = sp.session_id ' +
    'WHERE s.project_path = ? OR sp.project_path = ? ' +
    'ORDER BY c.created_at DESC'
  ).all(projectPath, projectPath) as Checkpoint[];
}

// ==================
// Project Queries
// ==================

export function getAllProjects(): ProjectSummary[] {
  const db = getDatabase();

  // Single query with all counts using subqueries
  const projects = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.description,
      p.project_path,
      p.created_at,
      p.updated_at,
      (SELECT COUNT(*) FROM sessions WHERE project_path = p.project_path) as session_count,
      (SELECT COUNT(*) FROM sessions WHERE project_path = p.project_path AND status = 'active') as active_sessions,
      (SELECT COUNT(*) FROM context_items ci
       WHERE ci.session_id IN (SELECT id FROM sessions WHERE project_path = p.project_path)) as total_items
    FROM projects p
    ORDER BY p.updated_at DESC
  `).all() as Array<{
    id: string;
    name: string;
    description: string | null;
    project_path: string;
    created_at: number;
    updated_at: number;
    session_count: number;
    active_sessions: number;
    total_items: number;
  }>;

  return projects.map(proj => ({
    id: proj.id,
    name: proj.name,
    description: proj.description,
    project_path: proj.project_path,
    session_count: proj.session_count,
    active_sessions: proj.active_sessions,
    total_items: proj.total_items,
    created_at: proj.created_at,
    updated_at: proj.updated_at,
  }));
}

export function getSessionProjects(sessionId: string): SessionProject[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM session_projects WHERE session_id = ? ORDER BY added_at DESC'
  ).all(sessionId) as SessionProject[];
}

// ==================
// Stats Queries
// ==================

export function getStats(): Stats {
  const db = getDatabase();

  const sessionStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM sessions
  `).get() as {
    total: number;
    active: number;
    paused: number;
    completed: number;
  };

  const itemCount = db.prepare('SELECT COUNT(*) as count FROM context_items').get() as { count: number };
  const checkpointCount = db.prepare('SELECT COUNT(*) as count FROM checkpoints').get() as { count: number };

  const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };

  const memoryCount = db.prepare('SELECT COUNT(*) as count FROM project_memory').get() as { count: number };

  const issueStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' OR status = 'in_progress' OR status = 'blocked' THEN 1 ELSE 0 END) as todo,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as done
    FROM issues
  `).get() as { total: number; todo: number | null; done: number | null };

  return {
    total_sessions: sessionStats.total || 0,
    active_sessions: sessionStats.active || 0,
    paused_sessions: sessionStats.paused || 0,
    completed_sessions: sessionStats.completed || 0,
    total_context_items: itemCount.count || 0,
    total_checkpoints: checkpointCount.count || 0,
    total_projects: projectCount.count || 0,
    total_memory_items: memoryCount.count || 0,
    total_tasks: issueStats.total || 0,
    tasks_todo: issueStats.todo || 0,
    tasks_done: issueStats.done || 0
  };
}

export function getSessionsOverTime(days: number = 30): Array<{ date: string; count: number }> {
  const db = getDatabase();
  const startTimestamp = Date.now() - (days * 24 * 60 * 60 * 1000);

  return db.prepare(`
    SELECT
      date(created_at / 1000, 'unixepoch') as date,
      COUNT(*) as count
    FROM sessions
    WHERE created_at >= ?
    GROUP BY date(created_at / 1000, 'unixepoch')
    ORDER BY date ASC
  `).all(startTimestamp) as Array<{ date: string; count: number }>;
}

export function getItemsByCategory(): Array<{ category: string; count: number }> {
  const db = getDatabase();
  return db.prepare(`
    SELECT category, COUNT(*) as count
    FROM context_items
    GROUP BY category
    ORDER BY count DESC
  `).all() as Array<{ category: string; count: number }>;
}

export function getItemsByPriority(): Array<{ priority: string; count: number }> {
  const db = getDatabase();
  return db.prepare(`
    SELECT priority, COUNT(*) as count
    FROM context_items
    GROUP BY priority
    ORDER BY
      CASE priority
        WHEN 'high' THEN 1
        WHEN 'normal' THEN 2
        WHEN 'low' THEN 3
      END
  `).all() as Array<{ priority: string; count: number }>;
}

// ==================
// Memory Queries
// ==================

export function getMemoryItems(projectPath?: string, category?: string): Memory[] {
  const db = getDatabase();

  if (projectPath && category) {
    return db.prepare(
      'SELECT * FROM project_memory WHERE project_path = ? AND category = ? ORDER BY created_at DESC'
    ).all(projectPath, category) as Memory[];
  }

  if (projectPath) {
    return db.prepare(
      'SELECT * FROM project_memory WHERE project_path = ? ORDER BY created_at DESC'
    ).all(projectPath) as Memory[];
  }

  if (category) {
    return db.prepare(
      'SELECT * FROM project_memory WHERE category = ? ORDER BY created_at DESC'
    ).all(category) as Memory[];
  }

  return db.prepare(
    'SELECT * FROM project_memory ORDER BY created_at DESC'
  ).all() as Memory[];
}

export function getMemoryByKey(projectPath: string, key: string): Memory | null {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM project_memory WHERE project_path = ? AND key = ?'
  ).get(projectPath, key) as Memory | null;
}

export function getMemoryCount(projectPath: string): number {
  const db = getDatabase();
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM project_memory WHERE project_path = ?'
  ).get(projectPath) as { count: number };
  return result.count;
}

export function deleteMemoryItem(projectPath: string, key: string): number {
  const db = getWriteDatabase();
  const result = db.prepare(
    'DELETE FROM project_memory WHERE project_path = ? AND key = ?'
  ).run(projectPath, key);
  return result.changes;
}

// ==================
// Issue Queries
// ==================

export function getIssues(
  projectPath?: string,
  status?: string,
  timeFilter?: { createdAfter?: number; updatedAfter?: number }
): Issue[] {
  const db = getDatabase();

  // Try issues table first, fall back to tasks table for old schema
  const tableName = tableExists(db, 'issues') ? 'issues' : 'tasks';

  // Check if issue_dependencies table exists for parent-child relationships
  const hasDependencies = tableExists(db, 'issue_dependencies');

  // Check if issue_projects table exists for multi-project support
  const hasIssueProjects = tableExists(db, 'issue_projects');

  // Build query with optional parent JOIN
  let baseQuery: string;
  if (hasDependencies) {
    baseQuery = `
      SELECT i.*,
        parent.id as parent_id,
        parent.short_id as parent_short_id,
        parent.title as parent_title
      FROM ${tableName} i
      LEFT JOIN issue_dependencies dep ON i.id = dep.issue_id AND dep.dependency_type = 'parent-child'
      LEFT JOIN ${tableName} parent ON dep.depends_on_id = parent.id
    `;
  } else {
    baseQuery = `SELECT * FROM ${tableName}`;
  }

  let whereClause = '';
  const params: (string | number)[] = [];

  // Multi-project support: find issues that belong to this project
  // either as their primary path OR via the issue_projects junction table
  if (projectPath) {
    if (hasIssueProjects && hasDependencies) {
      whereClause = 'WHERE (i.project_path = ? OR i.id IN (SELECT issue_id FROM issue_projects WHERE project_path = ?))';
      params.push(projectPath, projectPath);
    } else if (hasIssueProjects) {
      whereClause = 'WHERE (project_path = ? OR id IN (SELECT issue_id FROM issue_projects WHERE project_path = ?))';
      params.push(projectPath, projectPath);
    } else {
      whereClause = hasDependencies ? 'WHERE i.project_path = ?' : 'WHERE project_path = ?';
      params.push(projectPath);
    }
  }

  if (status) {
    const statusCondition = hasDependencies ? 'i.status = ?' : 'status = ?';
    whereClause = whereClause ? `${whereClause} AND ${statusCondition}` : `WHERE ${statusCondition}`;
    params.push(status);
  }

  // Time filters
  if (timeFilter?.createdAfter) {
    const createdCondition = hasDependencies ? 'i.created_at >= ?' : 'created_at >= ?';
    whereClause = whereClause ? `${whereClause} AND ${createdCondition}` : `WHERE ${createdCondition}`;
    params.push(timeFilter.createdAfter);
  }

  if (timeFilter?.updatedAfter) {
    const updatedCondition = hasDependencies ? 'i.updated_at >= ?' : 'updated_at >= ?';
    whereClause = whereClause ? `${whereClause} AND ${updatedCondition}` : `WHERE ${updatedCondition}`;
    params.push(timeFilter.updatedAfter);
  }

  const orderClause = hasDependencies ? 'ORDER BY i.created_at DESC' : 'ORDER BY created_at DESC';
  const query = `${baseQuery} ${whereClause} ${orderClause}`;

  const rows = db.prepare(query).all(...params) as Array<Issue & { parent_id?: string; parent_short_id?: string; parent_title?: string }>;

  // Transform rows to include parent object if present
  const issues = rows.map(row => {
    const { parent_id, parent_short_id, parent_title, ...issue } = row;
    if (parent_id) {
      return {
        ...issue,
        parent: {
          id: parent_id,
          short_id: parent_short_id || null,
          title: parent_title || ''
        }
      } as Issue;
    }
    return issue as Issue;
  });

  // Enrich issues with additional project paths (for UI display)
  if (hasIssueProjects && issues.length > 0) {
    const issueIds = issues.map(i => i.id);
    const placeholders = issueIds.map(() => '?').join(',');

    const additionalPaths = db.prepare(`
      SELECT issue_id, project_path
      FROM issue_projects
      WHERE issue_id IN (${placeholders})
      ORDER BY added_at
    `).all(...issueIds) as Array<{ issue_id: string; project_path: string }>;

    // Group paths by issue ID
    const pathsByIssue = new Map<string, string[]>();
    for (const row of additionalPaths) {
      if (!pathsByIssue.has(row.issue_id)) {
        pathsByIssue.set(row.issue_id, []);
      }
      pathsByIssue.get(row.issue_id)!.push(row.project_path);
    }

    // Attach additional_project_paths to each issue
    for (const issue of issues) {
      issue.additional_project_paths = pathsByIssue.get(issue.id) || [];
    }
  }

  // Enrich issues with labels
  if (issues.length > 0 && tableExists(db, 'issue_labels')) {
    const issueIds = issues.map(i => i.id);
    const placeholders = issueIds.map(() => '?').join(',');

    const labelRows = db.prepare(`
      SELECT issue_id, id, label
      FROM issue_labels
      WHERE issue_id IN (${placeholders})
      ORDER BY label
    `).all(...issueIds) as Array<{ issue_id: string; id: string; label: string }>;

    // Group labels by issue ID
    const labelsByIssue = new Map<string, Array<{ id: string; label: string }>>();
    for (const row of labelRows) {
      if (!labelsByIssue.has(row.issue_id)) {
        labelsByIssue.set(row.issue_id, []);
      }
      labelsByIssue.get(row.issue_id)!.push({ id: row.id, label: row.label });
    }

    // Attach labels to each issue
    for (const issue of issues) {
      issue.labels = labelsByIssue.get(issue.id) || [];
    }
  }

  return issues;
}

export function getIssueById(id: string): Issue | null {
  const db = getDatabase();
  const tableName = tableExists(db, 'issues') ? 'issues' : 'tasks';
  const hasDependencies = tableExists(db, 'issue_dependencies');

  let issue: Issue | null = null;

  if (hasDependencies) {
    const query = `
      SELECT i.*,
        parent.id as parent_id,
        parent.short_id as parent_short_id,
        parent.title as parent_title
      FROM ${tableName} i
      LEFT JOIN issue_dependencies dep ON i.id = dep.issue_id AND dep.dependency_type = 'parent-child'
      LEFT JOIN ${tableName} parent ON dep.depends_on_id = parent.id
      WHERE i.id = ?
    `;
    const row = db.prepare(query).get(id) as (Issue & { parent_id?: string; parent_short_id?: string; parent_title?: string }) | undefined;
    if (!row) return null;

    const { parent_id, parent_short_id, parent_title, ...issueData } = row;
    issue = issueData as Issue;
    if (parent_id) {
      issue.parent = {
        id: parent_id,
        short_id: parent_short_id || null,
        title: parent_title || ''
      };
    }

    // Load all dependencies (including duplicate-of)
    const deps = db.prepare(`
      SELECT d.id, d.depends_on_id, d.dependency_type,
        target.short_id as depends_on_short_id,
        target.title as depends_on_title
      FROM issue_dependencies d
      LEFT JOIN ${tableName} target ON d.depends_on_id = target.id
      WHERE d.issue_id = ?
    `).all(id) as Array<{
      id: string;
      depends_on_id: string;
      dependency_type: string;
      depends_on_short_id: string | null;
      depends_on_title: string | null;
    }>;

    issue.dependencies = deps.map(d => ({
      id: d.id,
      dependsOnId: d.depends_on_id,
      dependsOnShortId: d.depends_on_short_id,
      dependsOnTitle: d.depends_on_title || '',
      dependencyType: d.dependency_type as 'blocks' | 'related' | 'parent-child' | 'discovered-from' | 'duplicate-of'
    }));

    // Load labels
    if (tableExists(db, 'issue_labels')) {
      const labelRows = db.prepare(`
        SELECT id, label FROM issue_labels WHERE issue_id = ? ORDER BY label
      `).all(id) as Array<{ id: string; label: string }>;
      issue.labels = labelRows;
    }

    return issue;
  }

  // Fallback for old schema without dependencies
  const fallbackIssue = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id) as Issue | null;
  if (fallbackIssue && tableExists(db, 'issue_labels')) {
    const labelRows = db.prepare(`
      SELECT id, label FROM issue_labels WHERE issue_id = ? ORDER BY label
    `).all(id) as Array<{ id: string; label: string }>;
    fallbackIssue.labels = labelRows;
  }
  return fallbackIssue;
}

export function getIssueStats(projectPath?: string): IssueStats {
  const db = getDatabase();
  const tableName = tableExists(db, 'issues') ? 'issues' : 'tasks';

  // Note: "duplicate" is not a status - it's a relation type (duplicate-of dependency)
  const query = projectPath
    ? `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) as backlog,
        SUM(CASE WHEN status = 'open' OR status = 'todo' OR status = 'pending' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN status = 'closed' OR status = 'done' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN status = 'deferred' THEN 1 ELSE 0 END) as deferred
      FROM ${tableName}
      WHERE project_path = ?`
    : `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) as backlog,
        SUM(CASE WHEN status = 'open' OR status = 'todo' OR status = 'pending' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN status = 'closed' OR status = 'done' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN status = 'deferred' THEN 1 ELSE 0 END) as deferred
      FROM ${tableName}`;

  const result = projectPath
    ? db.prepare(query).get(projectPath) as { total: number; backlog: number; open: number; in_progress: number; blocked: number; closed: number; deferred: number }
    : db.prepare(query).get() as { total: number; backlog: number; open: number; in_progress: number; blocked: number; closed: number; deferred: number };

  return {
    total: result.total || 0,
    backlog: result.backlog || 0,
    open: result.open || 0,
    in_progress: result.in_progress || 0,
    blocked: result.blocked || 0,
    closed: result.closed || 0,
    deferred: result.deferred || 0,
    by_priority: {},
    by_type: {}
  };
}

// Legacy aliases for db-adapter compatibility
export const getTasks = getIssues;
export const getTaskById = getIssueById;
export const getTaskStats = (projectPath?: string) => {
  const stats = getIssueStats(projectPath);
  return { todo: stats.open, done: stats.closed, total: stats.total };
};

// Helper to check if a table exists
function tableExists(db: Database, tableName: string): boolean {
  const result = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName);
  return !!result;
}

// ==================
// Plan Queries
// ==================

export function getPlans(projectPath?: string, status?: string): Plan[] {
  const db = getDatabase();

  let query = 'SELECT * FROM plans';
  const params: string[] = [];
  const conditions: string[] = [];

  if (projectPath) {
    conditions.push('project_path = ?');
    params.push(projectPath);
  }

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY updated_at DESC';

  const plans = db.prepare(query).all(...params) as Plan[];

  if (plans.length === 0) return [];

  // Get all issues for each plan (both epics and non-epics)
  const allIssues = db.prepare(`
    SELECT id, short_id, plan_id, title, status, priority, issue_type
    FROM issues
    WHERE plan_id IN (${plans.map(() => '?').join(',')})
  `).all(...plans.map(p => p.id)) as { id: string; short_id: string; plan_id: string; title: string; status: string; priority: number; issue_type: string }[];

  // Group issues by plan_id and type
  const epicsByPlan = new Map<string, typeof allIssues>();
  const issuesByPlan = new Map<string, typeof allIssues>();

  for (const issue of allIssues) {
    if (issue.issue_type === 'epic') {
      const existing = epicsByPlan.get(issue.plan_id) || [];
      existing.push(issue);
      epicsByPlan.set(issue.plan_id, existing);
    } else {
      const existing = issuesByPlan.get(issue.plan_id) || [];
      existing.push(issue);
      issuesByPlan.set(issue.plan_id, existing);
    }
  }

  return plans.map(p => {
    const planEpics = epicsByPlan.get(p.id) || [];
    const planIssues = issuesByPlan.get(p.id) || [];

    return {
      ...p,
      epics: planEpics.map(e => ({
        id: e.id,
        short_id: e.short_id,
        title: e.title,
        status: e.status,
        priority: e.priority,
        issue_type: e.issue_type
      })),
      epic_count: planEpics.length,
      linked_issues: planIssues.map(i => ({
        id: i.id,
        short_id: i.short_id,
        title: i.title,
        status: i.status,
        priority: i.priority,
        issue_type: i.issue_type
      })),
      linked_issue_count: planIssues.length,
      linked_issue_completed_count: planIssues.filter(i => i.status === 'closed').length
    };
  });
}

export function getPlanById(id: string): Plan | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Plan | null;
}

export function getPlanStats(projectPath?: string): { total: number; draft: number; active: number; completed: number } {
  const db = getDatabase();

  if (projectPath) {
    const result = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM plans
      WHERE project_path = ?
    `).get(projectPath) as { total: number; draft: number; active: number; completed: number };
    return result;
  }

  const result = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM plans
  `).get() as { total: number; draft: number; active: number; completed: number };
  return result;
}

// ==================
// Session Write Operations
// ==================

/**
 * Update session name and/or description
 */
export function updateSession(id: string, updates: { name?: string; description?: string }): number {
  const db = getWriteDatabase();
  const now = Date.now();

  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number)[] = [now];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }

  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    values.push(updates.description);
  }

  values.push(id);
  const result = db.prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  return result.changes;
}

/**
 * Update session status
 */
export function updateSessionStatus(id: string, status: 'active' | 'paused' | 'completed'): number {
  const db = getWriteDatabase();
  const now = Date.now();

  // Set ended_at when transitioning away from active, clear when reactivating
  const endedAt = status === 'active' ? null : now;

  const result = db.prepare(
    'UPDATE sessions SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?'
  ).run(status, endedAt, now, id);

  return result.changes;
}

/**
 * Delete a session and all related data
 */
export function deleteSession(id: string): { sessionDeleted: number; itemsDeleted: number; checkpointsDeleted: number } {
  const db = getWriteDatabase();

  // Get checkpoint IDs first
  const checkpointIds = db.prepare('SELECT id FROM checkpoints WHERE session_id = ?').all(id) as Array<{ id: string }>;

  // Delete checkpoint_items for all checkpoints
  let itemsDeleted = 0;
  for (const { id: checkpointId } of checkpointIds) {
    const result = db.prepare('DELETE FROM checkpoint_items WHERE checkpoint_id = ?').run(checkpointId);
    itemsDeleted += result.changes;
  }

  // Delete checkpoints
  const checkpointsResult = db.prepare('DELETE FROM checkpoints WHERE session_id = ?').run(id);

  // Delete context items
  const contextResult = db.prepare('DELETE FROM context_items WHERE session_id = ?').run(id);
  itemsDeleted += contextResult.changes;

  // Delete session_projects
  db.prepare('DELETE FROM session_projects WHERE session_id = ?').run(id);

  // Delete agent_sessions
  db.prepare('DELETE FROM agent_sessions WHERE session_id = ?').run(id);

  // Delete session
  const sessionResult = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

  return {
    sessionDeleted: sessionResult.changes,
    itemsDeleted,
    checkpointsDeleted: checkpointsResult.changes
  };
}

/**
 * Get session stats for delete confirmation dialog
 */
export function getSessionStats(sessionId: string): { contextItems: number; checkpoints: number; tasks: number; memory: number } {
  const db = getDatabase();

  const contextItems = db.prepare(
    'SELECT COUNT(*) as count FROM context_items WHERE session_id = ?'
  ).get(sessionId) as { count: number };

  const checkpoints = db.prepare(
    'SELECT COUNT(*) as count FROM checkpoints WHERE session_id = ?'
  ).get(sessionId) as { count: number };

  // Tasks and memory are tied to project, not session - return 0 for now
  return {
    contextItems: contextItems.count,
    checkpoints: checkpoints.count,
    tasks: 0,
    memory: 0
  };
}

// ==================
// Session-Project Write Operations
// ==================

/**
 * Get session projects with info for the UI
 */
export function getSessionProjectsInfo(sessionId: string): SessionProjectInfo[] {
  const db = getDatabase();

  // Get the session to find primary project
  const session = db.prepare('SELECT project_path FROM sessions WHERE id = ?').get(sessionId) as { project_path: string | null } | undefined;
  const primaryPath = session?.project_path;

  // Get all paths (primary + additional)
  const allPaths = new Set<string>();
  if (primaryPath) {
    allPaths.add(primaryPath);
  }

  const additionalPaths = db.prepare(
    'SELECT project_path FROM session_projects WHERE session_id = ?'
  ).all(sessionId) as Array<{ project_path: string }>;

  additionalPaths.forEach(({ project_path }) => allPaths.add(project_path));

  // Get project info for each path
  const results: SessionProjectInfo[] = [];
  for (const path of allPaths) {
    const project = db.prepare(
      'SELECT id, name, project_path FROM projects WHERE project_path = ?'
    ).get(path) as { id: string; name: string; project_path: string } | undefined;

    if (project) {
      results.push({
        id: project.id,
        name: project.name,
        sourcePath: project.project_path,
        isPrimary: path === primaryPath
      });
    }
  }

  return results;
}

/**
 * Add a project path to a session
 */
export function addSessionProject(sessionId: string, projectPath: string): void {
  const db = getWriteDatabase();
  const now = Date.now();

  // Check if already exists
  const existing = db.prepare(
    'SELECT 1 FROM session_projects WHERE session_id = ? AND project_path = ?'
  ).get(sessionId, projectPath);

  if (!existing) {
    db.prepare(
      'INSERT INTO session_projects (session_id, project_path, added_at) VALUES (?, ?, ?)'
    ).run(sessionId, projectPath, now);
  }

  // Update session updated_at
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
}

/**
 * Remove a project path from a session
 */
export function removeSessionProject(sessionId: string, projectPath: string): void {
  const db = getWriteDatabase();
  const now = Date.now();

  // Delete from session_projects
  db.prepare('DELETE FROM session_projects WHERE session_id = ? AND project_path = ?').run(sessionId, projectPath);

  // If this was the primary project, clear it
  const session = db.prepare('SELECT project_path FROM sessions WHERE id = ?').get(sessionId) as { project_path: string | null } | undefined;
  if (session?.project_path === projectPath) {
    db.prepare('UPDATE sessions SET project_path = NULL, updated_at = ? WHERE id = ?').run(now, sessionId);
  } else {
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
  }
}

/**
 * Set the primary project for a session
 */
export function setSessionPrimaryProject(sessionId: string, projectPath: string): void {
  const db = getWriteDatabase();
  const now = Date.now();

  // Update the session's primary project_path
  db.prepare('UPDATE sessions SET project_path = ?, updated_at = ? WHERE id = ?').run(projectPath, now, sessionId);

  // Also ensure it's in session_projects
  const existing = db.prepare(
    'SELECT 1 FROM session_projects WHERE session_id = ? AND project_path = ?'
  ).get(sessionId, projectPath);

  if (!existing) {
    db.prepare(
      'INSERT INTO session_projects (session_id, project_path, added_at) VALUES (?, ?, ?)'
    ).run(sessionId, projectPath, now);
  }
}

// ==================
// Issue-Project Write Operations
// ==================

/**
 * Add an additional project path to an issue (multi-project support)
 */
export function addIssueProject(issueId: string, projectPath: string): void {
  const db = getWriteDatabase();
  const now = Date.now();

  // Check if already exists
  const existing = db.prepare(
    'SELECT 1 FROM issue_projects WHERE issue_id = ? AND project_path = ?'
  ).get(issueId, projectPath);

  if (!existing) {
    db.prepare(
      'INSERT INTO issue_projects (issue_id, project_path, added_at) VALUES (?, ?, ?)'
    ).run(issueId, projectPath, now);
  }

  // Update issue updated_at
  db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
}

/**
 * Remove an additional project path from an issue
 */
export function removeIssueProject(issueId: string, projectPath: string): void {
  const db = getWriteDatabase();
  const now = Date.now();

  // Delete from issue_projects (only removes from junction table, not primary)
  db.prepare('DELETE FROM issue_projects WHERE issue_id = ? AND project_path = ?').run(issueId, projectPath);

  // Update issue updated_at
  db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
}

// ==================
// Project Write Operations
// ==================

/**
 * Delete a project by ID.
 * SAFE: Only deletes the project record. Does NOT cascade delete sessions/items.
 * Sessions with this exact project_path will have it cleared (not deleted).
 * Child project paths (e.g., /parent/child) are NOT affected.
 */
export function deleteProject(projectId: string): {
  projectDeleted: boolean;
  sessionsUnlinked: number;
  sessionProjectsRemoved: number;
  issueProjectsRemoved: number;
} {
  const db = getWriteDatabase();

  // Get the project path before deletion
  const project = db.prepare('SELECT project_path FROM projects WHERE id = ?').get(projectId) as { project_path: string } | undefined;

  if (!project) {
    return { projectDeleted: false, sessionsUnlinked: 0, sessionProjectsRemoved: 0, issueProjectsRemoved: 0 };
  }

  const projectPath = project.project_path;

  // Clear project_path from sessions that have this exact path as primary
  // (Does NOT delete sessions, just unlinks them from this project)
  const sessionsResult = db.prepare(
    'UPDATE sessions SET project_path = NULL WHERE project_path = ?'
  ).run(projectPath);

  // Remove from session_projects junction table (exact path match only)
  const sessionProjectsResult = db.prepare(
    'DELETE FROM session_projects WHERE project_path = ?'
  ).run(projectPath);

  // Remove from issue_projects junction table (exact path match only)
  const issueProjectsResult = db.prepare(
    'DELETE FROM issue_projects WHERE project_path = ?'
  ).run(projectPath);

  // Delete the project record itself
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

  return {
    projectDeleted: true,
    sessionsUnlinked: sessionsResult.changes,
    sessionProjectsRemoved: sessionProjectsResult.changes,
    issueProjectsRemoved: issueProjectsResult.changes
  };
}

export function getProjectBlockers(projectId: string): {
  plans: Array<{ id: string; short_id: string | null; title: string }>;
} {
  const db = getDatabase();

  const plans = db.prepare(`
    SELECT id, short_id, title FROM plans WHERE project_id = ?
  `).all(projectId) as Array<{ id: string; short_id: string | null; title: string }>;

  return { plans };
}

// ==================
// Label Queries
// ==================

export interface LabelInfo {
  label: string;
  count: number;
}

/**
 * Get all unique labels with usage counts
 * Optionally filter by project or search term
 */
export function getAllLabels(projectPath?: string, search?: string): LabelInfo[] {
  const db = getDatabase();

  let query: string;
  const params: string[] = [];

  if (projectPath) {
    query = `
      SELECT il.label, COUNT(*) as count
      FROM issue_labels il
      JOIN issues i ON il.issue_id = i.id
      WHERE i.project_path = ?
    `;
    params.push(projectPath);

    if (search) {
      query += ` AND il.label LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY il.label ORDER BY count DESC, il.label ASC`;
  } else {
    query = `
      SELECT label, COUNT(*) as count
      FROM issue_labels
    `;

    if (search) {
      query += ` WHERE label LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY label ORDER BY count DESC, label ASC`;
  }

  return db.prepare(query).all(...params) as LabelInfo[];
}

/**
 * Get labels for a specific issue
 */
export function getIssueLabels(issueId: string): string[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT label FROM issue_labels WHERE issue_id = ? ORDER BY label'
  ).all(issueId) as Array<{ label: string }>;

  return rows.map(r => r.label);
}

/**
 * Add labels to an issue
 */
export function addIssueLabels(issueId: string, labels: string[]): number {
  const db = getWriteDatabase();
  const now = Date.now();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO issue_labels (id, issue_id, label)
    VALUES (?, ?, ?)
  `);

  let added = 0;
  for (const label of labels) {
    const trimmed = label.trim();
    if (trimmed) {
      const id = crypto.randomUUID();
      const result = insertStmt.run(id, issueId, trimmed);
      added += result.changes;
    }
  }

  // Update issue's updated_at
  db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);

  return added;
}

/**
 * Remove labels from an issue
 */
export function removeIssueLabels(issueId: string, labels: string[]): number {
  const db = getWriteDatabase();
  const now = Date.now();

  const deleteStmt = db.prepare(
    'DELETE FROM issue_labels WHERE issue_id = ? AND label = ?'
  );

  let removed = 0;
  for (const label of labels) {
    const result = deleteStmt.run(issueId, label.trim());
    removed += result.changes;
  }

  // Update issue's updated_at
  db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);

  return removed;
}

/**
 * Set labels for an issue (replace all existing labels)
 */
export function setIssueLabels(issueId: string, labels: string[]): void {
  const db = getWriteDatabase();
  const now = Date.now();

  // Remove all existing labels
  db.prepare('DELETE FROM issue_labels WHERE issue_id = ?').run(issueId);

  // Add new labels
  const insertStmt = db.prepare(`
    INSERT INTO issue_labels (id, issue_id, label)
    VALUES (?, ?, ?)
  `);

  for (const label of labels) {
    const trimmed = label.trim();
    if (trimmed) {
      const id = crypto.randomUUID();
      insertStmt.run(id, issueId, trimmed);
    }
  }

  // Update issue's updated_at
  db.prepare('UPDATE issues SET updated_at = ? WHERE id = ?').run(now, issueId);
}
