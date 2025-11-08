#!/usr/bin/env node

/**
 * SaveContext MCP Server
 * Cloud-first context management with AI processing
 * Built clean from scratch, learned from Memory Keeper
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { DatabaseManager } from './database/index.js';
import { deriveDefaultChannel, normalizeChannel } from './utils/channels.js';
import { getCurrentBranch, getGitStatus, formatGitStatus } from './utils/git.js';
import { getCurrentProjectPath, normalizeProjectPath } from './utils/project.js';
import {
  validateCreateSession,
  validateSaveContext,
  validateGetContext,
  validateCreateCheckpoint,
  validateRestoreCheckpoint,
} from './utils/validation.js';
import {
  SessionError,
  SaveContextError,
  ValidationError,
  DatabaseError,
  ToolResponse,
  SaveContextResponse,
  GetContextResponse,
  CheckpointResponse,
  SessionResponse,
  SessionStatus,
} from './types/index.js';

// Initialize database
const db = new DatabaseManager();

// Track current session
let currentSessionId: string | null = null;

// Track MCP client information (from initialization handshake)
// Future-proof: Supports per-connection tracking for SSE/HTTP transports
interface ClientInfo {
  name: string;
  version: string;
  provider: string;  // Normalized provider name
  connectedAt: number;
}

interface ConnectionState {
  clientInfo: ClientInfo;
  sessionId: string | null;
}

// Connection tracking
// STDIO: One connection per process (currentConnectionId is always the same)
// SSE/HTTP: Multiple connections (would need request context to lookup)
const connections = new Map<string, ConnectionState>();
let currentConnectionId: string | null = null;

// Initialize MCP server
const server = new Server(
  {
    name: 'savecontext',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ====================
// Helper Functions
// ====================

/**
 * Normalize MCP client name to provider identifier
 * Maps known client names to consistent provider strings
 */
function normalizeClientName(clientName: string): string {
  const name = (clientName || 'unknown').toLowerCase();

  // Map known MCP clients to provider names
  if (name.includes('claude') && name.includes('code')) return 'claude-code';
  if (name.includes('factory')) return 'factory-ai';
  if (name.includes('cursor')) return 'cursor';
  if (name.includes('cline')) return 'cline';
  if (name.includes('codex')) return 'codex-cli';
  if (name.includes('windsurf')) return 'windsurf';
  // @DEV -- Add additional mappings as needed

  // Return sanitized name for unknown clients
  return name.replace(/\s+/g, '-');
}

/**
 * Generate agent ID from project path, git branch, and provider
 * Format: "${projectName}-${branch}-${provider}"
 * Can be overridden via SAVECONTEXT_AGENT_ID env var
 */
function getAgentId(projectPath: string, branch: string, provider: string): string {
  // Allow manual override for power users
  if (process.env.SAVECONTEXT_AGENT_ID) {
    return process.env.SAVECONTEXT_AGENT_ID;
  }

  const projectName = projectPath.split('/').pop() || 'unknown';
  const safeBranch = branch || 'main';
  const safeProvider = provider || 'unknown';

  return `${projectName}-${safeBranch}-${safeProvider}`;
}

/**
 * Get the current provider from the active connection
 * STDIO: Always returns the single connected client's provider
 * SSE/HTTP: Would need request context to determine which connection
 */
function getCurrentProvider(): string {
  if (!currentConnectionId) {
    return 'unknown';
  }
  const connection = connections.get(currentConnectionId);
  return connection?.clientInfo.provider || 'unknown';
}

/**
 * Get the current client info from the active connection
 */
function getCurrentClientInfo(): ClientInfo {
  if (!currentConnectionId) {
    return { name: 'unknown', version: '0.0.0', provider: 'unknown', connectedAt: Date.now() };
  }
  const connection = connections.get(currentConnectionId);
  return connection?.clientInfo || { name: 'unknown', version: '0.0.0', provider: 'unknown', connectedAt: Date.now() };
}

/**
 * Update agent activity timestamp for current session
 * Call this on every operation to keep agent last_active_at current
 */
async function updateAgentActivity() {
  if (!currentSessionId) {
    return; // No active session, nothing to update
  }

  try {
    const session = db.getSession(currentSessionId);
    if (!session) return;

    const branch = await getCurrentBranch();
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const provider = getCurrentProvider();
    const agentId = getAgentId(projectPath, branch || 'main', provider);

    // Update agent's last_active_at timestamp
    db.setCurrentSessionForAgent(agentId, currentSessionId, projectPath, branch || 'main', provider);
  } catch (err) {
    // Silently fail - don't break operations if activity update fails
    console.error('Failed to update agent activity:', err);
  }
}

/**
 * Ensure we have an active session
 */
function ensureSession(): string {
  if (!currentSessionId) {
    throw new SessionError('No active session. Use context_session_start first.');
  }
  return currentSessionId;
}

/**
 * Create tool response
 */
function success<T>(data: T, message?: string): ToolResponse<T> {
  return {
    success: true,
    data,
    message,
  };
}

function error(message: string, err?: any): ToolResponse {
  return {
    success: false,
    error: message,
    message: err instanceof Error ? err.message : String(err),
  };
}

// ====================
// Tool Handlers
// ====================

/**
 * Start a new session or continue an existing one
 * Auto-detects project path and checks for existing active sessions
 */
async function handleSessionStart(args: any) {
  try {
    const validated = validateCreateSession(args);

    // Try to get git branch
    const branch = await getCurrentBranch();

    // Get or derive project path
    const projectPath = validated.project_path
      ? normalizeProjectPath(validated.project_path)
      : normalizeProjectPath(getCurrentProjectPath());

    // Generate agent ID for this project + branch + provider combination
    const provider = getCurrentProvider();
    const agentId = getAgentId(projectPath, branch || 'main', provider);

    // Check if THIS agent already has a current session
    const agentSession = db.getCurrentSessionForAgent(agentId);

    if (agentSession) {
      // Agent already has a current session - resume it
      // Check if current path is already in the session
      const sessionPaths = db.getSessionPaths(agentSession.id);
      const pathAlreadyExists = sessionPaths.includes(projectPath);

      // If current path not in session, add it (multi-path support)
      if (!pathAlreadyExists) {
        db.addProjectPath(agentSession.id, projectPath);
      }

      // Update agent's last active time and provider
      db.setCurrentSessionForAgent(agentId, agentSession.id, projectPath, branch || 'main', provider);

      // Set as current session in memory
      currentSessionId = agentSession.id;
      const stats = db.getSessionStats(agentSession.id);

      return success(
        {
          id: agentSession.id,
          name: agentSession.name,
          channel: agentSession.channel,
          project_paths: db.getSessionPaths(agentSession.id),
          status: agentSession.status,
          item_count: stats?.total_items || 0,
          created_at: agentSession.created_at,
          resumed: true,
          path_added: !pathAlreadyExists,
          agent_id: agentId,
          provider,
        },
        pathAlreadyExists
          ? `Resumed session '${agentSession.name}' for agent '${agentId}' (${stats?.total_items || 0} items)`
          : `Resumed session '${agentSession.name}' and added path '${projectPath}' (${stats?.total_items || 0} items)`
      );
    }

    // No existing session for this agent - create new one
    // Derive channel from branch or name
    const channel = normalizeChannel(
      validated.channel || deriveDefaultChannel(branch || undefined, validated.name)
    );

    // Create new session
    const session = db.createSession({
      name: validated.name,
      description: validated.description,
      branch: branch || undefined,
      channel,
      project_path: projectPath,
      status: 'active',
    });

    // Register session for this agent
    db.setCurrentSessionForAgent(agentId, session.id, projectPath, branch || 'main', provider);

    // Set as current session in memory
    currentSessionId = session.id;

    const response: SessionResponse = {
      id: session.id,
      name: session.name,
      channel: session.channel,
      project_path: session.project_path,
      status: session.status,
      created_at: session.created_at,
      agent_id: agentId,
      provider,
    };

    return success(
      response,
      `Session '${session.name}' started for agent '${agentId}' (channel: ${session.channel}, provider: ${provider})`
    );
  } catch (err) {
    return error('Failed to start session', err);
  }
}

/**
 * Save context to current session
 */
async function handleSaveContext(args: any) {
  try {
    const sessionId = ensureSession();
    const validated = validateSaveContext(args);

    // Get session to use its default channel if not specified
    const session = db.getSession(sessionId);
    if (!session) {
      throw new SessionError('Current session not found');
    }

    const channel = validated.channel || session.channel;

    // Save context item
    const item = db.saveContextItem({
      session_id: sessionId,
      key: validated.key,
      value: validated.value,
      category: validated.category || 'note',
      priority: validated.priority || 'normal',
      channel: normalizeChannel(channel),
      size: validated.key.length + validated.value.length,
    });

    // Update agent activity timestamp
    await updateAgentActivity();

    const response: SaveContextResponse = {
      id: item.id,
      key: item.key,
      session_id: item.session_id,
      created_at: item.created_at,
    };

    return success(response, `Saved '${item.key}' to ${channel} channel`);
  } catch (err) {
    return error('Failed to save context', err);
  }
}

/**
 * Get context from current session
 */
async function handleGetContext(args: any) {
  try {
    const sessionId = ensureSession();
    const validated = validateGetContext(args);

    // If key is provided, get single item
    if (validated.key) {
      const item = db.getContextItem(sessionId, validated.key);
      if (!item) {
        return success(
          { items: [], total: 0, session_id: sessionId },
          `No item found with key '${validated.key}'`
        );
      }

      const response: GetContextResponse = {
        items: [item],
        total: 1,
        session_id: sessionId,
      };

      return success(response);
    }

    // Otherwise, get filtered items
    const items = db.getContextItems(sessionId, {
      category: validated.category,
      priority: validated.priority,
      channel: validated.channel,
      limit: validated.limit || 100,
      offset: validated.offset || 0,
    });

    const response: GetContextResponse = {
      items,
      total: items.length,
      session_id: sessionId,
    };

    return success(response, `Found ${items.length} items`);
  } catch (err) {
    return error('Failed to get context', err);
  }
}

/**
 * Delete context item from current session
 */
async function handleDeleteContext(args: any) {
  try {
    const sessionId = ensureSession();

    if (!args?.key) {
      throw new ValidationError('key is required');
    }

    const deleted = db.deleteContextItem(sessionId, args.key);

    if (!deleted) {
      return success(
        { deleted: false, key: args.key },
        `No item found with key '${args.key}'`
      );
    }

    // Update agent activity timestamp
    await updateAgentActivity();

    return success(
      { deleted: true, key: args.key, session_id: sessionId },
      `Deleted context item '${args.key}'`
    );
  } catch (err) {
    return error('Failed to delete context', err);
  }
}

/**
 * Update existing context item
 */
async function handleUpdateContext(args: any) {
  try {
    const sessionId = ensureSession();

    if (!args?.key) {
      throw new ValidationError('key is required');
    }

    // Build updates object
    const updates: any = {};
    if (args.value !== undefined) updates.value = args.value;
    if (args.category !== undefined) updates.category = args.category;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.channel !== undefined) updates.channel = normalizeChannel(args.channel);

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('At least one field to update is required (value, category, priority, or channel)');
    }

    const updated = db.updateContextItem(sessionId, args.key, updates);

    if (!updated) {
      return success(
        { updated: false, key: args.key },
        `No item found with key '${args.key}'`
      );
    }

    // Update agent activity timestamp
    await updateAgentActivity();

    return success(
      {
        updated: true,
        key: updated.key,
        value: updated.value,
        category: updated.category,
        priority: updated.priority,
        channel: updated.channel,
        updated_at: updated.updated_at,
      },
      `Updated context item '${args.key}'`
    );
  } catch (err) {
    return error('Failed to update context', err);
  }
}

/**
 * Save project memory (command, config, or note)
 */
async function handleMemorySave(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());

    if (!args?.key) {
      throw new ValidationError('key is required');
    }

    if (!args?.value) {
      throw new ValidationError('value is required');
    }

    const category = args.category || 'command';
    if (!['command', 'config', 'note'].includes(category)) {
      throw new ValidationError('category must be command, config, or note');
    }

    const result = db.saveMemory(projectPath, args.key, args.value, category);

    return success(
      {
        key: result.key,
        value: args.value,
        category,
        project_path: projectPath,
      },
      `Saved memory '${args.key}' to project`
    );
  } catch (err) {
    return error('Failed to save memory', err);
  }
}

/**
 * Get project memory by key
 */
async function handleMemoryGet(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());

    if (!args?.key) {
      throw new ValidationError('key is required');
    }

    const memory = db.getMemory(projectPath, args.key);

    if (!memory) {
      return success(
        { found: false, key: args.key },
        `No memory found with key '${args.key}'`
      );
    }

    return success(
      {
        found: true,
        key: memory.key,
        value: memory.value,
        category: memory.category,
      },
      `Retrieved memory '${args.key}'`
    );
  } catch (err) {
    return error('Failed to get memory', err);
  }
}

/**
 * List all project memory
 */
async function handleMemoryList(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const category = args?.category;

    const memories = db.listMemory(projectPath, category);

    return success(
      {
        items: memories,
        count: memories.length,
        project_path: projectPath,
      },
      `Found ${memories.length} memory items`
    );
  } catch (err) {
    return error('Failed to list memory', err);
  }
}

/**
 * Delete project memory by key
 */
async function handleMemoryDelete(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());

    if (!args?.key) {
      throw new ValidationError('key is required');
    }

    const deleted = db.deleteMemory(projectPath, args.key);

    if (!deleted) {
      return success(
        { deleted: false, key: args.key },
        `No memory found with key '${args.key}'`
      );
    }

    return success(
      { deleted: true, key: args.key },
      `Deleted memory '${args.key}'`
    );
  } catch (err) {
    return error('Failed to delete memory', err);
  }
}

/**
 * Create a new task
 */
async function handleTaskCreate(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());

    if (!args?.title) {
      throw new ValidationError('title is required');
    }

    const result = db.createTask(projectPath, args.title, args.description);

    return success(
      {
        id: result.id,
        title: result.title,
        description: args.description || null,
        status: 'todo',
        project_path: projectPath,
      },
      `Created task '${args.title}'`
    );
  } catch (err) {
    return error('Failed to create task', err);
  }
}

/**
 * Update an existing task
 */
async function handleTaskUpdate(args: any) {
  try {
    if (!args?.id) {
      throw new ValidationError('id is required');
    }

    const updates: any = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.status !== undefined) {
      if (!['todo', 'done'].includes(args.status)) {
        throw new ValidationError('status must be todo or done');
      }
      updates.status = args.status;
    }

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('At least one field to update is required (title, description, or status)');
    }

    const updated = db.updateTask(args.id, updates);

    if (!updated) {
      return success(
        { updated: false, id: args.id },
        `No task found with id '${args.id}'`
      );
    }

    return success(
      { updated: true, id: args.id, ...updates },
      `Updated task '${args.id}'`
    );
  } catch (err) {
    return error('Failed to update task', err);
  }
}

/**
 * List tasks for current project
 */
async function handleTaskList(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const status = args?.status;

    if (status && !['todo', 'done'].includes(status)) {
      throw new ValidationError('status must be todo or done');
    }

    const tasks = db.listTasks(projectPath, status);

    return success(
      {
        tasks,
        count: tasks.length,
        project_path: projectPath,
      },
      `Found ${tasks.length} tasks`
    );
  } catch (err) {
    return error('Failed to list tasks', err);
  }
}

/**
 * Mark a task as complete
 */
async function handleTaskComplete(args: any) {
  try {
    if (!args?.id) {
      throw new ValidationError('id is required');
    }

    const completed = db.completeTask(args.id);

    if (!completed) {
      return success(
        { completed: false, id: args.id },
        `No task found with id '${args.id}'`
      );
    }

    return success(
      { completed: true, id: args.id, status: 'done' },
      `Marked task '${args.id}' as done`
    );
  } catch (err) {
    return error('Failed to complete task', err);
  }
}

/**
 * Create checkpoint of current session state
 */
async function handleCreateCheckpoint(args: any) {
  try {
    const sessionId = ensureSession();
    const validated = validateCreateCheckpoint(args);

    let git_status: string | undefined;
    let git_branch: string | undefined;

    // Get git info if requested
    if (validated.include_git) {
      const status = await getGitStatus();
      if (status) {
        git_status = formatGitStatus(status);
        git_branch = status.branch || undefined;
      }
    }

    // Create checkpoint
    const checkpoint = db.createCheckpoint({
      session_id: sessionId,
      name: validated.name,
      description: validated.description,
      git_status,
      git_branch,
    });

    // Update agent activity timestamp
    await updateAgentActivity();

    const response: CheckpointResponse = {
      id: checkpoint.id,
      name: checkpoint.name,
      session_id: checkpoint.session_id,
      item_count: checkpoint.item_count,
      total_size: checkpoint.total_size,
      created_at: checkpoint.created_at,
    };

    return success(
      response,
      `Checkpoint '${checkpoint.name}' created with ${checkpoint.item_count} items`
    );
  } catch (err) {
    return error('Failed to create checkpoint', err);
  }
}

/**
 * Prepare for context compaction with smart analysis
 * Creates checkpoint + analyzes priority items + generates summary
 */
async function handlePrepareCompaction() {
  try {
    const sessionId = ensureSession();

    // Generate auto-checkpoint name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const checkpointName = `pre-compact-${timestamp}`;

    // Get git info
    const status = await getGitStatus();
    let git_status: string | undefined;
    let git_branch: string | undefined;

    if (status) {
      git_status = formatGitStatus(status);
      git_branch = status.branch || undefined;
    }

    // Create checkpoint
    const checkpoint = db.createCheckpoint({
      session_id: sessionId,
      name: checkpointName,
      description: 'Automatic checkpoint before context compaction',
      git_status,
      git_branch,
    });

    // Analyze critical context
    const highPriorityItems = db.getContextItems(sessionId, {
      priority: 'high',
      limit: 50,
    });

    const tasks = db.getContextItems(sessionId, {
      category: 'task',
      limit: 20,
    });

    const decisions = db.getContextItems(sessionId, {
      category: 'decision',
      limit: 20,
    });

    const progress = db.getContextItems(sessionId, {
      category: 'progress',
      limit: 10,
    });

    // Identify unfinished tasks
    const nextSteps = tasks.filter(
      (t) =>
        !t.value.toLowerCase().includes('completed') &&
        !t.value.toLowerCase().includes('done') &&
        !t.value.toLowerCase().includes('[completed]')
    );

    // Build summary
    const summary = {
      checkpoint: {
        id: checkpoint.id,
        name: checkpoint.name,
        session_id: checkpoint.session_id,
        created_at: checkpoint.created_at,
      },
      stats: {
        total_items_saved: checkpoint.item_count,
        critical_items: highPriorityItems.length,
        pending_tasks: nextSteps.length,
        decisions_made: decisions.length,
        total_size_bytes: checkpoint.total_size,
      },
      critical_context: {
        high_priority_items: highPriorityItems.slice(0, 5).map((i) => ({
          key: i.key,
          value: i.value,
          category: i.category,
          priority: i.priority,
          created_at: i.created_at,
        })),
        next_steps: nextSteps.slice(0, 5).map((t) => ({
          key: t.key,
          value: t.value,
          priority: t.priority,
        })),
        key_decisions: decisions.slice(0, 10).map((d) => ({
          key: d.key,
          value: d.value,
          created_at: d.created_at,
        })),
        recent_progress: progress.slice(0, 3).map((p) => ({
          key: p.key,
          value: p.value,
          created_at: p.created_at,
        })),
      },
      restore_instructions: {
        tool: 'context_restore',
        checkpoint_id: checkpoint.id,
        message: `To continue this session, restore from checkpoint: ${checkpoint.name}`,
        summary: `Session has ${nextSteps.length} pending tasks and ${decisions.length} key decisions recorded.`,
      },
    };

    // Save summary as special context item for AI to read in next session
    const summaryValue = JSON.stringify(summary);
    db.saveContextItem({
      session_id: sessionId,
      key: `compaction_summary_${checkpoint.id}`,
      value: summaryValue,
      category: 'progress',
      priority: 'high',
      channel: 'system',
      size: summaryValue.length,
    });

    return success(
      summary,
      `Compaction prepared: ${checkpoint.item_count} items saved, ${highPriorityItems.length} critical, ${nextSteps.length} tasks pending`
    );
  } catch (err) {
    return error('Failed to prepare compaction', err);
  }
}

/**
 * Restore from checkpoint
 */
async function handleRestoreCheckpoint(args: any) {
  try {
    const sessionId = ensureSession();
    const validated = validateRestoreCheckpoint(args);

    // Verify checkpoint exists
    const checkpoint = db.getCheckpoint(validated.checkpoint_id);
    if (!checkpoint) {
      throw new SaveContextError(
        `Checkpoint '${validated.checkpoint_id}' not found`,
        'NOT_FOUND'
      );
    }

    // Restore items
    const restored = db.restoreCheckpoint(validated.checkpoint_id, sessionId);

    return success(
      { restored_items: restored, checkpoint_name: checkpoint.name },
      `Restored ${restored} items from checkpoint '${checkpoint.name}'`
    );
  } catch (err) {
    return error('Failed to restore checkpoint', err);
  }
}

/**
 * List checkpoints with lightweight search and filtering
 * Returns minimal data to avoid context bloat
 * Use context_get_checkpoint to get full details for a specific checkpoint
 */
async function handleListCheckpoints(args?: any) {
  try {
    const search = args?.search;
    const sessionId = args?.session_id;
    const includeAllProjects = args?.include_all_projects || false;
    const projectPath = args?.project_path || (includeAllProjects ? null : normalizeProjectPath(getCurrentProjectPath()));
    const limit = args?.limit || 20;
    const offset = args?.offset || 0;

    // Build query with filters
    let query = `
      SELECT
        c.id,
        c.name,
        c.session_id,
        c.item_count,
        c.created_at,
        s.name as session_name,
        s.project_path
      FROM checkpoints c
      JOIN sessions s ON c.session_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];

    // Filter by session
    if (sessionId) {
      query += ' AND c.session_id = ?';
      params.push(sessionId);
    }

    // Filter by project path
    if (projectPath) {
      query += ' AND s.project_path = ?';
      params.push(projectPath);
    }

    // Keyword search across name, description, and session name
    if (search) {
      query += ' AND (c.name LIKE ? OR c.description LIKE ? OR s.name LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Count total matches before pagination
    const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = db.getDatabase().prepare(countQuery).get(...params) as { total: number };
    const totalMatches = countResult.total;

    // Add ordering and pagination
    query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const checkpoints = db.getDatabase().prepare(query).all(...params);

    // Determine scope
    let scope: 'session' | 'project' | 'all';
    if (sessionId) {
      scope = 'session';
    } else if (projectPath) {
      scope = 'project';
    } else {
      scope = 'all';
    }

    return success(
      {
        checkpoints,
        count: checkpoints.length,
        total_matches: totalMatches,
        scope,
        has_more: offset + checkpoints.length < totalMatches
      },
      `Found ${totalMatches} checkpoints${search ? ` matching "${search}"` : ''}`
    );
  } catch (err) {
    return error('Failed to list checkpoints', err);
  }
}

/**
 * Get full details for a specific checkpoint
 * Returns complete checkpoint data including description, git info, and item preview
 */
async function handleGetCheckpoint(args: any) {
  try {
    const { checkpoint_id } = args;

    if (!checkpoint_id || typeof checkpoint_id !== 'string') {
      throw new ValidationError('checkpoint_id is required');
    }

    // Get checkpoint
    const checkpoint = db.getCheckpoint(checkpoint_id);
    if (!checkpoint) {
      throw new SaveContextError(`Checkpoint '${checkpoint_id}' not found`, 'NOT_FOUND');
    }

    // Get session info
    const session = db.getSession(checkpoint.session_id);

    // Get preview of high-priority items from this checkpoint
    const itemsPreview = db.getDatabase()
      .prepare(`
        SELECT ci.key, ci.value, ci.category, ci.priority, ci.created_at
        FROM checkpoint_items chk_items
        JOIN context_items ci ON chk_items.context_item_id = ci.id
        WHERE chk_items.checkpoint_id = ?
        ORDER BY
          CASE ci.priority
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
          END,
          ci.created_at DESC
        LIMIT 5
      `)
      .all(checkpoint_id);

    return success(
      {
        id: checkpoint.id,
        name: checkpoint.name,
        description: checkpoint.description,
        session_id: checkpoint.session_id,
        session_name: session?.name,
        project_path: session?.project_path,
        item_count: checkpoint.item_count,
        total_size: checkpoint.total_size,
        git_status: checkpoint.git_status,
        git_branch: checkpoint.git_branch,
        created_at: checkpoint.created_at,
        items_preview: itemsPreview
      },
      `Checkpoint '${checkpoint.name}' has ${checkpoint.item_count} items`
    );
  } catch (err) {
    return error('Failed to get checkpoint', err);
  }
}

/**
 * Get status of current session
 */
async function handleSessionStatus() {
  try {
    if (!currentSessionId) {
      return success({ current_session_id: null }, 'No active session');
    }

    const session = db.getSession(currentSessionId);
    if (!session) {
      throw new SessionError('Current session not found');
    }

    const stats = db.getSessionStats(currentSessionId);
    const checkpoints = db.listCheckpoints(currentSessionId);

    // Calculate session duration
    const endTime = session.ended_at || Date.now();
    const durationMs = endTime - session.created_at;

    // Compaction suggestions
    const itemCount = stats?.total_items || 0;
    const shouldCompact = itemCount >= 40;
    const compactionReason = shouldCompact
      ? `High item count (${itemCount} items, recommended: prepare at 40+ items)`
      : null;

    const status: SessionStatus = {
      current_session_id: currentSessionId,
      session_name: session.name,
      channel: session.channel,
      project_path: session.project_path,
      status: session.status,
      item_count: itemCount,
      total_size: stats?.total_size || 0,
      checkpoint_count: checkpoints.length,
      last_updated: session.updated_at,
      session_duration_ms: durationMs,
      should_compact: shouldCompact,
      compaction_reason: compactionReason,
    };

    return success(status);
  } catch (err) {
    return error('Failed to get session status', err);
  }
}

/**
 * Rename current session
 */
async function handleSessionRename(args: any) {
  try {
    const sessionId = ensureSession();
    const { new_name } = args;

    if (!new_name || typeof new_name !== 'string' || new_name.trim().length === 0) {
      throw new ValidationError('new_name is required and must be a non-empty string');
    }

    const trimmedName = new_name.trim();

    // Update session name
    db.getDatabase()
      .prepare('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?')
      .run(trimmedName, Date.now(), sessionId);

    return success(
      { session_id: sessionId, new_name: trimmedName },
      `Session renamed to '${trimmedName}'`
    );
  } catch (err) {
    return error('Failed to rename session', err);
  }
}

/**
 * List recent sessions
 */
async function handleListSessions(args: any) {
  try {
    const limit = args?.limit || 10;
    const projectPath = args?.project_path || getCurrentProjectPath();
    const status = args?.status;
    const includeCompleted = args?.include_completed || false;

    // Use listSessionsByPaths to properly check session_projects junction table
    // This ensures multi-path sessions appear in all their associated projects
    const sessions = db.listSessionsByPaths(
      projectPath ? [normalizeProjectPath(projectPath)] : [],
      limit,
      {
        status,
        include_completed: includeCompleted,
      }
    );

    return success(
      { sessions, count: sessions.length },
      `Found ${sessions.length} sessions`
    );
  } catch (err) {
    return error('Failed to list sessions', err);
  }
}

/**
 * End (complete) the current session
 */
async function handleSessionEnd() {
  try {
    const sessionId = ensureSession();
    const session = db.getSession(sessionId);

    if (!session) {
      throw new SessionError('Current session not found');
    }

    // Get stats before ending
    const stats = db.getSessionStats(sessionId);
    const checkpoints = db.listCheckpoints(sessionId);
    const duration = Date.now() - session.created_at;

    // End the session
    db.endSession(sessionId);

    // Clear current session
    currentSessionId = null;

    // Clear agent association with this session
    const branch = await getCurrentBranch();
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const provider = getCurrentProvider();
    const agentId = getAgentId(projectPath, branch || 'main', provider);
    db.clearCurrentSessionForAgent(agentId);

    return success(
      {
        session_id: sessionId,
        session_name: session.name,
        duration_ms: duration,
        item_count: stats?.total_items || 0,
        checkpoint_count: checkpoints.length,
        total_size: stats?.total_size || 0,
      },
      `Session '${session.name}' completed (duration: ${Math.round(duration / 1000 / 60)}min, ${stats?.total_items || 0} items)`
    );
  } catch (err) {
    return error('Failed to end session', err);
  }
}

/**
 * Pause the current session
 */
async function handleSessionPause() {
  try {
    const sessionId = ensureSession();
    const session = db.getSession(sessionId);

    if (!session) {
      throw new SessionError('Current session not found');
    }

    // Pause the session
    db.pauseSession(sessionId);

    // Clear current session
    currentSessionId = null;

    // Clear agent association with this session
    const branch = await getCurrentBranch();
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const provider = getCurrentProvider();
    const agentId = getAgentId(projectPath, branch || 'main', provider);
    db.clearCurrentSessionForAgent(agentId);

    return success(
      {
        session_id: sessionId,
        session_name: session.name,
        resume_instructions: `To resume: use context_session_resume with session_id: ${sessionId}`,
      },
      `Session '${session.name}' paused. Resume anytime with context_session_resume.`
    );
  } catch (err) {
    return error('Failed to pause session', err);
  }
}

/**
 * Resume a paused session
 */
async function handleSessionResume(args: any) {
  try {
    const { session_id } = args;

    if (!session_id || typeof session_id !== 'string') {
      throw new ValidationError('session_id is required');
    }

    const session = db.getSession(session_id);
    if (!session) {
      throw new SessionError(`Session '${session_id}' not found`);
    }

    // Resume the session (works for paused or completed sessions)
    db.resumeSession(session_id);

    // Set as current session
    currentSessionId = session_id;

    // Update agent activity timestamp
    await updateAgentActivity();

    const stats = db.getSessionStats(session_id);

    return success(
      {
        session_id: session.id,
        session_name: session.name,
        channel: session.channel,
        project_path: session.project_path,
        item_count: stats?.total_items || 0,
        created_at: session.created_at,
      },
      `Resumed session '${session.name}' (${stats?.total_items || 0} items)`
    );
  } catch (err) {
    return error('Failed to resume session', err);
  }
}

/**
 * Switch between sessions (pause current, resume another)
 */
async function handleSessionSwitch(args: any) {
  try {
    const { session_id } = args;

    if (!session_id || typeof session_id !== 'string') {
      throw new ValidationError('session_id is required');
    }

    const targetSession = db.getSession(session_id);
    if (!targetSession) {
      throw new SessionError(`Session '${session_id}' not found`);
    }

    if (targetSession.status === 'completed') {
      throw new SessionError('Cannot switch to completed session. Create a new session instead.');
    }

    // Pause current session if exists
    let pausedSession = null;
    if (currentSessionId) {
      const current = db.getSession(currentSessionId);
      if (current) {
        db.pauseSession(currentSessionId);
        pausedSession = current.name;
      }
    }

    // Resume target session
    db.resumeSession(session_id);
    currentSessionId = session_id;

    const stats = db.getSessionStats(session_id);

    return success(
      {
        previous_session: pausedSession,
        current_session: targetSession.name,
        session_id: session_id,
        item_count: stats?.total_items || 0,
      },
      pausedSession
        ? `Switched from '${pausedSession}' to '${targetSession.name}'`
        : `Switched to session '${targetSession.name}'`
    );
  } catch (err) {
    return error('Failed to switch sessions', err);
  }
}

/**
 * Delete a session
 */
async function handleSessionDelete(args: any) {
  try {
    const { session_id } = args;

    if (!session_id || typeof session_id !== 'string') {
      throw new ValidationError('session_id is required');
    }

    const session = db.getSession(session_id);
    if (!session) {
      throw new SessionError(`Session '${session_id}' not found`);
    }

    // Delete will throw if session is active
    const deleted = db.deleteSession(session_id);

    if (deleted) {
      return success(
        { session_id, session_name: session.name },
        `Session '${session.name}' deleted successfully`
      );
    } else {
      throw new SessionError('Failed to delete session');
    }
  } catch (err) {
    return error('Failed to delete session', err);
  }
}

/**
 * Add a project path to the current session
 * Enables sessions to span multiple related directories (e.g., monorepo folders)
 */
async function handleSessionAddPath(args: any) {
  try {
    const sessionId = ensureSession();

    // Get project path (default to current directory if not provided)
    const projectPath = args?.project_path
      ? normalizeProjectPath(args.project_path)
      : normalizeProjectPath(getCurrentProjectPath());

    const session = db.getSession(sessionId);
    if (!session) {
      throw new SessionError('Current session not found');
    }

    // Check if path already exists
    const existingPaths = db.getSessionPaths(sessionId);
    if (existingPaths.includes(projectPath)) {
      return success(
        {
          session_id: sessionId,
          session_name: session.name,
          project_path: projectPath,
          all_paths: existingPaths,
          already_existed: true,
        },
        `Path '${projectPath}' already exists in session '${session.name}'`
      );
    }

    // Add the new path
    const added = db.addProjectPath(sessionId, projectPath);
    if (added) {
      const updatedPaths = db.getSessionPaths(sessionId);
      return success(
        {
          session_id: sessionId,
          session_name: session.name,
          project_path: projectPath,
          all_paths: updatedPaths,
          path_count: updatedPaths.length,
        },
        `Added path '${projectPath}' to session '${session.name}' (${updatedPaths.length} paths total)`
      );
    } else {
      throw new DatabaseError('Failed to add path to session');
    }
  } catch (err) {
    return error('Failed to add path to session', err);
  }
}

// ====================
// MCP Server Handlers
// ====================

/**
 * Handle MCP initialization - capture client info
 * This is called when an MCP client first connects
 *
 * STDIO: One connection per process, connectionId is static
 * SSE/HTTP: Multiple connections, would generate unique IDs per request
 */
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  // Extract client information from the initialization handshake
  const rawClientName = request.params.clientInfo?.name || 'unknown';
  const rawClientVersion = request.params.clientInfo?.version || '0.0.0';
  const provider = normalizeClientName(rawClientName);

  // Create connection ID
  // STDIO: Use static ID since it's 1:1
  // SSE/HTTP: Would use crypto.randomUUID() or request context
  const connectionId = 'stdio-main';

  // Store connection state
  const clientInfo: ClientInfo = {
    name: rawClientName,
    version: rawClientVersion,
    provider,
    connectedAt: Date.now(),
  };

  connections.set(connectionId, {
    clientInfo,
    sessionId: null,
  });

  currentConnectionId = connectionId;

  // Log for debugging (to stderr, not stdout)
  console.error(`MCP Client connected: ${provider} (${rawClientName} v${rawClientVersion})`);

  return {
    protocolVersion: request.params.protocolVersion,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'savecontext',
      version: '0.1.2',
    },
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'context_session_start',
        description: 'Start a new coding session or resume existing one. Auto-derives channel from git branch. Call at conversation start or when switching contexts.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Session name (e.g., "Implementing Authentication")',
            },
            description: {
              type: 'string',
              description: 'Optional session description',
            },
            channel: {
              type: 'string',
              description: 'Optional channel name (auto-derived from git branch if not provided)',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'context_save',
        description: 'Save individual context items (decisions, tasks, notes, progress). Use frequently to capture important information. Supports categories (task/decision/progress/note) and priorities (high/normal/low).',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Unique key for this context item (e.g., "current_task", "auth_decision")',
            },
            value: {
              type: 'string',
              description: 'The context value to save',
            },
            category: {
              type: 'string',
              enum: ['task', 'decision', 'progress', 'note'],
              description: 'Category of this context item',
            },
            priority: {
              type: 'string',
              enum: ['high', 'normal', 'low'],
              description: 'Priority level',
            },
            channel: {
              type: 'string',
              description: 'Channel to save to (uses session default if not specified)',
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'context_get',
        description: 'Retrieve saved context items with filtering by category, priority, channel. Use to recall previous decisions, check task status, or review session history.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Specific key to retrieve (if not provided, returns filtered list)',
            },
            category: {
              type: 'string',
              enum: ['task', 'decision', 'progress', 'note'],
              description: 'Filter by category',
            },
            priority: {
              type: 'string',
              enum: ['high', 'normal', 'low'],
              description: 'Filter by priority',
            },
            channel: {
              type: 'string',
              description: 'Filter by channel',
            },
            limit: {
              type: 'number',
              description: 'Maximum items to return (default: 100)',
            },
            offset: {
              type: 'number',
              description: 'Number of items to skip (for pagination)',
            },
          },
        },
      },
      {
        name: 'context_delete',
        description: 'Delete a context item from the current session. Use to remove outdated information, fix mistakes, or clean up test data.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Key of the context item to delete',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'context_update',
        description: 'Update an existing context item. Change the value, category, priority, or channel of a previously saved item.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Key of the context item to update',
            },
            value: {
              type: 'string',
              description: 'New value for the context item',
            },
            category: {
              type: 'string',
              enum: ['task', 'decision', 'progress', 'note'],
              description: 'New category',
            },
            priority: {
              type: 'string',
              enum: ['high', 'normal', 'low'],
              description: 'New priority level',
            },
            channel: {
              type: 'string',
              description: 'New channel',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'context_memory_save',
        description: 'Save project memory (command, config, or note) for current project. Memory persists across sessions and is accessible by all agents working on this project.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Unique key for this memory item (e.g., "run_tests", "api_endpoint")',
            },
            value: {
              type: 'string',
              description: 'The value to remember (command, URL, note, etc.)',
            },
            category: {
              type: 'string',
              enum: ['command', 'config', 'note'],
              description: 'Type of memory (default: command)',
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'context_memory_get',
        description: 'Retrieve project memory by key.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Memory key to retrieve',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'context_memory_list',
        description: 'List all memory items for current project. Optionally filter by category.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['command', 'config', 'note'],
              description: 'Optional: filter by category',
            },
          },
        },
      },
      {
        name: 'context_memory_delete',
        description: 'Delete a memory item by key.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Memory key to delete',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'context_task_create',
        description: 'Create a new task for the current project. Tasks persist across sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Task title',
            },
            description: {
              type: 'string',
              description: 'Optional task description',
            },
          },
          required: ['title'],
        },
      },
      {
        name: 'context_task_update',
        description: 'Update an existing task (title, description, or status).',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Task ID to update',
            },
            title: {
              type: 'string',
              description: 'New task title',
            },
            description: {
              type: 'string',
              description: 'New task description',
            },
            status: {
              type: 'string',
              enum: ['todo', 'done'],
              description: 'New task status',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'context_task_list',
        description: 'List all tasks for current project. Optionally filter by status.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['todo', 'done'],
              description: 'Optional: filter by status',
            },
          },
        },
      },
      {
        name: 'context_task_complete',
        description: 'Mark a task as complete (done).',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Task ID to mark as done',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'context_checkpoint',
        description: 'Create named checkpoint snapshot for manual saves. Use before major refactors, git branch switches, or experimental changes. For auto-save before context fills up, use context_prepare_compaction instead.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Checkpoint name (e.g., "before-refactor", "auth-complete")',
            },
            description: {
              type: 'string',
              description: 'Optional checkpoint description',
            },
            include_git: {
              type: 'boolean',
              description: 'Include git status in checkpoint (default: false)',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'context_restore',
        description: 'Restore session state from checkpoint. Use to continue previous work, recover from mistakes, or restore after context compaction. Restores all context items to current session.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of checkpoint to restore',
            },
          },
          required: ['checkpoint_id'],
        },
      },
      {
        name: 'context_list_checkpoints',
        description: 'Lightweight checkpoint search with keyword filtering. Returns minimal data (id, name, session_name, created_at, item_count) to avoid context bloat. Defaults to current project. Use context_get_checkpoint to get full details for a specific checkpoint.',
        inputSchema: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description: 'Keyword search across checkpoint name, description, and session name',
            },
            session_id: {
              type: 'string',
              description: 'Filter to specific session',
            },
            project_path: {
              type: 'string',
              description: 'Filter to specific project (default: current project)',
            },
            include_all_projects: {
              type: 'boolean',
              description: 'Show checkpoints from all projects (default: false)',
            },
            limit: {
              type: 'number',
              description: 'Maximum results to return (default: 20)',
            },
            offset: {
              type: 'number',
              description: 'Pagination offset (default: 0)',
            },
          },
        },
      },
      {
        name: 'context_get_checkpoint',
        description: 'Get full details for a specific checkpoint. Returns complete data including description, git status/branch, and preview of top 5 high-priority items. Use after context_list_checkpoints to drill down into relevant checkpoints.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to retrieve',
            },
          },
          required: ['checkpoint_id'],
        },
      },
      {
        name: 'context_status',
        description: 'Get current session statistics: item count, categories breakdown, priorities, recent activity. Use to understand session state or decide when to checkpoint. Includes compaction suggestions when item count is high.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'context_prepare_compaction',
        description: 'Smart checkpoint for context compaction. Call when conversation gets long (40+ messages) or before context limit. Analyzes priority items, identifies next steps, generates restoration summary. Returns critical context for seamless session continuation. Works across all AI coding tools.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'context_session_rename',
        description: 'Rename current session. Use when initial name wasn\'t descriptive enough or context changed direction.',
        inputSchema: {
          type: 'object',
          properties: {
            new_name: {
              type: 'string',
              description: 'New session name',
            },
          },
          required: ['new_name'],
        },
      },
      {
        name: 'context_list_sessions',
        description: 'List recent sessions with summary. Filters by current project path by default. Use at conversation start to find previous work or when user asks to continue from earlier session.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum sessions to return (default: 10)',
            },
            project_path: {
              type: 'string',
              description: 'Filter by project path (defaults to current working directory)',
            },
            status: {
              type: 'string',
              enum: ['active', 'paused', 'completed', 'all'],
              description: 'Filter by session status',
            },
            include_completed: {
              type: 'boolean',
              description: 'Include completed sessions (default: false)',
            },
          },
        },
      },
      {
        name: 'context_session_end',
        description: 'End (complete) the current session. Marks session as completed with timestamp. Returns session summary including duration, items saved, and checkpoints created. Use when work is finished.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'context_session_pause',
        description: 'Pause the current session to resume later. Preserves all session state and can be resumed with context_session_resume. Use when switching contexts or taking a break.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'context_session_resume',
        description: 'Resume a previously paused session. Restores session state and sets it as the active session. Cannot resume completed sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to resume',
            },
          },
          required: ['session_id'],
        },
      },
      {
        name: 'context_session_switch',
        description: 'Switch between sessions atomically. Pauses current session (if any) and resumes the specified session. Use when working on multiple projects.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to switch to',
            },
          },
          required: ['session_id'],
        },
      },
      {
        name: 'context_session_delete',
        description: 'Delete a session permanently. Cannot delete active sessions (must pause or end first). Cascade deletes all context items and checkpoints. Use to clean up accidentally created sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to delete',
            },
          },
          required: ['session_id'],
        },
      },
      {
        name: 'context_session_add_path',
        description: 'Add a project path to the current session. Enables sessions to span multiple related directories (e.g., monorepo folders like /frontend and /backend, or /app and /dashboard). Auto-adds current path if not specified.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Project path to add (defaults to current working directory)',
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'context_session_start':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionStart(args), null, 2) }] };
      case 'context_save':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSaveContext(args), null, 2) }] };
      case 'context_get':
        return { content: [{ type: 'text', text: JSON.stringify(await handleGetContext(args), null, 2) }] };
      case 'context_delete':
        return { content: [{ type: 'text', text: JSON.stringify(await handleDeleteContext(args), null, 2) }] };
      case 'context_update':
        return { content: [{ type: 'text', text: JSON.stringify(await handleUpdateContext(args), null, 2) }] };
      case 'context_memory_save':
        return { content: [{ type: 'text', text: JSON.stringify(await handleMemorySave(args), null, 2) }] };
      case 'context_memory_get':
        return { content: [{ type: 'text', text: JSON.stringify(await handleMemoryGet(args), null, 2) }] };
      case 'context_memory_list':
        return { content: [{ type: 'text', text: JSON.stringify(await handleMemoryList(args), null, 2) }] };
      case 'context_memory_delete':
        return { content: [{ type: 'text', text: JSON.stringify(await handleMemoryDelete(args), null, 2) }] };
      case 'context_task_create':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskCreate(args), null, 2) }] };
      case 'context_task_update':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskUpdate(args), null, 2) }] };
      case 'context_task_list':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskList(args), null, 2) }] };
      case 'context_task_complete':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskComplete(args), null, 2) }] };
      case 'context_checkpoint':
        return { content: [{ type: 'text', text: JSON.stringify(await handleCreateCheckpoint(args), null, 2) }] };
      case 'context_prepare_compaction':
        return { content: [{ type: 'text', text: JSON.stringify(await handlePrepareCompaction(), null, 2) }] };
      case 'context_restore':
        return { content: [{ type: 'text', text: JSON.stringify(await handleRestoreCheckpoint(args), null, 2) }] };
      case 'context_list_checkpoints':
        return { content: [{ type: 'text', text: JSON.stringify(await handleListCheckpoints(args), null, 2) }] };
      case 'context_get_checkpoint':
        return { content: [{ type: 'text', text: JSON.stringify(await handleGetCheckpoint(args), null, 2) }] };
      case 'context_status':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionStatus(), null, 2) }] };
      case 'context_session_rename':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionRename(args), null, 2) }] };
      case 'context_list_sessions':
        return { content: [{ type: 'text', text: JSON.stringify(await handleListSessions(args), null, 2) }] };
      case 'context_session_end':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionEnd(), null, 2) }] };
      case 'context_session_pause':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionPause(), null, 2) }] };
      case 'context_session_resume':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionResume(args), null, 2) }] };
      case 'context_session_switch':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionSwitch(args), null, 2) }] };
      case 'context_session_delete':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionDelete(args), null, 2) }] };
      case 'context_session_add_path':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionAddPath(args), null, 2) }] };
      default:
        return {
          content: [{ type: 'text', text: JSON.stringify(error(`Unknown tool: ${name}`)) }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify(error('Tool execution failed', err)) }],
      isError: true,
    };
  }
});

// ====================
// Start Server
// ====================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is used for MCP protocol)
  console.error('SaveContext MCP Server v0.1.0 (Clean)');
  console.error('Ready for connections...');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
