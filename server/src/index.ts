#!/usr/bin/env node

/**
 * SaveContext MCP Server
 * Local context management with SQLite
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { Command } from 'commander';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const VERSION = packageJson.version;

import {
  COMPACTION_THRESHOLD_DEFAULT,
  COMPACTION_THRESHOLD_MIN,
  COMPACTION_THRESHOLD_MAX,
  COMPACTION_HIGH_PRIORITY_LIMIT,
  COMPACTION_DECISION_LIMIT,
  COMPACTION_REMINDER_LIMIT,
  COMPACTION_PROGRESS_LIMIT,
  COMPACTION_ITEM_COUNT_THRESHOLD,
  SESSION_NAME_MAX_LENGTH,
  CONTEXT_VALUE_MAX_LENGTH,
  CONTEXT_ITEMS_DEFAULT_LIMIT,
  CONTEXT_ITEMS_MAX_LIMIT,
} from './utils/constants.js';

// ====================
// CLI Argument Parsing
// ====================

const program = new Command();
program
  .name('savecontext')
  .version(VERSION)
  .description('SaveContext MCP Server - Local SQLite mode')
  .option('--setup-statusline', 'Configure Claude Code status line (run this first)')
  .option('--setup-skill', 'Install SaveContext skill for AI coding tools')
  .option('--tool <name>', 'Target tool for skill install (claude, codex, gemini, etc.)')
  .option('--path <path>', 'Custom path for skill install')
  .option('--sync', 'Sync skill to all previously configured tools')
  .parse(process.argv);

const options = program.opts();

// Handle --setup-statusline before anything else
if (options.setupStatusline) {
  const { setupStatusLine } = await import('./cli/setup.js');
  await setupStatusLine();
  process.exit(0);
}

// Handle --setup-skill
if (options.setupSkill || options.sync) {
  const { setupSkill } = await import('./cli/setup.js');
  await setupSkill({
    tool: options.tool,
    path: options.path,
    sync: options.sync,
  });
  process.exit(0);
}

// ====================
// Local Mode Initialization
// ====================

console.error('[SaveContext] Mode: local');

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
  validateTagContextItems,
  validateCheckpointItemManagement,
  validateCheckpointSplit,
  validateDeleteCheckpoint,
  validateCheckpointName,
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
  CompactionConfig,
  ClientInfo,
  ConnectionState,
  ContextItemUpdate,
  IssueUpdate,
  Issue,
  IssueStatus,
  IssueType,
  DependencyType,
  CreateIssueArgs,
  UpdateIssueArgs,
  ListIssuesArgs,
  AddDependencyArgs,
  RemoveDependencyArgs,
  AddLabelsArgs,
  RemoveLabelsArgs,
  ClaimIssuesArgs,
  GetNextBlockArgs,
  ReleaseIssuesArgs,
  GetReadyIssuesArgs,
  CreateBatchArgs,
} from './types/index.js';
import { loadConfig } from './utils/config.js';
import { updateStatusLine, refreshStatusCache } from './utils/status-cache.js';
import { createEmbeddingProvider, getProviderInfo } from './lib/embeddings/factory.js';
import { chunkText } from './lib/embeddings/chunker.js';
import type { EmbeddingProvider } from './lib/embeddings/index.js';

// Initialize local SQLite database
const db = new DatabaseManager();

// Initialize embedding provider (for local semantic search)
let embeddingProvider: EmbeddingProvider | null = null;

async function initializeEmbeddings(): Promise<void> {
  embeddingProvider = await createEmbeddingProvider();
  const info = getProviderInfo(embeddingProvider);

  if (info.enabled && info.dimensions) {
    // Ensure vec table has correct dimensions for this provider
    const recreated = db.ensureVecDimensions(info.dimensions);
    if (recreated) {
      console.error('[SaveContext] Embeddings will be regenerated with new provider dimensions');
    }
    console.error(`[SaveContext] Semantic search: enabled (${info.provider}/${info.model}, ${info.dimensions}d)`);

    // Run startup backfill for any items missing embeddings
    runStartupBackfill().catch((err) => {
      console.error('[SaveContext] Startup backfill failed:', err);
    });
  } else {
    console.error('[SaveContext] Semantic search: disabled (install Ollama for local embeddings)');
  }
}

/**
 * Automatically backfill embeddings for items that were saved when provider wasn't ready.
 * Runs at startup after embedding provider is initialized.
 */
async function runStartupBackfill(): Promise<void> {
  if (!embeddingProvider) return;

  const stats = db.getEmbeddingStats();
  if (stats.pending === 0) return;

  console.error(`[SaveContext] Backfilling ${stats.pending} items missing embeddings...`);

  const items = db.getAllItemsNeedingEmbeddings(50); // Process in batches of 50
  let processed = 0;
  let errors = 0;

  for (const item of items) {
    try {
      await generateEmbeddingAsync(item.id, item.value);
      processed++;
    } catch {
      errors++;
    }
  }

  if (errors > 0) {
    console.error(`[SaveContext] Backfill complete: ${processed} processed, ${errors} errors`);
  } else if (processed > 0) {
    console.error(`[SaveContext] Backfill complete: ${processed} items embedded`);
  }

  // If there are more items, schedule another batch
  const remaining = db.getEmbeddingStats().pending;
  if (remaining > 0) {
    console.error(`[SaveContext] ${remaining} items remaining, will process on next startup`);
  }
}

// Initialize embeddings on startup
initializeEmbeddings().catch((err) => {
  console.error('[SaveContext] Failed to initialize embeddings:', err);
});

// Helper to get db (for consistency with existing code)
function getDb(): DatabaseManager {
  return db;
}

// Load compaction configuration from environment
function loadCompactionConfig(): CompactionConfig {
  const threshold = parseInt(process.env.SAVECONTEXT_COMPACTION_THRESHOLD || String(COMPACTION_THRESHOLD_DEFAULT), 10);
  const rawMode = process.env.SAVECONTEXT_COMPACTION_MODE || 'remind';

  // Validate threshold
  const validThreshold = (threshold >= COMPACTION_THRESHOLD_MIN && threshold <= COMPACTION_THRESHOLD_MAX) ? threshold : COMPACTION_THRESHOLD_DEFAULT;
  if (validThreshold !== threshold) {
    console.error(`[SaveContext] Invalid SAVECONTEXT_COMPACTION_THRESHOLD: ${threshold}. Using default: ${COMPACTION_THRESHOLD_DEFAULT}`);
  }

  // Validate mode
  const validModes: CompactionConfig['mode'][] = ['auto', 'remind', 'manual'];
  const mode = validModes.includes(rawMode as any) ? (rawMode as CompactionConfig['mode']) : 'remind';
  if (mode !== rawMode) {
    console.error(`[SaveContext] Invalid SAVECONTEXT_COMPACTION_MODE: ${rawMode}. Using default: remind`);
  }

  console.error(`[SaveContext] Compaction config loaded: threshold=${validThreshold}%, mode=${mode}`);
  return { threshold: validThreshold, mode };
}

const compactionConfig = loadCompactionConfig();

// Track current session
let currentSessionId: string | null = null;

// Connection tracking
const connections = new Map<string, ConnectionState>();
let currentConnectionId: string | null = null;

// Initialize MCP server
const server = new Server(
  {
    name: 'savecontext',
    version: VERSION,
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

  // Coding tools (have project path and git branch context)
  if (name.includes('claude') && name.includes('code')) return 'claude-code';
  if (name.includes('cursor')) return 'cursor';
  if (name.includes('windsurf')) return 'windsurf';
  if (name.includes('vscode') || name.includes('vs code')) return 'vscode';
  if (name.includes('visual studio')) return 'visual-studio';
  if (name.includes('zed')) return 'zed';
  if (name.includes('jetbrains')) return 'jetbrains';
  if (name.includes('cline')) return 'cline';
  if (name.includes('roo')) return 'roo-code';
  if (name.includes('augment')) return 'augment';
  if (name.includes('kilo')) return 'kilo-code';
  if (name.includes('factory')) return 'factory-ai';
  if (name.includes('codex')) return 'codex-cli';
  if (name.includes('copilot')) return 'copilot';
  if (name.includes('cody') || name.includes('sourcegraph')) return 'cody';
  if (name.includes('tabnine')) return 'tabnine';
  if (name.includes('qodo')) return 'qodo';
  if (name.includes('amazon') && name.includes('q')) return 'amazon-q';
  if (name.includes('replit')) return 'replit';
  if (name.includes('opencode')) return 'opencode';
  if (name.includes('antigravity')) return 'antigravity';
  if (name.includes('gemini')) return 'gemini-cli';
  if (name.includes('warp')) return 'warp';
  if (name.includes('qwen')) return 'qwen-coder';

  // Desktop apps (no project path or git branch context)
  if (name.includes('claude')) return 'claude-desktop';
  if (name.includes('perplexity')) return 'perplexity';
  if (name.includes('chatgpt')) return 'chatgpt';
  if (name.includes('lm-studio') || name.includes('lmstudio')) return 'lm-studio';
  if (name.includes('bolt')) return 'bolt-ai';
  if (name.includes('raycast')) return 'raycast';

  // Return sanitized name for unknown clients
  return name.replace(/\s+/g, '-');
}

/**
 * Generate agent ID from project path, git branch, and provider
 * Format: "${projectName}-${branch}-${provider}" for coding tools
 * Format: "global-${provider}" for desktop apps without project context
 * Can be overridden via SAVECONTEXT_AGENT_ID env var
 */
function getAgentId(projectPath: string, branch: string, provider: string): string {
  // Allow manual override for power users
  if (process.env.SAVECONTEXT_AGENT_ID) {
    return process.env.SAVECONTEXT_AGENT_ID;
  }

  const safeProvider = provider || 'unknown';

  // Desktop apps without project context get simplified ID
  if (!projectPath) {
    return `global-${safeProvider}`;
  }

  const projectName = projectPath.split('/').pop() || 'unknown';
  const safeBranch = branch || 'main';

  return `${projectName}-${safeBranch}-${safeProvider}`;
}

/**
 * Get the current provider from the active connection
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
    const session = getDb().getSession(currentSessionId);
    if (!session) return;

    const branch = await getCurrentBranch();
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const provider = getCurrentProvider();
    const agentId = getAgentId(projectPath, branch || 'main', provider);

    // Update agent's last_active_at timestamp
    getDb().setCurrentSessionForAgent(agentId, currentSessionId, projectPath, branch || 'main', provider);
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

    // If force_new, pause any existing active session and clear agent link
    if (validated.force_new) {
      const existingAgentSession = getDb().getCurrentSessionForAgent(agentId);
      if (existingAgentSession && existingAgentSession.status === 'active') {
        getDb().pauseSession(existingAgentSession.id);
      }
      getDb().clearCurrentSessionForAgent(agentId);
    }

    // Check if this agent already has a current session (skip if force_new)
    const agentSession = validated.force_new ? null : getDb().getCurrentSessionForAgent(agentId);

    if (agentSession && agentSession.status === 'active') {
      // Agent already has a current session - resume it
      // Check if current path is already in the session
      const sessionPaths = getDb().getSessionPaths(agentSession.id);
      const pathAlreadyExists = sessionPaths.includes(projectPath);

      // If current path not in session, add it (multi-path support)
      if (!pathAlreadyExists) {
        // Check if project exists
        const project = getDb().getProject(projectPath);
        if (!project) {
          return error(
            'Project not found',
            new Error(`No project exists at ${projectPath}. Create one first with context_project_create.`)
          );
        }
        getDb().addProjectPath(agentSession.id, projectPath);
      }

      // Update agent's last active time and provider
      getDb().setCurrentSessionForAgent(agentId, agentSession.id, projectPath, branch || 'main', provider);

      // Set as current session in memory
      currentSessionId = agentSession.id;
      const stats = getDb().getSessionStats(agentSession.id);

      // Update status line for Claude Code
      updateStatusLine(agentSession, { itemCount: stats?.total_items, provider, projectPath });

      // Check if provided name differs from existing session name
      const nameIgnored = validated.name !== agentSession.name;
      const warning = nameIgnored
        ? `Provided name '${validated.name}' ignored - resumed existing session. Use force_new=true to create new session.`
        : undefined;

      return success(
        {
          id: agentSession.id,
          name: agentSession.name,
          channel: agentSession.channel,
          project_paths: getDb().getSessionPaths(agentSession.id),
          status: agentSession.status,
          item_count: stats?.total_items || 0,
          created_at: agentSession.created_at,
          resumed: true,
          path_added: !pathAlreadyExists,
          agent_id: agentId,
          provider,
          ...(warning && { warning }),
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

    // Require project exists - user must create project first
    const project = getDb().getProject(projectPath);
    if (!project) {
      return error(
        'Project not found',
        new Error(`No project exists at ${projectPath}. Create one first with context_project_create.`)
      );
    }

    // Create new session
    const session = getDb().createSession({
      name: validated.name,
      description: validated.description,
      branch: branch || undefined,
      channel,
      project_path: projectPath,
      status: 'active',
    });

    // Register session for this agent
    getDb().setCurrentSessionForAgent(agentId, session.id, projectPath, branch || 'main', provider);

    // Set as current session in memory
    currentSessionId = session.id;

    // Update status line for Claude Code
    updateStatusLine(session, { itemCount: 0, provider, projectPath });

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
    const session = getDb().getSession(sessionId);
    if (!session) {
      throw new SessionError('Current session not found');
    }

    const channel = validated.channel || session.channel;

    // Save context item
    const item = getDb().saveContextItem({
      session_id: sessionId,
      key: validated.key,
      value: validated.value,
      category: validated.category || 'note',
      priority: validated.priority || 'normal',
      channel: normalizeChannel(channel),
      tags: '[]',
      size: validated.key.length + validated.value.length,
    });

    // Update agent activity timestamp
    await updateAgentActivity();

    // Generate embedding async (fire-and-forget for performance)
    if (embeddingProvider) {
      generateEmbeddingAsync(item.id, validated.value).catch((err) => {
        console.error(`[SaveContext] Embedding generation failed for ${item.key}:`, err);
      });
    }

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
 * Generate embedding for a context item (async helper)
 * Chunks large text to handle model token limits
 */
async function generateEmbeddingAsync(itemId: string, text: string): Promise<void> {
  if (!embeddingProvider) return;

  // Verify provider is actually ready (not still initializing)
  const isReady = await embeddingProvider.isAvailable().catch(() => false);
  if (!isReady) {
    // Provider not ready yet - leave as 'none', backfill will handle later
    return;
  }

  try {
    // Mark as pending
    getDb().updateEmbeddingStatus(itemId, 'pending');

    // Chunk text based on provider's maxChars limit
    const chunks = chunkText(text, {
      maxChars: embeddingProvider.maxChars,
      overlapChars: Math.floor(embeddingProvider.maxChars * 0.1), // 10% overlap
    });

    // Generate embeddings for each chunk
    const chunkEmbeddings: Array<{ index: number; embedding: number[] }> = [];
    for (const chunk of chunks) {
      const embedding = await embeddingProvider.generateEmbedding(chunk.text);
      chunkEmbeddings.push({ index: chunk.index, embedding });
    }

    // Save all chunks to vector table
    getDb().saveChunkEmbeddings(itemId, chunkEmbeddings, embeddingProvider.name, embeddingProvider.model);
  } catch (err) {
    // Only mark as error if generation genuinely failed (provider was ready)
    getDb().updateEmbeddingStatus(itemId, 'error');
    throw err;
  }
}

/**
 * Get context from current session (or all sessions if search_all_sessions=true)
 */
async function handleGetContext(args: any) {
  try {
    const validated = validateGetContext(args);
    const searchAllSessions = args?.search_all_sessions === true;

    // For semantic search across all sessions with a query, session is optional
    // For all other operations, session is required
    const needsSession = !searchAllSessions || !args?.query || validated.key;
    const sessionId = needsSession ? ensureSession() : currentSessionId;

    // If key is provided, get single item (requires session)
    if (validated.key) {
      const item = getDb().getContextItem(sessionId!, validated.key);
      if (!item) {
        return success(
          { items: [], total: 0, session_id: sessionId },
          `No item found with key '${validated.key}'`
        );
      }

      const response: GetContextResponse = {
        items: [item],
        total: 1,
        session_id: sessionId!,
      };

      return success(response);
    }

    // If query is provided, perform semantic search (or keyword fallback)
    if (args?.query) {
      const query = String(args.query);
      const limit = validated.limit || CONTEXT_ITEMS_DEFAULT_LIMIT;
      const threshold = typeof args.threshold === 'number' ? args.threshold : 0.5;

      // Try semantic search first if provider available
      if (embeddingProvider) {
        try {
          const queryEmbedding = await embeddingProvider.generateEmbedding(query);
          const searchSessionId = searchAllSessions ? null : sessionId;
          const semanticResults = getDb().semanticSearch(queryEmbedding, searchSessionId, {
            threshold,
            limit,
            category: validated.category,
            priority: validated.priority,
          });

          if (semanticResults.length > 0) {
            const response = {
              items: semanticResults,
              total: semanticResults.length,
              session_id: sessionId,
              search_mode: searchAllSessions ? 'semantic_all_sessions' : 'semantic',
            };

            return success(response, `Found ${semanticResults.length} items (semantic search${searchAllSessions ? ', all sessions' : ''})`);
          }
          // Fall through to keyword search if no semantic results
        } catch (err) {
          console.error('[SaveContext] Semantic search failed, falling back to keyword:', err);
        }
      }

      // Keyword search fallback (requires active session)
      if (!sessionId) {
        return success(
          { items: [], total: 0, session_id: null, search_mode: 'semantic_all_sessions' },
          'No results found (semantic search across all sessions)'
        );
      }

      const queryLower = query.toLowerCase();
      const keywords = queryLower.split(/\s+/).filter((k: string) => k.length > 2);

      // Get all items from session, then filter by keyword match
      const allItems = getDb().getContextItems(sessionId, {
        category: validated.category,
        priority: validated.priority,
        channel: validated.channel,
        limit: 1000, // Get more items for keyword search
        offset: 0,
      });

      // Score items by keyword matches in value
      const scoredItems = allItems
        .map((item) => {
          const valueText = String(item.value).toLowerCase();
          const keyText = String(item.key).toLowerCase();
          let score = 0;
          for (const keyword of keywords) {
            if (valueText.includes(keyword)) score += 2;
            if (keyText.includes(keyword)) score += 1;
          }
          return { item, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const items = scoredItems.map((s) => s.item);

      const response = {
        items,
        total: items.length,
        session_id: sessionId,
        search_mode: 'keyword',
        tip: embeddingProvider ? undefined : 'Install Ollama for AI-powered semantic search',
      };

      return success(response, `Found ${items.length} items (keyword search)`);
    }

    // Otherwise, get filtered items (requires session since no query)
    const items = getDb().getContextItems(sessionId!, {
      category: validated.category,
      priority: validated.priority,
      channel: validated.channel,
      limit: validated.limit || CONTEXT_ITEMS_DEFAULT_LIMIT,
      offset: validated.offset || 0,
    });

    const response: GetContextResponse = {
      items,
      total: items.length,
      session_id: sessionId!,
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

    const deleted = getDb().deleteContextItem(sessionId, args.key);

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
    const updates: ContextItemUpdate = {};
    if (args.value !== undefined) updates.value = args.value;
    if (args.category !== undefined) updates.category = args.category;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.channel !== undefined) updates.channel = normalizeChannel(args.channel);

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('At least one field to update is required (value, category, priority, or channel)');
    }

    const updated = getDb().updateContextItem(sessionId, args.key, updates);

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

    const result = getDb().saveMemory(projectPath, args.key, args.value, category);

    await updateAgentActivity();

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

    const memory = getDb().getMemory(projectPath, args.key);

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

    const memories = getDb().listMemory(projectPath, category);

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

    const deleted = getDb().deleteMemory(projectPath, args.key);

    if (!deleted) {
      return success(
        { deleted: false, key: args.key },
        `No memory found with key '${args.key}'`
      );
    }

    await updateAgentActivity();

    return success(
      { deleted: true, key: args.key },
      `Deleted memory '${args.key}'`
    );
  } catch (err) {
    return error('Failed to delete memory', err);
  }
}

// ================
// Project Handlers
// ================

/**
 * Create a new project
 */
async function handleProjectCreate(args: any) {
  try {
    if (!args?.project_path) {
      throw new ValidationError('project_path is required');
    }

    const projectPath = normalizeProjectPath(args.project_path);

    // Check if project already exists
    const existing = getDb().getProject(projectPath);
    if (existing) {
      return error('Project already exists', new Error(`A project already exists at ${projectPath}`));
    }

    const project = getDb().createProject({
      project_path: projectPath,
      name: args.name,
      description: args.description,
      issue_prefix: args.issue_prefix,
    });

    if (!project) {
      return error('Failed to create project', new Error('Unknown error'));
    }

    return success(
      { project },
      `Created project '${project.name}' at ${projectPath}`
    );
  } catch (err) {
    return error('Failed to create project', err);
  }
}

/**
 * List all projects
 */
async function handleProjectList(args: any) {
  try {
    const result = getDb().listProjects({
      limit: args?.limit,
      includeSessionCount: args?.include_session_count,
    });

    return success(
      { projects: result.projects, total: result.count },
      `Found ${result.count} project(s)`
    );
  } catch (err) {
    return error('Failed to list projects', err);
  }
}

/**
 * Get a project by path
 */
async function handleProjectGet(args: any) {
  try {
    if (!args?.project_path) {
      throw new ValidationError('project_path is required');
    }

    const projectPath = normalizeProjectPath(args.project_path);
    const project = getDb().getProject(projectPath);

    if (!project) {
      return error('Project not found', new Error(`No project found at ${projectPath}`));
    }

    return success(
      { project },
      `Found project '${project.name}'`
    );
  } catch (err) {
    return error('Failed to get project', err);
  }
}

/**
 * Update a project
 */
async function handleProjectUpdate(args: any) {
  try {
    if (!args?.project_path) {
      throw new ValidationError('project_path is required');
    }

    const projectPath = normalizeProjectPath(args.project_path);

    // Check if any update fields are provided
    if (!args.name && args.description === undefined && !args.issue_prefix) {
      throw new ValidationError('At least one of name, description, or issue_prefix must be provided');
    }

    const project = getDb().updateProject(projectPath, {
      name: args.name,
      description: args.description,
      issue_prefix: args.issue_prefix,
    });

    if (!project) {
      return error('Project not found', new Error(`No project found at ${projectPath}`));
    }

    return success(
      { project },
      `Updated project '${project.name}'`
    );
  } catch (err) {
    return error('Failed to update project', err);
  }
}

/**
 * Delete a project
 */
async function handleProjectDelete(args: any) {
  try {
    if (!args?.project_path) {
      throw new ValidationError('project_path is required');
    }

    if (!args?.confirm) {
      throw new ValidationError('confirm must be true to delete a project');
    }

    const projectPath = normalizeProjectPath(args.project_path);
    const result = getDb().deleteProjectByPath(projectPath, args.confirm);

    if (!result.success) {
      return error('Failed to delete project', new Error(result.error || 'Unknown error'));
    }

    return success(
      { deleted: true, ...result.deleted },
      `Deleted project at ${projectPath}. Removed ${result.deleted?.issues || 0} issues, ${result.deleted?.plans || 0} plans, ${result.deleted?.memory || 0} memory items. Unlinked ${result.deleted?.sessionsUnlinked || 0} sessions.`
    );
  } catch (err) {
    return error('Failed to delete project', err);
  }
}

/**
 * Create a new issue
 */
async function handleTaskCreate(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());

    if (!args?.title) {
      throw new ValidationError('title is required');
    }

    // Validate optional fields
    if (args.priority !== undefined && (args.priority < 0 || args.priority > 4)) {
      throw new ValidationError('priority must be between 0 and 4');
    }
    if (args.issueType && !['task', 'bug', 'feature', 'epic', 'chore'].includes(args.issueType)) {
      throw new ValidationError('issueType must be one of: task, bug, feature, epic, chore');
    }
    if (args.status && !['open', 'in_progress', 'blocked', 'closed', 'deferred'].includes(args.status)) {
      throw new ValidationError('status must be one of: open, in_progress, blocked, closed, deferred');
    }

    const issueArgs: CreateIssueArgs = {
      title: args.title,
      description: args.description,
      details: args.details,
      priority: args.priority,
      issueType: args.issueType,
      parentId: args.parentId,
      planId: args.planId,
      labels: args.labels,
      status: args.status,
    };

    const agentId = getCurrentProvider();
    const result = getDb().createIssue(projectPath, issueArgs, agentId, currentSessionId || undefined);

    await updateAgentActivity();

    return success(
      {
        id: result.id,
        shortId: result.shortId,
        title: result.title,
        description: result.description || null,
        details: result.details || null,
        status: result.status,
        priority: result.priority,
        issueType: result.issueType,
        parentId: result.parentId || null,
        planId: result.planId || null,
        labels: result.labels || [],
        project_path: projectPath,
        created_at: result.createdAt,
      },
      `Created issue ${result.shortId || result.id}: '${args.title}'`
    );
  } catch (err) {
    return error('Failed to create issue', err);
  }
}

/**
 * Update an existing issue
 */
async function handleTaskUpdate(args: any) {
  try {
    if (!args?.id) {
      throw new ValidationError('id is required');
    }

    if (!args?.issue_title) {
      throw new ValidationError('issue_title is required');
    }

    // Fetch issue to get title before updating
    const issue = getDb().getIssue(args.id);
    if (!issue) {
      return success(
        { updated: false, id: args.id },
        `No issue found with id '${args.id}'`
      );
    }

    // Validate title matches
    if (issue.title !== args.issue_title) {
      throw new ValidationError(`Issue title mismatch: expected '${issue.title}' but got '${args.issue_title}'`);
    }

    // Validate optional fields
    if (args.priority !== undefined && (args.priority < 0 || args.priority > 4)) {
      throw new ValidationError('priority must be between 0 and 4');
    }
    if (args.issueType && !['task', 'bug', 'feature', 'epic', 'chore'].includes(args.issueType)) {
      throw new ValidationError('issueType must be one of: task, bug, feature, epic, chore');
    }
    if (args.status && !['open', 'in_progress', 'blocked', 'closed', 'deferred'].includes(args.status)) {
      throw new ValidationError('status must be one of: open, in_progress, blocked, closed, deferred');
    }

    const updates: UpdateIssueArgs = {
      id: args.id,
      issue_title: args.issue_title,
    };
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.details !== undefined) updates.details = args.details;
    if (args.status !== undefined) updates.status = args.status;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.issueType !== undefined) updates.issueType = args.issueType;
    if (args.parentId !== undefined) updates.parentId = args.parentId;
    if (args.planId !== undefined) updates.planId = args.planId;

    const hasFieldUpdates = Object.keys(updates).some(k => !['id', 'issue_title'].includes(k));
    const hasAddProjectPath = args.add_project_path !== undefined;
    const hasRemoveProjectPath = args.remove_project_path !== undefined;

    if (!hasFieldUpdates && !hasAddProjectPath && !hasRemoveProjectPath) {
      throw new ValidationError('At least one field to update is required');
    }

    // Apply field updates if any
    let result = issue;
    if (hasFieldUpdates) {
      const updated = getDb().updateIssue(args.id, updates);
      if (!updated) {
        return success(
          { updated: false, id: args.id },
          `No issue found with id '${args.id}'`
        );
      }
      result = updated;
    }

    // Handle add_project_path - add issue to additional project
    let addProjectPathResult: { added: boolean; alreadyExists?: boolean } | undefined;
    if (hasAddProjectPath) {
      addProjectPathResult = getDb().addIssueProject(args.id, args.add_project_path);
    }

    // Handle remove_project_path - remove issue from additional project
    let removeProjectPathResult: { removed: boolean; error?: string } | undefined;
    if (hasRemoveProjectPath) {
      removeProjectPathResult = getDb().removeIssueProject(args.id, args.remove_project_path);
    }

    // Get all project paths for the response
    const projectPaths = getDb().getIssueProjects(args.id);

    await updateAgentActivity();

    return success(
      {
        updated: true,
        id: result.id,
        shortId: result.shortId,
        title: result.title,
        description: result.description,
        details: result.details,
        status: result.status,
        priority: result.priority,
        issueType: result.issueType,
        parentId: result.parentId,
        labels: result.labels,
        updated_at: result.updatedAt,
        project_paths: projectPaths,
        add_project_path_result: addProjectPathResult,
        remove_project_path_result: removeProjectPathResult,
      },
      `Updated issue ${result.shortId || result.id}: "${result.title}"`
    );
  } catch (err) {
    return error('Failed to update issue', err);
  }
}

/**
 * List issues for current project
 */
async function handleTaskList(args: any) {
  try {
    // Support all_projects flag to query across all projects
    const allProjects = args?.all_projects === true;
    const projectPath = allProjects ? null : normalizeProjectPath(getCurrentProjectPath());

    // Validate optional fields
    if (args?.status && !['open', 'in_progress', 'blocked', 'closed', 'deferred'].includes(args.status)) {
      throw new ValidationError('status must be one of: open, in_progress, blocked, closed, deferred');
    }
    if (args?.issueType && !['task', 'bug', 'feature', 'epic', 'chore'].includes(args.issueType)) {
      throw new ValidationError('issueType must be one of: task, bug, feature, epic, chore');
    }
    if (args?.sortBy && !['priority', 'createdAt', 'updatedAt'].includes(args.sortBy)) {
      throw new ValidationError('sortBy must be one of: priority, createdAt, updatedAt');
    }
    if (args?.sortOrder && !['asc', 'desc'].includes(args.sortOrder)) {
      throw new ValidationError('sortOrder must be one of: asc, desc');
    }

    const listArgs: ListIssuesArgs = {
      status: args?.status,
      priority: args?.priority,
      priorityMin: args?.priority_min,
      priorityMax: args?.priority_max,
      issueType: args?.issueType,
      labels: args?.labels,
      labelsAny: args?.labels_any,
      parentId: args?.parentId,
      planId: args?.planId,
      hasSubtasks: args?.has_subtasks,
      hasDependencies: args?.has_dependencies,
      sortBy: args?.sortBy,
      sortOrder: args?.sortOrder,
      limit: args?.limit,
    };

    const result = getDb().listIssues(projectPath, listArgs);

    return success(
      {
        issues: result.issues.map((t: Issue) => ({
          id: t.id,
          shortId: t.shortId,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          issueType: t.issueType,
          parentId: t.parentId,
          labels: t.labels,
          dependencyCount: t.dependencyCount,
          subtaskCount: t.subtaskCount,
          created_at: t.createdAt,
          updated_at: t.updatedAt,
        })),
        count: result.issues.length,
        project_path: result.queriedProjectPath,
      },
      `Found ${result.issues.length} issue(s)`
    );
  } catch (err) {
    return error('Failed to list issues', err);
  }
}

/**
 * Mark an issue as complete
 */
async function handleTaskComplete(args: any) {
  try {
    if (!args?.id) {
      throw new ValidationError('id is required');
    }

    if (!args?.issue_title) {
      throw new ValidationError('issue_title is required');
    }

    // Fetch issue to get title before completing
    const issue = getDb().getIssue(args.id);
    if (!issue) {
      return success(
        { completed: false, id: args.id },
        `No issue found with id '${args.id}'`
      );
    }

    // Validate title matches
    if (issue.title !== args.issue_title) {
      throw new ValidationError(`Issue title mismatch: expected '${issue.title}' but got '${args.issue_title}'`);
    }

    const agentId = getCurrentProvider();
    const result = getDb().completeIssue(args.id, agentId, currentSessionId || undefined);
    if (!result) {
      return success(
        { completed: false, id: args.id },
        `No issue found with id '${args.id}'`
      );
    }

    await updateAgentActivity();

    const { issue: completedIssue, unblockedIssues, completedPlanId } = result;

    // Build message parts
    let message = `Completed issue ${completedIssue.shortId || completedIssue.id}: "${completedIssue.title}"`;
    if (unblockedIssues?.length) message += ` (unblocked ${unblockedIssues.length} issue(s))`;
    if (completedPlanId) message += ` [Plan auto-completed: all epics closed]`;

    return success(
      {
        completed: true,
        id: completedIssue.id,
        shortId: completedIssue.shortId,
        title: completedIssue.title,
        status: completedIssue.status,
        closedByAgent: completedIssue.closedByAgent,
        closedAt: completedIssue.closedAt,
        unblocked_issues: unblockedIssues || [],
        completed_plan_id: completedPlanId,
      },
      message
    );
  } catch (err) {
    return error('Failed to complete issue', err);
  }
}

/**
 * Delete an issue permanently
 */
async function handleTaskDelete(args: any) {
  try {
    if (!args?.id) {
      throw new ValidationError('id is required');
    }

    if (!args?.issue_title) {
      throw new ValidationError('issue_title is required');
    }

    // Fetch issue to verify it exists and validate title
    const issue = getDb().getIssue(args.id);
    if (!issue) {
      return success(
        { deleted: false, id: args.id },
        `No issue found with id '${args.id}'`
      );
    }

    // Validate title matches
    if (issue.title !== args.issue_title) {
      throw new ValidationError(`Issue title mismatch: expected '${issue.title}' but got '${args.issue_title}'`);
    }

    const deleted = getDb().deleteIssue(args.id);
    if (!deleted) {
      return success(
        { deleted: false, id: args.id },
        `Failed to delete issue with id '${args.id}'`
      );
    }

    await updateAgentActivity();

    return success(
      {
        deleted: true,
        id: issue.id,
        shortId: issue.shortId,
        title: issue.title,
      },
      `Deleted issue ${issue.shortId || issue.id}: "${issue.title}"`
    );
  } catch (err) {
    return error('Failed to delete issue', err);
  }
}

/**
 * Add a dependency between issues
 */
async function handleTaskAddDependency(args: any) {
  try {
    if (!args?.issueId) {
      throw new ValidationError('issueId is required');
    }
    if (!args?.dependsOnId) {
      throw new ValidationError('dependsOnId is required');
    }
    if (args.dependencyType && !['blocks', 'related', 'parent-child', 'discovered-from'].includes(args.dependencyType)) {
      throw new ValidationError('dependencyType must be one of: blocks, related, parent-child, discovered-from');
    }

    const result = getDb().addDependency(
      args.issueId,
      args.dependsOnId,
      args.dependencyType || 'blocks'
    );

    if (!result) {
      return success(
        { created: false, issueId: args.issueId, dependsOnId: args.dependsOnId },
        'Failed to add dependency - one or both issues not found'
      );
    }

    await updateAgentActivity();

    return success(
      {
        created: result.created,
        issueId: result.issueId,
        dependsOnId: result.dependsOnId,
        dependencyType: result.dependencyType,
        issueBlocked: result.issueBlocked,
      },
      `Added ${result.dependencyType} dependency: ${result.issueShortId} depends on ${result.dependsOnShortId}${result.issueBlocked ? ' (issue now blocked)' : ''}`
    );
  } catch (err) {
    return error('Failed to add dependency', err);
  }
}

/**
 * Remove a dependency between issues
 */
async function handleTaskRemoveDependency(args: any) {
  try {
    if (!args?.issueId) {
      throw new ValidationError('issueId is required');
    }
    if (!args?.dependsOnId) {
      throw new ValidationError('dependsOnId is required');
    }

    const result = getDb().removeDependency(args.issueId, args.dependsOnId);

    await updateAgentActivity();

    return success(
      {
        removed: result.removed,
        issueId: result.issueId,
        dependsOnId: result.dependsOnId,
        issueUnblocked: result.issueUnblocked,
      },
      result.removed
        ? `Removed dependency${result.issueUnblocked ? ' (issue now unblocked)' : ''}`
        : 'Dependency not found'
    );
  } catch (err) {
    return error('Failed to remove dependency', err);
  }
}

/**
 * Add labels to an issue
 */
async function handleTaskAddLabels(args: any) {
  try {
    if (!args?.id) {
      throw new ValidationError('id is required');
    }
    if (!args?.labels || !Array.isArray(args.labels) || args.labels.length === 0) {
      throw new ValidationError('labels must be a non-empty array');
    }

    const result = getDb().addLabels(args.id, args.labels);

    if (!result) {
      return success(
        { issueId: args.id, added: 0 },
        `Issue not found with id '${args.id}'`
      );
    }

    await updateAgentActivity();

    return success(
      {
        issueId: result.issueId,
        shortId: result.shortId,
        labels: result.labels,
        added: result.addedCount,
      },
      `Added ${result.addedCount} label(s) to ${result.shortId}`
    );
  } catch (err) {
    return error('Failed to add labels', err);
  }
}

/**
 * Remove labels from an issue
 */
async function handleTaskRemoveLabels(args: any) {
  try {
    if (!args?.id) {
      throw new ValidationError('id is required');
    }
    if (!args?.labels || !Array.isArray(args.labels) || args.labels.length === 0) {
      throw new ValidationError('labels must be a non-empty array');
    }

    const result = getDb().removeLabels(args.id, args.labels);

    if (!result) {
      return success(
        { issueId: args.id, removed: 0 },
        `Issue not found with id '${args.id}'`
      );
    }

    await updateAgentActivity();

    return success(
      {
        issueId: result.issueId,
        shortId: result.shortId,
        labels: result.labels,
        removed: result.removedCount,
      },
      `Removed ${result.removedCount} label(s) from ${result.shortId}`
    );
  } catch (err) {
    return error('Failed to remove labels', err);
  }
}

/**
 * Claim issues for the current agent
 */
async function handleTaskClaim(args: any) {
  try {
    if (!args?.issue_ids || !Array.isArray(args.issue_ids) || args.issue_ids.length === 0) {
      throw new ValidationError('issue_ids must be a non-empty array');
    }

    const agentId = getCurrentProvider();
    const result = getDb().claimIssues(args.issue_ids, agentId, currentSessionId || undefined);

    await updateAgentActivity();

    return success(
      {
        claimed: result.claimedIssues,
        already_claimed: result.alreadyClaimed,
        not_found: result.notFound,
        your_agent_id: agentId,
      },
      `Claimed ${result.claimedIssues.length} issue(s)`
    );
  } catch (err) {
    return error('Failed to claim issues', err);
  }
}

/**
 * Release issues back to the pool
 */
async function handleTaskRelease(args: any) {
  try {
    if (!args?.issue_ids || !Array.isArray(args.issue_ids) || args.issue_ids.length === 0) {
      throw new ValidationError('issue_ids must be a non-empty array');
    }

    const agentId = getCurrentProvider();
    const result = getDb().releaseIssues(args.issue_ids, agentId);

    await updateAgentActivity();

    return success(
      {
        released: result.releasedIssues,
        not_owned: result.notOwned,
        not_found: result.notFound,
      },
      `Released ${result.releasedIssues.length} issue(s)`
    );
  } catch (err) {
    return error('Failed to release issues', err);
  }
}

/**
 * Get issues that are ready to work on (no blocking dependencies)
 */
async function handleTaskGetReady(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const issues = getDb().getReadyIssues(projectPath, args?.limit);

    return success(
      {
        issues: issues.map((t: Issue) => ({
          id: t.id,
          shortId: t.shortId,
          title: t.title,
          description: t.description,
          priority: t.priority,
          issueType: t.issueType,
          labels: t.labels,
          assignedToAgent: t.assignedToAgent,
          created_at: t.createdAt,
        })),
        count: issues.length,
        project_path: projectPath,
      },
      `Found ${issues.length} ready issue(s)`
    );
  } catch (err) {
    return error('Failed to get ready issues', err);
  }
}

/**
 * Get next block of issues and claim them
 */
async function handleTaskGetNextBlock(args: any) {
  try {
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const agentId = getCurrentProvider();
    const count = args?.count || 3;
    const result = getDb().getNextBlock(projectPath, count, agentId, currentSessionId || undefined);

    await updateAgentActivity();

    return success(
      {
        issues: result.issues.map((t: Issue) => ({
          id: t.id,
          shortId: t.shortId,
          title: t.title,
          description: t.description,
          details: t.details,
          priority: t.priority,
          issueType: t.issueType,
          parentId: t.parentId,
          labels: t.labels,
          status: 'in_progress',
          assignedToAgent: agentId,
          created_at: t.createdAt,
        })),
        claimed_count: result.claimedCount,
        your_agent_id: result.agentId,
      },
      result.claimedCount > 0
        ? `Claimed ${result.claimedCount} issue(s): ${result.issues.map((t: Issue) => t.shortId || t.id).join(', ')}`
        : 'No ready issues available to claim'
    );
  } catch (err) {
    return error('Failed to get next block', err);
  }
}

/**
 * Create multiple issues in a batch with dependencies
 */
async function handleTaskCreateBatch(args: any) {
  try {
    if (!args?.issues || !Array.isArray(args.issues) || args.issues.length === 0) {
      throw new ValidationError('issues must be a non-empty array');
    }

    // Validate issues
    for (let i = 0; i < args.issues.length; i++) {
      const issue = args.issues[i];
      if (!issue.title) {
        throw new ValidationError(`Issue at index ${i} missing required field: title`);
      }
      if (issue.priority !== undefined && (issue.priority < 0 || issue.priority > 4)) {
        throw new ValidationError(`Issue at index ${i} has invalid priority: ${issue.priority}`);
      }
      if (issue.issueType && !['task', 'bug', 'feature', 'epic', 'chore'].includes(issue.issueType)) {
        throw new ValidationError(`Issue at index ${i} has invalid issueType: ${issue.issueType}`);
      }
    }

    // Validate dependencies
    if (args.dependencies && Array.isArray(args.dependencies)) {
      for (let i = 0; i < args.dependencies.length; i++) {
        const dep = args.dependencies[i];
        if (dep.issueIndex === undefined || dep.dependsOnIndex === undefined) {
          throw new ValidationError(`Dependency at index ${i} missing issueIndex or dependsOnIndex`);
        }
        if (dep.issueIndex < 0 || dep.issueIndex >= args.issues.length) {
          throw new ValidationError(`Dependency at index ${i} has invalid issueIndex: ${dep.issueIndex}`);
        }
        if (dep.dependsOnIndex < 0 || dep.dependsOnIndex >= args.issues.length) {
          throw new ValidationError(`Dependency at index ${i} has invalid dependsOnIndex: ${dep.dependsOnIndex}`);
        }
        if (dep.issueIndex === dep.dependsOnIndex) {
          throw new ValidationError(`Dependency at index ${i}: issue cannot depend on itself`);
        }
        if (dep.dependencyType && !['blocks', 'related', 'parent-child', 'discovered-from'].includes(dep.dependencyType)) {
          throw new ValidationError(`Dependency at index ${i} has invalid dependencyType: ${dep.dependencyType}`);
        }
      }
    }

    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const agentId = getCurrentProvider();

    const batchArgs: CreateBatchArgs = {
      issues: args.issues,
      dependencies: args.dependencies,
      planId: args.planId,
    };

    const result = getDb().createBatch(projectPath, batchArgs, agentId, currentSessionId || undefined);

    await updateAgentActivity();

    return success(
      {
        issues: result.issues.map((t: { id: string; shortId: string; title: string; index: number }) => ({
          id: t.id,
          shortId: t.shortId,
          title: t.title,
          index: t.index,
        })),
        dependencies: result.dependencies,
        count: result.count,
        dependency_count: result.dependencyCount,
        project_path: projectPath,
      },
      `Created ${result.count} issue(s): ${result.issues.map((t: { shortId: string }) => t.shortId).join(', ')}`
    );
  } catch (err) {
    return error('Failed to create batch', err);
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

    // Create checkpoint with optional filters
    const checkpoint = getDb().createCheckpoint({
      session_id: sessionId,
      name: validated.name,
      description: validated.description,
      git_status,
      git_branch,
    }, {
      include_tags: validated.include_tags,
      include_keys: validated.include_keys,
      include_categories: validated.include_categories,
      exclude_tags: validated.exclude_tags,
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
    const checkpoint = getDb().createCheckpoint({
      session_id: sessionId,
      name: checkpointName,
      description: 'Automatic checkpoint before context compaction',
      git_status,
      git_branch,
    });

    // Analyze critical context
    const highPriorityItems = getDb().getContextItems(sessionId, {
      priority: 'high',
      limit: COMPACTION_HIGH_PRIORITY_LIMIT,
    });

    const reminders = getDb().getContextItems(sessionId, {
      category: 'reminder',
      limit: COMPACTION_REMINDER_LIMIT,
    });

    const decisions = getDb().getContextItems(sessionId, {
      category: 'decision',
      limit: COMPACTION_DECISION_LIMIT,
    });

    const progress = getDb().getContextItems(sessionId, {
      category: 'progress',
      limit: COMPACTION_PROGRESS_LIMIT,
    });

    // Identify unfinished reminders
    const nextSteps = reminders.filter(
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
      git_context: status
        ? {
            branch: status.branch,
            staged_changes: status.staged_diff ? 'Captured' : 'None',
            modified_files: status.modified.length,
            added_files: status.added.length,
            deleted_files: status.deleted.length,
            untracked_files: status.untracked.length,
            files: [
              ...status.modified.map((f) => `M ${f}`),
              ...status.added.map((f) => `A ${f}`),
              ...status.deleted.map((f) => `D ${f}`),
            ].slice(0, 10),
          }
        : null,
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
    getDb().saveContextItem({
      session_id: sessionId,
      key: `compaction_summary_${checkpoint.id}`,
      value: summaryValue,
      category: 'progress',
      priority: 'high',
      channel: 'system',
      tags: '[]',
      size: summaryValue.length,
    });

    await updateAgentActivity();

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

    // Verify checkpoint exists and name matches
    const checkpoint = validateCheckpointName(
      getDb().getCheckpoint(validated.checkpoint_id),
      validated.checkpoint_id,
      args.checkpoint_name
    );

    // Restore items with optional filters
    const restored = getDb().restoreCheckpoint(validated.checkpoint_id, sessionId, {
      restore_tags: validated.restore_tags,
      restore_categories: validated.restore_categories,
    });

    const filterMsg = validated.restore_tags || validated.restore_categories
      ? ' (filtered)'
      : '';

    return success(
      { restored_items: restored, checkpoint_name: checkpoint.name },
      `Restored ${restored} items from checkpoint '${checkpoint.name}'${filterMsg}`
    );
  } catch (err) {
    return error('Failed to restore checkpoint', err);
  }
}

/**
 * Tag context items for organization and filtering
 */
async function handleTagContextItems(args: any) {
  try {
    const sessionId = ensureSession();
    const validated = validateTagContextItems(args);

    const updated = getDb().tagContextItems(sessionId, {
      keys: validated.keys,
      key_pattern: validated.key_pattern,
      tags: validated.tags,
      action: validated.action,
    });

    // Update agent activity timestamp
    await updateAgentActivity();

    const actionMsg = validated.action === 'add' ? 'Tagged' : 'Untagged';
    const targetMsg = validated.keys
      ? `${validated.keys.length} items`
      : `items matching '${validated.key_pattern}'`;

    return success(
      { updated_count: updated, tags: validated.tags },
      `${actionMsg} ${updated} ${targetMsg} with tags: ${validated.tags.join(', ')}`
    );
  } catch (err) {
    return error('Failed to tag context items', err);
  }
}

/**
 * Add items to an existing checkpoint
 */
async function handleAddItemsToCheckpoint(args: any) {
  try {
    const sessionId = ensureSession();
    const validated = validateCheckpointItemManagement(args);

    // Verify checkpoint exists and name matches
    const checkpoint = validateCheckpointName(
      getDb().getCheckpoint(validated.checkpoint_id),
      validated.checkpoint_id,
      args.checkpoint_name
    );

    const added = getDb().addItemsToCheckpoint(
      validated.checkpoint_id,
      sessionId,
      validated.item_keys
    );

    // Update agent activity timestamp
    await updateAgentActivity();

    return success(
      { added_count: added, checkpoint_name: checkpoint.name },
      `Added ${added} items to checkpoint '${checkpoint.name}'`
    );
  } catch (err) {
    return error('Failed to add items to checkpoint', err);
  }
}

/**
 * Remove items from an existing checkpoint
 */
async function handleRemoveItemsFromCheckpoint(args: any) {
  try {
    const sessionId = ensureSession();
    const validated = validateCheckpointItemManagement(args);

    // Verify checkpoint exists and name matches
    const checkpoint = validateCheckpointName(
      getDb().getCheckpoint(validated.checkpoint_id),
      validated.checkpoint_id,
      args.checkpoint_name
    );

    const removed = getDb().removeItemsFromCheckpoint(
      validated.checkpoint_id,
      sessionId,
      validated.item_keys
    );

    // Update agent activity timestamp
    await updateAgentActivity();

    return success(
      { removed_count: removed, checkpoint_name: checkpoint.name },
      `Removed ${removed} items from checkpoint '${checkpoint.name}'`
    );
  } catch (err) {
    return error('Failed to remove items from checkpoint', err);
  }
}

/**
 * Split a checkpoint into multiple checkpoints based on filters
 */
async function handleSplitCheckpoint(args: any) {
  try {
    ensureSession();
    const validated = validateCheckpointSplit(args);

    // Verify source checkpoint exists
    const sourceCheckpoint = getDb().getCheckpoint(validated.source_checkpoint_id);
    if (!sourceCheckpoint) {
      throw new SaveContextError(
        `Source checkpoint '${validated.source_checkpoint_id}' not found`,
        'NOT_FOUND'
      );
    }

    // Validate name matches
    if (sourceCheckpoint.name !== args.source_checkpoint_name) {
      throw new ValidationError(`Checkpoint name mismatch: expected '${sourceCheckpoint.name}' but got '${args.source_checkpoint_name}'`);
    }

    // Warn if no filters provided
    const hasFilters = validated.splits.some(
      split => (split.include_tags && split.include_tags.length > 0) ||
               (split.include_categories && split.include_categories.length > 0)
    );

    if (!hasFilters) {
      return error(
        'Split requires filters',
        new ValidationError('At least one split must have include_tags or include_categories. Without filters, all items will be duplicated to every checkpoint.')
      );
    }

    const newCheckpoints = getDb().splitCheckpoint(
      validated.source_checkpoint_id,
      validated.splits
    );

    // Warn if any splits resulted in 0 items or same count as source
    const warnings: string[] = [];
    for (const cp of newCheckpoints) {
      if (cp.item_count === 0) {
        warnings.push(`⚠️  Checkpoint '${cp.name}' has 0 items - check your tag/category filters`);
      } else if (cp.item_count === sourceCheckpoint.item_count) {
        warnings.push(`⚠️  Checkpoint '${cp.name}' has ALL ${cp.item_count} items from source - filters may not be working`);
      }
    }

    // Update agent activity timestamp
    await updateAgentActivity();

    return success(
      {
        source_checkpoint: sourceCheckpoint.name,
        new_checkpoints: newCheckpoints.map(cp => ({
          id: cp.id,
          name: cp.name,
          item_count: cp.item_count,
        })),
        warnings: warnings.length > 0 ? warnings : undefined,
      },
      `Split checkpoint '${sourceCheckpoint.name}' into ${newCheckpoints.length} new checkpoints${warnings.length > 0 ? '\n' + warnings.join('\n') : ''}`
    );
  } catch (err) {
    return error('Failed to split checkpoint', err);
  }
}

async function handleDeleteCheckpoint(args: any) {
  try {
    ensureSession();
    const validated = validateDeleteCheckpoint(args);

    // Verify checkpoint exists and name matches
    validateCheckpointName(
      getDb().getCheckpoint(validated.checkpoint_id),
      validated.checkpoint_id,
      args.checkpoint_name
    );

    const deleted = getDb().deleteCheckpoint(validated.checkpoint_id);

    if (!deleted) {
      throw new SaveContextError('Failed to delete checkpoint', 'DELETE_FAILED');
    }

    // Update agent activity timestamp
    await updateAgentActivity();

    return success(
      { checkpoint_id: validated.checkpoint_id, checkpoint_name: args.checkpoint_name },
      `Deleted checkpoint '${args.checkpoint_name}'`
    );
  } catch (err) {
    return error('Failed to delete checkpoint', err);
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
    const countResult = getDb().getDatabase().prepare(countQuery).get(...params) as { total: number };
    const totalMatches = countResult.total;

    // Add ordering and pagination
    query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const checkpoints = getDb().getDatabase().prepare(query).all(...params);

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
    const checkpoint = db!.getCheckpoint(checkpoint_id);
    if (!checkpoint) {
      throw new SaveContextError(`Checkpoint '${checkpoint_id}' not found`, 'NOT_FOUND');
    }

    // Get session info
    const session = getDb().getSession(checkpoint.session_id);

    // Get preview of high-priority items from this checkpoint
    const itemsPreview = getDb().getDatabase()
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

    const session = db!.getSession(currentSessionId);
    if (!session) {
      throw new SessionError('Current session not found');
    }

    const stats = getDb().getSessionStats(currentSessionId);
    const checkpoints = getDb().listCheckpoints(currentSessionId);

    // Calculate session duration
    const endTime = session.ended_at || Date.now();
    const durationMs = endTime - session.created_at;

    // Compaction suggestions
    const itemCount = stats?.total_items || 0;
    const shouldCompact = itemCount >= COMPACTION_ITEM_COUNT_THRESHOLD;
    const compactionReason = shouldCompact
      ? `High item count (${itemCount} items, recommended: prepare at ${COMPACTION_ITEM_COUNT_THRESHOLD}+ items)`
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
    const { current_name, new_name } = args;

    if (!current_name || typeof current_name !== 'string') {
      throw new ValidationError('current_name is required (get from context_status)');
    }

    if (!new_name || typeof new_name !== 'string' || new_name.trim().length === 0) {
      throw new ValidationError('new_name is required and must be a non-empty string');
    }

    // Get current session name for verification
    const session = db!.getDatabase()
      .prepare('SELECT name FROM sessions WHERE id = ?')
      .get(sessionId) as { name: string } | undefined;

    if (!session) {
      throw new ValidationError('Session not found');
    }

    const old_name = session.name;

    // Verify current_name matches
    if (current_name !== old_name) {
      throw new ValidationError(`Current name mismatch: expected '${old_name}', got '${current_name}'`);
    }

    const trimmedName = new_name.trim();

    // Update session name
    db!.getDatabase()
      .prepare('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?')
      .run(trimmedName, Date.now(), sessionId);

    await updateAgentActivity();

    return success(
      { session_id: sessionId, old_name, new_name: trimmedName },
      `Session renamed from '${old_name}' to '${trimmedName}'`
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
    const search = args?.search;

    // Use listSessionsByPaths to properly check session_projects junction table
    // This ensures multi-path sessions appear in all their associated projects
    const sessions = db!.listSessionsByPaths(
      projectPath ? [normalizeProjectPath(projectPath)] : [],
      limit,
      {
        status,
        include_completed: includeCompleted,
        search,
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
    const session = db!.getSession(sessionId);

    if (!session) {
      throw new SessionError('Current session not found');
    }

    // Get stats before ending
    const stats = getDb().getSessionStats(sessionId);
    const checkpoints = getDb().listCheckpoints(sessionId);
    const duration = Date.now() - session.created_at;

    // End the session
    getDb().endSession(sessionId);

    // Clear current session
    currentSessionId = null;

    // Clear status line for Claude Code
    updateStatusLine(null);

    // Clear agent association with this session
    const branch = await getCurrentBranch();
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const provider = getCurrentProvider();
    const agentId = getAgentId(projectPath, branch || 'main', provider);
    getDb().clearCurrentSessionForAgent(agentId);

    // Clear status line for Claude Code
    updateStatusLine(null);

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
    const session = db!.getSession(sessionId);

    if (!session) {
      throw new SessionError('Current session not found');
    }

    // Pause the session
    getDb().pauseSession(sessionId);

    // Clear current session
    currentSessionId = null;

    // Clear agent association with this session
    const branch = await getCurrentBranch();
    const projectPath = normalizeProjectPath(getCurrentProjectPath());
    const provider = getCurrentProvider();
    const agentId = getAgentId(projectPath, branch || 'main', provider);
    getDb().clearCurrentSessionForAgent(agentId);

    // Clear status line for Claude Code
    updateStatusLine(null);

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
    const { session_id, session_name } = args;

    if (!session_id || typeof session_id !== 'string') {
      throw new ValidationError('session_id is required');
    }

    if (!session_name || typeof session_name !== 'string') {
      throw new ValidationError('session_name is required');
    }

    const session = db!.getSession(session_id);
    if (!session) {
      throw new SessionError(`Session '${session_id}' not found`);
    }

    // Validate name matches
    if (session.name !== session_name) {
      throw new ValidationError(`Session name mismatch: expected '${session.name}' but got '${session_name}'`);
    }

    // Resume the session (works for paused or completed sessions)
    getDb().resumeSession(session_id);

    // Set as current session
    currentSessionId = session_id;

    // Update agent activity timestamp
    await updateAgentActivity();

    const stats = getDb().getSessionStats(session_id);

    // Update status line for Claude Code
    updateStatusLine(session, {
      itemCount: stats?.total_items,
      provider: getCurrentProvider(),
      projectPath: normalizeProjectPath(getCurrentProjectPath()),
    });

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
    const { session_id, session_name } = args;

    if (!session_id || typeof session_id !== 'string') {
      throw new ValidationError('session_id is required');
    }

    if (!session_name || typeof session_name !== 'string') {
      throw new ValidationError('session_name is required');
    }

    const targetSession = db!.getSession(session_id);
    if (!targetSession) {
      throw new SessionError(`Session '${session_id}' not found`);
    }

    // Validate name matches
    if (targetSession.name !== session_name) {
      throw new ValidationError(`Session name mismatch: expected '${targetSession.name}' but got '${session_name}'`);
    }

    if (targetSession.status === 'completed') {
      throw new SessionError('Cannot switch to completed session. Create a new session instead.');
    }

    // Pause current session if exists
    let pausedSession = null;
    if (currentSessionId) {
      const current = getDb().getSession(currentSessionId);
      if (current) {
        getDb().pauseSession(currentSessionId);
        pausedSession = current.name;
      }
    }

    // Resume target session
    getDb().resumeSession(session_id);
    currentSessionId = session_id;

    // Update agent-to-session mapping so this agent now points to the new session
    await updateAgentActivity();

    const stats = getDb().getSessionStats(session_id);

    // Update status line for Claude Code
    updateStatusLine(targetSession, { itemCount: stats?.total_items });

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
    const { session_id, session_name } = args;

    if (!session_id || typeof session_id !== 'string') {
      throw new ValidationError('session_id is required');
    }

    if (!session_name || typeof session_name !== 'string') {
      throw new ValidationError('session_name is required');
    }

    const session = db!.getSession(session_id);
    if (!session) {
      throw new SessionError(`Session '${session_id}' not found`);
    }

    // Validate name matches
    if (session.name !== session_name) {
      throw new ValidationError(`Session name mismatch: expected '${session.name}' but got '${session_name}'`);
    }

    // Delete will throw if session is active
    const deleted = getDb().deleteSession(session_id);

    if (deleted) {
      // If we somehow deleted what the status line is showing, clear it (best-effort)
      if (currentSessionId === session_id) {
        updateStatusLine(null);
      }
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
 * Add a project path to a session
 * Enables sessions to span multiple related directories (e.g., monorepo folders)
 */
async function handleSessionAddPath(args: any) {
  try {
    // Validate required fields
    const typedArgs = args as { session_id?: string; session_name?: string; project_path?: string };

    if (!typedArgs?.session_id) {
      throw new ValidationError('session_id is required');
    }
    if (!typedArgs?.session_name) {
      throw new ValidationError('session_name is required');
    }

    const sessionId = typedArgs.session_id;

    // Get project path (default to current directory if not provided)
    const projectPath = typedArgs.project_path
      ? normalizeProjectPath(typedArgs.project_path)
      : normalizeProjectPath(getCurrentProjectPath());

    const session = db!.getSession(sessionId);
    if (!session) {
      throw new SessionError(`Session '${sessionId}' not found`);
    }

    // Verify session name matches
    if (session.name !== typedArgs.session_name) {
      throw new ValidationError(`Session name mismatch: expected '${session.name}' but got '${typedArgs.session_name}'`);
    }

    // Check if path already exists
    const existingPaths = getDb().getSessionPaths(sessionId);
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
    const added = getDb().addProjectPath(sessionId, projectPath);
    if (added) {
      const updatedPaths = getDb().getSessionPaths(sessionId);

      // Update agent activity so the status pill refreshes
      await updateAgentActivity();

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

/**
 * Remove a project path from a session
 * Cannot remove the last path - sessions must have at least one path
 */
async function handleSessionRemovePath(args: unknown) {
  try {
    // Validate required fields
    const typedArgs = args as { session_id?: string; session_name?: string; project_path?: string };

    if (!typedArgs?.project_path) {
      throw new ValidationError('project_path is required');
    }
    if (!typedArgs?.session_id) {
      throw new ValidationError('session_id is required');
    }
    if (!typedArgs?.session_name) {
      throw new ValidationError('session_name is required');
    }

    const sessionId = typedArgs.session_id;
    const projectPath = normalizeProjectPath(typedArgs.project_path);

    const session = db!.getSession(sessionId);
    if (!session) {
      throw new SessionError(`Session '${sessionId}' not found`);
    }

    // Verify session name matches
    if (session.name !== typedArgs.session_name) {
      throw new ValidationError(`Session name mismatch: expected '${session.name}' but got '${typedArgs.session_name}'`);
    }

    // Get current paths
    const existingPaths = getDb().getSessionPaths(sessionId);

    // Check if path exists in session
    if (!existingPaths.includes(projectPath)) {
      return success(
        {
          session_id: sessionId,
          session_name: session.name,
          project_path: projectPath,
          all_paths: existingPaths,
          not_found: true,
        },
        `Path '${projectPath}' not found in session '${session.name}'`
      );
    }

    // removeProjectPath throws if it's the last path
    const removed = getDb().removeProjectPath(sessionId, projectPath);
    if (removed) {
      const updatedPaths = getDb().getSessionPaths(sessionId);

      await updateAgentActivity();

      return success(
        {
          session_id: sessionId,
          session_name: session.name,
          removed_path: projectPath,
          remaining_paths: updatedPaths,
          path_count: updatedPaths.length,
        },
        `Removed path '${projectPath}' from session '${session.name}' (${updatedPaths.length} paths remaining)`
      );
    } else {
      throw new DatabaseError('Failed to remove path from session');
    }
  } catch (err) {
    // Handle the specific error for last path removal
    if (err instanceof DatabaseError && err.message.includes('last project path')) {
      return error('Cannot remove the last path from a session. Sessions must have at least one project path.');
    }
    return error('Failed to remove path from session', err);
  }
}

// ====================
// Plan Handlers
// ====================

async function handlePlanCreate(args: any) {
  try {

    const projectPath = normalizeProjectPath(args?.project_path || getCurrentProjectPath());

    if (!args?.title) {
      throw new ValidationError('title is required');
    }
    if (!args?.content) {
      throw new ValidationError('content is required');
    }
    if (args.status && !['draft', 'active', 'completed'].includes(args.status)) {
      throw new ValidationError('status must be one of: draft, active, completed');
    }

    const plan = db!.createPlan(projectPath, {
      title: args.title,
      content: args.content,
      status: args.status,
      successCriteria: args.successCriteria,
    }, currentSessionId || undefined);

    return success(
      { plan },
      `Created plan '${plan.title}' (${plan.short_id})`
    );
  } catch (err) {
    return error('Failed to create plan', err);
  }
}

async function handlePlanList(args: any) {
  try {

    const projectPath = normalizeProjectPath(args?.project_path || getCurrentProjectPath());

    const plans = db!.listPlans(projectPath, {
      status: args?.status,
      limit: args?.limit,
    });

    return success(
      { plans, count: plans.length },
      `Found ${plans.length} plan(s)`
    );
  } catch (err) {
    return error('Failed to list plans', err);
  }
}

async function handlePlanGet(args: any) {
  try {

    if (!args?.plan_id) {
      throw new ValidationError('plan_id is required');
    }

    const plan = db!.getPlan(args.plan_id);
    if (!plan) {
      throw new ValidationError(`Plan '${args.plan_id}' not found`);
    }

    return success({ plan }, `Retrieved plan '${plan.title}'`);
  } catch (err) {
    return error('Failed to get plan', err);
  }
}

async function handlePlanUpdate(args: any) {
  try {

    if (!args?.id) {
      throw new ValidationError('id is required');
    }
    if (args.status && !['draft', 'active', 'completed'].includes(args.status)) {
      throw new ValidationError('status must be one of: draft, active, completed');
    }

    const plan = db!.updatePlan(args.id, {
      id: args.id,
      title: args.title,
      content: args.content,
      status: args.status,
      successCriteria: args.successCriteria,
      project_path: args.project_path,
    }, currentSessionId || undefined);

    if (!plan) {
      throw new ValidationError(`Plan '${args.id}' not found`);
    }

    const message = args.project_path
      ? `Updated plan '${plan.title}' and cascaded project to linked issues`
      : `Updated plan '${plan.title}'`;

    return success({ plan }, message);
  } catch (err) {
    return error('Failed to update plan', err);
  }
}

// ====================
// MCP Server Handlers
// ====================

/**
 * Generate server instructions based on user configuration
 * These instructions are injected into the AI's system prompt by the MCP client
 */
function generateServerInstructions(): string {
  const { threshold, mode } = compactionConfig;

  const baseInstructions = `SaveContext provides persistent context management across sessions.`;

  const compactionInstructions: Record<CompactionConfig['mode'], string> = {
    auto: `CRITICAL INSTRUCTION: When your conversation context usage reaches ${threshold}% of your context window, ` +
      `you MUST immediately call the 'context_prepare_compaction' tool. ` +
      `This preserves critical context (high-priority items, decisions, active tasks, git status, next steps) automatically. ` +
      `After calling it, simply inform the user "Context preserved at ${threshold}%" and continue working normally.`,

    remind: `When conversation context usage reaches ${threshold}% of your context window, ` +
      `suggest using the 'context_prepare_compaction' tool to preserve important context. ` +
      `Explain briefly what will be preserved: high-priority items, recent decisions, active tasks, git status, and next steps.`,

    manual: `Only use 'context_prepare_compaction' when explicitly requested by the user. ` +
      `Do not proactively monitor or suggest compaction based on context usage.`,
  };

  return `${baseInstructions} ${compactionInstructions[mode]}`;
}

/**
 * Handle MCP initialization - capture client info
 */
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  const rawClientName = request.params.clientInfo?.name || 'unknown';
  const rawClientVersion = request.params.clientInfo?.version || '0.0.0';
  const provider = normalizeClientName(rawClientName);
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

  const instructions = generateServerInstructions();

  return {
    protocolVersion: request.params.protocolVersion,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'savecontext',
      version: VERSION,
    },
    instructions,
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'context_session_start',
        description: 'Start a new coding session or resume existing one. Auto-derives channel from git branch. Call at conversation start or when switching contexts. Use force_new=true to always create a fresh session instead of resuming an existing one. IMPORTANT: Always pass project_path with the specific project folder path (not workspace root). If working in a monorepo or unsure which project folder to use, ask the user before calling this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: SESSION_NAME_MAX_LENGTH,
              description: 'Session name (e.g., "Implementing Authentication")',
            },
            description: {
              type: 'string',
              description: 'Session description',
            },
            project_path: {
              type: 'string',
              description: 'Project folder path. Always pass this to ensure correct project tracking. Ask the user if unsure which folder to use.',
            },
            channel: {
              type: 'string',
              description: 'Optional channel name (auto-derived from git branch if not provided)',
            },
            force_new: {
              type: 'boolean',
              description: 'Force create a new session instead of resuming existing one. Use when you want to start fresh.',
            },
          },
          required: ['name', 'description'],
        },
      },
      {
        name: 'context_save',
        description: 'Save individual context items (decisions, reminders, notes, progress). Use frequently to capture important information. Supports categories (reminder/decision/progress/note) and priorities (high/normal/low).',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Unique key for this context item (e.g., "current_task", "auth_decision")',
            },
            value: {
              type: 'string',
              maxLength: CONTEXT_VALUE_MAX_LENGTH,
              description: 'The context value to save (max 100KB)',
            },
            category: {
              type: 'string',
              enum: ['reminder', 'decision', 'progress', 'note'],
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
        description: 'Retrieve saved context items. PREFER using query param for semantic search when looking for specific information - searches item values by meaning. Use key for exact retrieval, or filters (category, priority) when browsing.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'RECOMMENDED: Semantic search query to find items by meaning (e.g., "how did we handle authentication"). Cloud mode uses AI-powered search; local mode uses keyword fallback.',
            },
            search_all_sessions: {
              type: 'boolean',
              description: 'When using query, search across ALL your sessions (default: false, searches current session only)',
            },
            threshold: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Semantic search threshold (0-1). Lower = more results. Default: 0.5. Only applies to cloud mode.',
            },
            key: {
              type: 'string',
              description: 'Exact key to retrieve a specific item (bypasses search)',
            },
            category: {
              type: 'string',
              enum: ['reminder', 'decision', 'progress', 'note'],
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
              minimum: 1,
              maximum: CONTEXT_ITEMS_MAX_LIMIT,
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
              enum: ['reminder', 'decision', 'progress', 'note'],
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
      // Project CRUD tools
      {
        name: 'context_project_create',
        description: 'Create a new project. Projects must be created before starting sessions. Use this to set up a new codebase with custom name, description, and issue prefix.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the project directory',
            },
            name: {
              type: 'string',
              description: 'Project display name (defaults to folder name)',
            },
            description: {
              type: 'string',
              description: 'Project description',
            },
            issue_prefix: {
              type: 'string',
              description: 'Prefix for issue IDs (e.g., "SC" creates SC-1, SC-2). Defaults to first 4 chars of name.',
            },
          },
          required: ['project_path'],
        },
      },
      {
        name: 'context_project_list',
        description: 'List all projects with optional session counts.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum projects to return (default: 50)',
            },
            include_session_count: {
              type: 'boolean',
              description: 'Include count of sessions per project (default: false)',
            },
          },
        },
      },
      {
        name: 'context_project_get',
        description: 'Get details of a specific project by path.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the project directory',
            },
          },
          required: ['project_path'],
        },
      },
      {
        name: 'context_project_update',
        description: 'Update project settings (name, description, issue prefix).',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the project directory',
            },
            name: {
              type: 'string',
              description: 'New project name',
            },
            description: {
              type: 'string',
              description: 'New project description',
            },
            issue_prefix: {
              type: 'string',
              description: 'New prefix for issue IDs',
            },
          },
          required: ['project_path'],
        },
      },
      {
        name: 'context_project_delete',
        description: 'Delete a project and all associated data (issues, plans, memory). Sessions are unlinked but not deleted. Requires confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the project directory',
            },
            confirm: {
              type: 'boolean',
              description: 'Must be true to confirm deletion',
            },
          },
          required: ['project_path', 'confirm'],
        },
      },
      {
        name: 'context_issue_create',
        description: 'Create a new issue for the current project. Can link to a Plan for tracking implementation of PRDs/specs. Issues persist across sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Issue title',
            },
            description: {
              type: 'string',
              description: 'Optional issue description',
            },
            details: {
              type: 'string',
              description: 'Implementation details or notes',
            },
            priority: {
              type: 'number',
              minimum: 0,
              maximum: 4,
              description: 'Priority level: 0=lowest, 1=low, 2=medium (default), 3=high, 4=critical',
            },
            issueType: {
              type: 'string',
              enum: ['task', 'bug', 'feature', 'epic', 'chore'],
              description: 'Type of issue (default: task)',
            },
            parentId: {
              type: 'string',
              description: 'Parent issue ID for subtasks',
            },
            planId: {
              type: 'string',
              description: 'Link issue to a Plan (PRD/spec). Use context_plan_list to find plan IDs.',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels/tags for categorization',
            },
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'blocked', 'closed', 'deferred'],
              description: 'Initial status (default: open)',
            },
          },
          required: ['title'],
        },
      },
      {
        name: 'context_issue_update',
        description: 'Update an existing issue (title, description, status, priority, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID to update',
            },
            issue_title: {
              type: 'string',
              description: 'Current issue title (for verification and display)',
            },
            title: {
              type: 'string',
              description: 'New issue title',
            },
            description: {
              type: 'string',
              description: 'New issue description',
            },
            details: {
              type: 'string',
              description: 'New implementation details',
            },
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'blocked', 'closed', 'deferred'],
              description: 'New issue status',
            },
            priority: {
              type: 'number',
              minimum: 0,
              maximum: 4,
              description: 'New priority level (0-4)',
            },
            issueType: {
              type: 'string',
              enum: ['task', 'bug', 'feature', 'epic', 'chore'],
              description: 'New issue type',
            },
            parentId: {
              type: 'string',
              description: 'New parent issue ID (or null to remove)',
            },
            planId: {
              type: 'string',
              description: 'Link issue to a Plan (or null to remove link)',
            },
            add_project_path: {
              type: 'string',
              description: 'Add issue to an additional project path (multi-project support). The issue will appear when querying from this project.',
            },
            remove_project_path: {
              type: 'string',
              description: 'Remove issue from an additional project path. Cannot remove the primary project path.',
            },
          },
          required: ['id', 'issue_title'],
        },
      },
      {
        name: 'context_issue_list',
        description: 'List issues for current project with advanced filtering and sorting.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'blocked', 'closed', 'deferred'],
              description: 'Filter by status',
            },
            priority: {
              type: 'number',
              description: 'Filter by exact priority (0-4)',
            },
            priority_min: {
              type: 'number',
              description: 'Filter by minimum priority',
            },
            priority_max: {
              type: 'number',
              description: 'Filter by maximum priority',
            },
            issueType: {
              type: 'string',
              enum: ['task', 'bug', 'feature', 'epic', 'chore'],
              description: 'Filter by issue type',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by labels (all must match)',
            },
            labels_any: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by labels (any must match)',
            },
            parentId: {
              type: 'string',
              description: 'Filter by parent issue ID',
            },
            planId: {
              type: 'string',
              description: 'Filter by plan ID (show issues linked to a plan)',
            },
            has_subtasks: {
              type: 'boolean',
              description: 'Filter issues with/without subtasks',
            },
            has_dependencies: {
              type: 'boolean',
              description: 'Filter issues with/without dependencies',
            },
            sortBy: {
              type: 'string',
              enum: ['priority', 'createdAt', 'updatedAt'],
              description: 'Sort field (default: createdAt)',
            },
            sortOrder: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort order (default: desc)',
            },
            limit: {
              type: 'number',
              description: 'Maximum issues to return',
            },
            all_projects: {
              type: 'boolean',
              description: 'Search across all projects instead of just current project (default: false)',
            },
          },
        },
      },
      {
        name: 'context_issue_complete',
        description: 'Mark an issue as complete (closed). Automatically unblocks dependent issues.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID to mark as closed',
            },
            issue_title: {
              type: 'string',
              description: 'Issue title (for verification and display)',
            },
          },
          required: ['id', 'issue_title'],
        },
      },
      {
        name: 'context_issue_delete',
        description: 'Delete an issue permanently. Also removes all dependencies. Cannot be undone. Requires issue_id and issue_title.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID to delete',
            },
            issue_title: {
              type: 'string',
              description: 'Issue title (for verification and display)',
            },
          },
          required: ['id', 'issue_title'],
        },
      },
      {
        name: 'context_issue_add_dependency',
        description: 'Add a dependency between issues. The issue will depend on another issue.',
        inputSchema: {
          type: 'object',
          properties: {
            issueId: {
              type: 'string',
              description: 'ID of the issue that will have the dependency',
            },
            dependsOnId: {
              type: 'string',
              description: 'ID of the issue it depends on',
            },
            dependencyType: {
              type: 'string',
              enum: ['blocks', 'related', 'parent-child', 'discovered-from'],
              description: 'Type of dependency (default: blocks)',
            },
          },
          required: ['issueId', 'dependsOnId'],
        },
      },
      {
        name: 'context_issue_remove_dependency',
        description: 'Remove a dependency between issues.',
        inputSchema: {
          type: 'object',
          properties: {
            issueId: {
              type: 'string',
              description: 'ID of the issue with the dependency',
            },
            dependsOnId: {
              type: 'string',
              description: 'ID of the issue it depends on',
            },
          },
          required: ['issueId', 'dependsOnId'],
        },
      },
      {
        name: 'context_issue_add_labels',
        description: 'Add labels to an issue for categorization.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels to add',
            },
          },
          required: ['id', 'labels'],
        },
      },
      {
        name: 'context_issue_remove_labels',
        description: 'Remove labels from an issue.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels to remove',
            },
          },
          required: ['id', 'labels'],
        },
      },
      {
        name: 'context_issue_claim',
        description: 'Claim issues for the current agent. Marks them as in_progress and assigns to you.',
        inputSchema: {
          type: 'object',
          properties: {
            issue_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Issue IDs to claim',
            },
          },
          required: ['issue_ids'],
        },
      },
      {
        name: 'context_issue_release',
        description: 'Release issues back to the pool. Unassigns and sets status to open.',
        inputSchema: {
          type: 'object',
          properties: {
            issue_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Issue IDs to release',
            },
          },
          required: ['issue_ids'],
        },
      },
      {
        name: 'context_issue_get_ready',
        description: 'Get issues that are ready to work on (open, no blocking dependencies, not assigned).',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum issues to return (default: 10)',
            },
            sortBy: {
              type: 'string',
              enum: ['priority', 'createdAt'],
              description: 'Sort field (default: priority)',
            },
          },
        },
      },
      {
        name: 'context_issue_get_next_block',
        description: 'Get next block of ready issues and claim them. Smart issue assignment for agents.',
        inputSchema: {
          type: 'object',
          properties: {
            count: {
              type: 'number',
              description: 'Number of issues to claim (default: 3)',
            },
            priority_min: {
              type: 'number',
              description: 'Minimum priority to consider',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only consider issues with these labels',
            },
          },
        },
      },
      {
        name: 'context_issue_create_batch',
        description: 'Create multiple issues at once with dependencies. Supports linking all issues to a Plan. Useful for creating issue hierarchies from plans.',
        inputSchema: {
          type: 'object',
          properties: {
            planId: {
              type: 'string',
              description: 'Link all issues in batch to a Plan (PRD/spec). Individual issues can override.',
            },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Issue title' },
                  description: { type: 'string', description: 'Issue description' },
                  details: { type: 'string', description: 'Implementation details' },
                  priority: { type: 'number', description: 'Priority 0-4' },
                  issueType: { type: 'string', enum: ['task', 'bug', 'feature', 'epic', 'chore'] },
                  parentId: { type: 'string', description: 'Parent ID or $N reference' },
                  planId: { type: 'string', description: 'Override batch-level planId for this issue' },
                  labels: { type: 'array', items: { type: 'string' } },
                },
                required: ['title'],
              },
              description: 'Array of issues to create',
            },
            dependencies: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  issueIndex: { type: 'number', description: 'Index of issue in array' },
                  dependsOnIndex: { type: 'number', description: 'Index of dependency' },
                  dependencyType: { type: 'string', enum: ['blocks', 'related', 'parent-child', 'discovered-from'] },
                },
                required: ['issueIndex', 'dependsOnIndex'],
              },
              description: 'Dependencies between issues (by array index)',
            },
          },
          required: ['issues'],
        },
      },
      {
        name: 'context_checkpoint',
        description: 'Create named checkpoint snapshot for manual saves. Supports selective checkpoints via filters. Use before major refactors, git branch switches, or experimental changes. For auto-save before context fills up, use context_prepare_compaction instead.',
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
            include_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only include items with these tags',
            },
            include_keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only include items matching these key patterns (supports wildcards like "feature_*")',
            },
            include_categories: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['reminder', 'decision', 'progress', 'note'],
              },
              description: 'Only include items in these categories',
            },
            exclude_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Exclude items with these tags',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'context_restore',
        description: 'Restore session state from checkpoint. Supports selective restoration via filters. Use to continue previous work, recover from mistakes, or restore after context compaction. Requires checkpoint_id and checkpoint_name.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of checkpoint to restore',
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint name (for verification and display)',
            },
            restore_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only restore items with these tags',
            },
            restore_categories: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['reminder', 'decision', 'progress', 'note'],
              },
              description: 'Only restore items in these categories',
            },
          },
          required: ['checkpoint_id', 'checkpoint_name'],
        },
      },
      {
        name: 'context_tag',
        description: 'Tag context items for organization and filtering. Supports tagging by specific keys or wildcard patterns. MUST be used before context_checkpoint_split to tag items by work stream (e.g., tag auth items with "auth", UI items with "ui"). Use context_get to verify items and their keys first, then tag by specific keys (not patterns) for accuracy.',
        inputSchema: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific item keys to tag',
            },
            key_pattern: {
              type: 'string',
              description: 'Wildcard pattern to match keys (e.g., "feature_*")',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to add or remove',
            },
            action: {
              type: 'string',
              enum: ['add', 'remove'],
              description: 'Whether to add or remove the tags',
            },
          },
          required: ['tags', 'action'],
        },
      },
      {
        name: 'context_checkpoint_add_items',
        description: 'Add items to an existing checkpoint. Use to incrementally build up checkpoints or add items you forgot to include. Requires checkpoint_id, checkpoint_name, and item_keys.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to modify',
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint name (for verification and display)',
            },
            item_keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Keys of items to add to the checkpoint',
            },
          },
          required: ['checkpoint_id', 'checkpoint_name', 'item_keys'],
        },
      },
      {
        name: 'context_checkpoint_remove_items',
        description: 'Remove items from an existing checkpoint. Use to fix checkpoints that contain unwanted items or to clean up mixed work streams. Requires checkpoint_id, checkpoint_name, and item_keys.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to modify',
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint name (for verification and display)',
            },
            item_keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Keys of items to remove from the checkpoint',
            },
          },
          required: ['checkpoint_id', 'checkpoint_name', 'item_keys'],
        },
      },
      {
        name: 'context_checkpoint_split',
        description: 'Split a checkpoint into multiple checkpoints based on tags or categories. REQUIRED WORKFLOW: (1) Use context_get_checkpoint to see all items, (2) Use context_tag to tag items by work stream (e.g., "auth", "ui"), (3) Then split using include_tags for each work stream. Each split MUST have include_tags or include_categories - the tool will ERROR if no filters provided. Verify results show expected item counts. Requires source_checkpoint_id, source_checkpoint_name, and splits array.',
        inputSchema: {
          type: 'object',
          properties: {
            source_checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to split',
            },
            source_checkpoint_name: {
              type: 'string',
              description: 'Source checkpoint name (for verification and display)',
            },
            splits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Name for the new checkpoint',
                  },
                  description: {
                    type: 'string',
                    description: 'Optional description',
                  },
                  include_tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Only include items with these tags',
                  },
                  include_categories: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['reminder', 'decision', 'progress', 'note'],
                    },
                    description: 'Only include items in these categories',
                  },
                },
                required: ['name'],
              },
              description: 'Array of split configurations',
            },
          },
          required: ['source_checkpoint_id', 'source_checkpoint_name', 'splits'],
        },
      },
      {
        name: 'context_checkpoint_delete',
        description: 'Delete a checkpoint permanently. Use to clean up failed, duplicate, or unwanted checkpoints. Cannot be undone. Requires checkpoint_id and checkpoint_name.',
        inputSchema: {
          type: 'object',
          properties: {
            checkpoint_id: {
              type: 'string',
              description: 'ID of the checkpoint to delete',
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint name (for verification and display)',
            },
          },
          required: ['checkpoint_id', 'checkpoint_name'],
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
        description: 'Rename current session. Use when initial name wasn\'t descriptive enough or context changed direction. Call context_status first to get the current session name.',
        inputSchema: {
          type: 'object',
          properties: {
            current_name: {
              type: 'string',
              description: 'Current session name (for verification - get from context_status)',
            },
            new_name: {
              type: 'string',
              description: 'New session name',
            },
          },
          required: ['current_name', 'new_name'],
        },
      },
      {
        name: 'context_list_sessions',
        description: 'Find sessions by keyword search or list recent sessions. PREFER using search param when looking for specific sessions - it searches name and description. Only omit search when you need to browse all recent sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description: 'RECOMMENDED: Keyword search on session name and description. Use this first when looking for specific sessions.',
            },
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
        description: 'Resume a previously paused session. Restores session state and sets it as the active session. Cannot resume completed sessions. Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to resume',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['session_id', 'session_name'],
        },
      },
      {
        name: 'context_session_switch',
        description: 'Switch between sessions atomically. Pauses current session (if any) and resumes the specified session. Use when working on multiple projects. Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to switch to',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['session_id', 'session_name'],
        },
      },
      {
        name: 'context_session_delete',
        description: 'Delete a session permanently. Cannot delete active sessions (must pause or end first). Cascade deletes all context items and checkpoints. Use to clean up accidentally created sessions. Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'ID of the session to delete',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['session_id', 'session_name'],
        },
      },
      {
        name: 'context_session_add_path',
        description: 'Add a project path to a session. Enables sessions to span multiple related directories (e.g., monorepo folders like /frontend and /backend, or /app and /dashboard). Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Project path to add (defaults to current working directory)',
            },
            session_id: {
              type: 'string',
              description: 'ID of the session to add path to',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['session_id', 'session_name'],
        },
      },
      {
        name: 'context_session_remove_path',
        description: 'Remove a project path from a session. Cannot remove the last path (sessions must have at least one path). Use to clean up paths that are no longer needed. Requires session_id and session_name.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Project path to remove from the session',
            },
            session_id: {
              type: 'string',
              description: 'ID of the session to remove path from',
            },
            session_name: {
              type: 'string',
              description: 'Name of the session (for verification and display)',
            },
          },
          required: ['project_path', 'session_id', 'session_name'],
        },
      },
      // ====================
      // Plan Tools
      // ====================
      {
        name: 'context_plan_create',
        description: 'Create a new plan (PRD/specification) for the current project. Plans organize work into epics and tasks.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Plan title (e.g., "User Authentication System", "API Redesign")',
            },
            content: {
              type: 'string',
              description: 'Full plan content in markdown format. Include requirements, goals, success criteria.',
            },
            status: {
              type: 'string',
              enum: ['draft', 'active', 'completed'],
              description: 'Plan status (default: draft)',
            },
            successCriteria: {
              type: 'string',
              description: 'Optional success criteria for the plan',
            },
            project_path: {
              type: 'string',
              description: 'Project path (defaults to current directory)',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'context_plan_list',
        description: 'List plans for the current project. Returns plans with their status and epic counts.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['draft', 'active', 'completed', 'all'],
              description: 'Filter by status (default: active plans only)',
            },
            project_path: {
              type: 'string',
              description: 'Project path to filter by',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of plans to return (default: 50)',
            },
          },
        },
      },
      {
        name: 'context_plan_get',
        description: 'Get details of a specific plan including its linked epics.',
        inputSchema: {
          type: 'object',
          properties: {
            plan_id: {
              type: 'string',
              description: 'ID of the plan to retrieve',
            },
          },
          required: ['plan_id'],
        },
      },
      {
        name: 'context_plan_update',
        description: 'Update a plan\'s title, content, status, project, or success criteria. Changing project_path cascades to all linked issues.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID of the plan to update',
            },
            title: {
              type: 'string',
              description: 'New plan title',
            },
            content: {
              type: 'string',
              description: 'New plan content',
            },
            status: {
              type: 'string',
              enum: ['draft', 'active', 'completed'],
              description: 'New plan status',
            },
            successCriteria: {
              type: 'string',
              description: 'New success criteria',
            },
            project_path: {
              type: 'string',
              description: 'New project path. Cascades to all linked issues.',
            },
          },
          required: ['id'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    // Refresh status cache on every tool call to keep it fresh
    try {
      const projectPath = normalizeProjectPath(getCurrentProjectPath());
      const provider = getCurrentProvider();
      if (currentSessionId) {
        const session = db.getSession(currentSessionId);
        if (session) {
          const stats = getDb().getSessionStats(currentSessionId);
          refreshStatusCache(session, { itemCount: stats?.total_items || 0, provider, projectPath });
        }
      }
    } catch {
      // Silently fail - status cache refresh is non-critical
    }

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
      case 'context_project_create':
        return { content: [{ type: 'text', text: JSON.stringify(await handleProjectCreate(args), null, 2) }] };
      case 'context_project_list':
        return { content: [{ type: 'text', text: JSON.stringify(await handleProjectList(args), null, 2) }] };
      case 'context_project_get':
        return { content: [{ type: 'text', text: JSON.stringify(await handleProjectGet(args), null, 2) }] };
      case 'context_project_update':
        return { content: [{ type: 'text', text: JSON.stringify(await handleProjectUpdate(args), null, 2) }] };
      case 'context_project_delete':
        return { content: [{ type: 'text', text: JSON.stringify(await handleProjectDelete(args), null, 2) }] };
      case 'context_issue_create':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskCreate(args), null, 2) }] };
      case 'context_issue_update':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskUpdate(args), null, 2) }] };
      case 'context_issue_list':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskList(args), null, 2) }] };
      case 'context_issue_complete':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskComplete(args), null, 2) }] };
      case 'context_issue_delete':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskDelete(args), null, 2) }] };
      case 'context_issue_add_dependency':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskAddDependency(args), null, 2) }] };
      case 'context_issue_remove_dependency':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskRemoveDependency(args), null, 2) }] };
      case 'context_issue_add_labels':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskAddLabels(args), null, 2) }] };
      case 'context_issue_remove_labels':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskRemoveLabels(args), null, 2) }] };
      case 'context_issue_claim':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskClaim(args), null, 2) }] };
      case 'context_issue_release':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskRelease(args), null, 2) }] };
      case 'context_issue_get_ready':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskGetReady(args), null, 2) }] };
      case 'context_issue_get_next_block':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskGetNextBlock(args), null, 2) }] };
      case 'context_issue_create_batch':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTaskCreateBatch(args), null, 2) }] };
      case 'context_checkpoint':
        return { content: [{ type: 'text', text: JSON.stringify(await handleCreateCheckpoint(args), null, 2) }] };
      case 'context_prepare_compaction':
        return { content: [{ type: 'text', text: JSON.stringify(await handlePrepareCompaction(), null, 2) }] };
      case 'context_restore':
        return { content: [{ type: 'text', text: JSON.stringify(await handleRestoreCheckpoint(args), null, 2) }] };
      case 'context_tag':
        return { content: [{ type: 'text', text: JSON.stringify(await handleTagContextItems(args), null, 2) }] };
      case 'context_checkpoint_add_items':
        return { content: [{ type: 'text', text: JSON.stringify(await handleAddItemsToCheckpoint(args), null, 2) }] };
      case 'context_checkpoint_remove_items':
        return { content: [{ type: 'text', text: JSON.stringify(await handleRemoveItemsFromCheckpoint(args), null, 2) }] };
      case 'context_checkpoint_split':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSplitCheckpoint(args), null, 2) }] };
      case 'context_checkpoint_delete':
        return { content: [{ type: 'text', text: JSON.stringify(await handleDeleteCheckpoint(args), null, 2) }] };
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
      case 'context_session_remove_path':
        return { content: [{ type: 'text', text: JSON.stringify(await handleSessionRemovePath(args), null, 2) }] };
      case 'context_plan_create':
        return { content: [{ type: 'text', text: JSON.stringify(await handlePlanCreate(args), null, 2) }] };
      case 'context_plan_list':
        return { content: [{ type: 'text', text: JSON.stringify(await handlePlanList(args), null, 2) }] };
      case 'context_plan_get':
        return { content: [{ type: 'text', text: JSON.stringify(await handlePlanGet(args), null, 2) }] };
      case 'context_plan_update':
        return { content: [{ type: 'text', text: JSON.stringify(await handlePlanUpdate(args), null, 2) }] };
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
  console.error(`SaveContext MCP Server v${VERSION} (Clean)`);
  console.error('Ready for connections...');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
