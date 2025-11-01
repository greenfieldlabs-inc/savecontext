#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GitManager } from "./git/GitManager.js";
import { ContextBuilder } from "./context/ContextBuilder.js";
import { SessionManager } from "./context/SessionManager.js";
import { CompressionEngine } from "./compression/CompressionEngine.js";
import { countTokens, countMessageTokens, countContextTokens, formatTokenCount } from "./token-counter.js";
import { syncSessionToCloud, isProUser, getUsageStats } from "./sync.js";
import { syncQueue } from "./queue.js";
import { storeApiKey, getApiKey } from "./crypto.js";
import path from "path";
import fs from "fs/promises";

// Get project path from environment or current directory
const PROJECT_PATH = process.env.PROJECT_PATH || process.cwd();

// Initialize managers
const gitManager = new GitManager(PROJECT_PATH);
const contextBuilder = new ContextBuilder(PROJECT_PATH);
const sessionManager = new SessionManager(PROJECT_PATH);
const compressionEngine = new CompressionEngine();

// Create MCP server
const server = new McpServer({
  name: "savecontext",
  version: "0.1.0"
});

// Register tool: get_project_context
server.registerTool(
  "get_project_context",
  {
    description: "Get complete project context including git status, recent changes, and file structure",
    inputSchema: {
      include_uncommitted: z.boolean().optional().describe("Include uncommitted changes"),
      max_commits: z.number().optional().default(10).describe("Number of recent commits to include"),
    }
  },
  async (args) => {
    const gitStatus = await gitManager.getStatus();
    const recentCommits = await gitManager.getRecentCommits(args.max_commits || 10);
    const fileStructure = await contextBuilder.getFileStructure({});
    const profile = await contextBuilder.getProjectProfile();
    
    const context = {
      project_path: PROJECT_PATH,
      git: {
        branch: gitStatus.branch,
        status: gitStatus.status,
        recent_commits: recentCommits,
        has_uncommitted_changes: gitStatus.hasChanges,
      },
      structure: fileStructure,
      profile: profile,
      timestamp: new Date().toISOString(),
    };
    
    if (args.include_uncommitted && gitStatus.hasChanges) {
      (context.git as any).uncommitted = await gitManager.getUncommittedChanges();
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(context, null, 2),
        },
      ],
    };
  }
);

// Register tool: get_recent_changes
server.registerTool(
  "get_recent_changes",
  {
    description: "Get changes since last session or specified time",
    inputSchema: {
      since: z.string().optional().describe("Time reference (e.g., '1 hour ago', 'last-session')"),
    }
  },
  async (args) => {
    const changes = await gitManager.getChangesSince(args.since || "1 hour ago");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(changes, null, 2),
        },
      ],
    };
  }
);

// Register tool: save_session (ENHANCED with token counting and cloud sync)
server.registerTool(
  "save_session",
  {
    description: "Save current session state with accurate token counting and cloud sync for Pro users",
    inputSchema: {
      session_id: z.string().optional(),
      user_id: z.string().optional(),
      tool: z.string().optional(),
      timestamp: z.string().optional(),
      project: z.object({
        name: z.string().optional(),
        path: z.string().optional(),
        languages: z.array(z.string()).optional(),
      }).optional(),
      conversation: z.object({
        messages: z.array(z.any()).optional(),
      }).optional(),
      user_prompt: z.string().optional(),
      git: z.object({
        branch: z.string().optional(),
        status: z.string().optional(),
        last_commit: z.object({
          hash: z.string().optional(),
          message: z.string().optional(),
        }).optional(),
        uncommitted_diff: z.string().optional(),
      }).optional(),
      platform_data: z.object({
        session_id: z.string().optional(),
        permission_mode: z.string().optional(),
        is_remote: z.boolean().optional(),
      }).optional(),
      // Legacy support
      messages: z.array(z.any()).optional(),
      metadata: z.record(z.any()).optional(),
    }
  },
  async (args) => {
    // Extract messages from either conversation.messages or legacy messages field
    const messages = args.conversation?.messages || args.messages || [];

    // Calculate accurate token count
    const tokenCount = messages.length > 0
      ? countMessageTokens(messages)
      : 0;

    // Build comprehensive metadata
    const metadata = {
      ...args.metadata,
      tokenCount,
      tokenCountFormatted: formatTokenCount(tokenCount),
      tool: args.tool || process.env.MCP_TOOL || 'unknown',
      userPrompt: args.user_prompt,
      platformData: args.platform_data,
    };

    // Build git snapshot from hook data or fallback to gitManager
    const git_snapshot = args.git || await gitManager.getStatus();

    // Save to local database
    const sessionId = args.session_id || args.platform_data?.session_id || await sessionManager.saveSession({
      messages,
      metadata,
      git_snapshot,
    });

    // Try to sync to cloud if Pro user
    const userId = args.user_id || process.env.USER_ID || 'local-user';
    const isPro = await isProUser(userId);

    let syncStatus = 'local-only (Free tier)';

    if (isPro) {
      const projectName = args.project?.name || path.basename(args.project?.path || PROJECT_PATH);

      const syncResult = await syncSessionToCloud({
        id: sessionId,
        userId,
        projectName,
        toolUsed: args.tool || process.env.MCP_TOOL || 'unknown',
        tokenCount,
        context: { messages, metadata, git: git_snapshot, project: args.project },
        metadata,
        createdAt: new Date(args.timestamp || Date.now()),
      });

      if (syncResult.success) {
        syncStatus = '✓ synced to cloud';
      } else {
        // Add to offline queue
        await syncQueue.add({
          id: sessionId,
          userId,
          projectName,
          toolUsed: args.tool || process.env.MCP_TOOL || 'unknown',
          tokenCount,
          context: { messages, metadata, git: git_snapshot, project: args.project },
          metadata,
          createdAt: new Date(args.timestamp || Date.now()),
        }, syncResult.error);
        syncStatus = '⏳ queued for sync';
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Session saved: ${sessionId}\nTokens: ${formatTokenCount(tokenCount)}\nStatus: ${syncStatus}`,
        },
      ],
    };
  }
);

// Register tool: load_session
server.registerTool(
  "load_session",
  {
    description: "Load a previous session",
    inputSchema: {
      session_id: z.string().optional().describe("Session ID to load, or latest if not specified"),
    }
  },
  async (args) => {
    const session = await sessionManager.loadSession(args.session_id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(session, null, 2),
        },
      ],
    };
  }
);

// Register tool: remember
server.registerTool(
  "remember",
  {
    description: "Add something to project memory",
    inputSchema: {
      key: z.string().describe("Memory key (e.g., 'api_endpoint', 'db_schema')"),
      value: z.any().describe("Value to remember"),
      type: z.enum(["api", "schema", "decision", "bug", "credential", "pattern", "other"]).optional(),
    }
  },
  async (args) => {
    await sessionManager.addMemory(args.key, args.value, args.type || "other");
    return {
      content: [
        {
          type: "text",
          text: `Remembered: ${args.key}`,
        },
      ],
    };
  }
);

// Register tool: recall
server.registerTool(
  "recall",
  {
    description: "Retrieve something from project memory",
    inputSchema: {
      key: z.string().describe("Memory key to retrieve"),
    }
  },
  async (args) => {
    const memory = await sessionManager.getMemory(args.key);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(memory, null, 2),
        },
      ],
    };
  }
);

// Register tool: compress_context
server.registerTool(
  "compress_context",
  {
    description: "Compress context to fit within token limit",
    inputSchema: {
      context: z.any().describe("Context to compress"),
      target_tokens: z.number().describe("Target token count"),
      provider: z.enum(["claude", "cursor", "factory", "copilot"]).optional(),
    }
  },
  async (args) => {
    const compressed = await compressionEngine.compress(
      args.context,
      args.target_tokens,
      args.provider
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(compressed, null, 2),
        },
      ],
    };
  }
);

// Register tool: get_file_structure
server.registerTool(
  "get_file_structure",
  {
    description: "Get project file structure",
    inputSchema: {
      max_depth: z.number().optional().default(3).describe("Maximum directory depth"),
      include_hidden: z.boolean().optional().default(false),
    }
  },
  async (args) => {
    const structure = await contextBuilder.getFileStructure(args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(structure, null, 2),
        },
      ],
    };
  }
);

// Register tool: sync_now (Pro only)
server.registerTool(
  "sync_now",
  {
    description: "Force immediate sync of all pending sessions to cloud (Pro users only)",
    inputSchema: {}
  },
  async () => {
    const userId = process.env.USER_ID || 'local-user';
    const isPro = await isProUser(userId);

    if (!isPro) {
      return {
        content: [
          {
            type: "text",
            text: "⚠️  This feature requires a Pro subscription.\nUpgrade at https://savecontext.io/pricing",
          },
        ],
      };
    }

    const result = await syncQueue.syncNow();
    const queueStatus = syncQueue.getStatus();

    return {
      content: [
        {
          type: "text",
          text: `✓ Sync completed\n\nSynced: ${result.synced} sessions\nFailed: ${result.failed} sessions\nQueue status: ${queueStatus.total} total, ${queueStatus.ready} ready, ${queueStatus.failed} permanently failed`,
        },
      ],
    };
  }
);

// Register tool: get_stats (Pro only)
server.registerTool(
  "get_stats",
  {
    description: "Get usage statistics and quota information (Pro users only)",
    inputSchema: {}
  },
  async () => {
    const userId = process.env.USER_ID || 'local-user';
    const isPro = await isProUser(userId);

    if (!isPro) {
      return {
        content: [
          {
            type: "text",
            text: "⚠️  This feature requires a Pro subscription.\nUpgrade at https://savecontext.io/pricing",
          },
        ],
      };
    }

    const stats = await getUsageStats(userId);

    if (!stats) {
      return {
        content: [
          {
            type: "text",
            text: "❌ Failed to fetch usage statistics from cloud.\nCheck your API key and internet connection.",
          },
        ],
      };
    }

    const quotaPercentage = ((1000000 - stats.quotaRemaining) / 1000000) * 100;

    return {
      content: [
        {
          type: "text",
          text: `📊 Usage Statistics

Today:
  Sessions: ${stats.today.sessions}
  Tokens: ${formatTokenCount(stats.today.tokens)}

This Week:
  Sessions: ${stats.thisWeek.sessions}
  Tokens: ${formatTokenCount(stats.thisWeek.tokens)}

Daily Quota:
  Used: ${formatTokenCount(1000000 - stats.quotaRemaining)} (${quotaPercentage.toFixed(1)}%)
  Remaining: ${formatTokenCount(stats.quotaRemaining)}
  Limit: ${formatTokenCount(1000000)}`,
        },
      ],
    };
  }
);

// Register tool: explain_codebase
server.registerTool(
  "explain_codebase",
  {
    description: "Generate an automatic explanation of the codebase structure and purpose",
    inputSchema: {
      focus_areas: z.array(z.string()).optional().describe("Specific areas to focus on"),
    }
  },
  async (args) => {
    const explanation = await contextBuilder.explainCodebase(args.focus_areas);
    return {
      content: [
        {
          type: "text",
          text: explanation,
        },
      ],
    };
  }
);

// Initialize server on startup
async function initialize() {
  process.stderr.write(`SaveContext MCP Server v0.1.0 (Enhanced)\n`);
  process.stderr.write(`Project: ${PROJECT_PATH}\n`);

  // Check if git repository
  const isGitRepo = await gitManager.isGitRepository();
  if (!isGitRepo) {
    process.stderr.write("Warning: Not a git repository. Git features will be limited.\n");
  }

  // Initialize session manager
  await sessionManager.initialize();

  // Initialize sync queue (for offline sync)
  await syncQueue.initialize();
  process.stderr.write("✓ Sync queue initialized\n");

  // Check Pro status
  const userId = process.env.USER_ID || 'local-user';
  const isPro = await isProUser(userId);
  if (isPro) {
    process.stderr.write("✓ Pro user detected - cloud sync enabled\n");
  } else {
    process.stderr.write("ℹ Free tier - local storage only. Upgrade at https://savecontext.io/pricing\n");
  }

  // Check for existing .claude/sessions and offer to migrate
  const claudePath = path.join(PROJECT_PATH, ".claude/sessions");
  try {
    await fs.access(claudePath);
    process.stderr.write(`Found existing .claude/sessions - these will be accessible via load_session\n`);
  } catch {
    // No existing sessions
  }

  process.stderr.write("✓ Server ready for connections\n");
}

// Start server
async function main() {
  await initialize();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`Server error: ${error}\n`);
  process.exit(1);
});
