#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GitManager } from "./git/GitManager.js";
import { ContextBuilder } from "./context/ContextBuilder.js";
import { SessionManager } from "./context/SessionManager.js";
import { CompressionEngine } from "./compression/CompressionEngine.js";
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
  name: "contextkeeper",
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

// Register tool: save_session
server.registerTool(
  "save_session",
  {
    description: "Save current session state",
    inputSchema: {
      messages: z.array(z.any()).optional(),
      metadata: z.record(z.any()).optional(),
    }
  },
  async (args) => {
    const sessionId = await sessionManager.saveSession({
      messages: args.messages || [],
      metadata: args.metadata || {},
      git_snapshot: await gitManager.getStatus(),
    });
    
    return {
      content: [
        {
          type: "text",
          text: `Session saved: ${sessionId}`,
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
  process.stderr.write(`ContextKeeper MCP Server v0.1.0\n`);
  process.stderr.write(`Project: ${PROJECT_PATH}\n`);
  
  // Check if git repository
  const isGitRepo = await gitManager.isGitRepository();
  if (!isGitRepo) {
    process.stderr.write("Warning: Not a git repository. Git features will be limited.\n");
  }
  
  // Initialize session manager
  await sessionManager.initialize();
  
  // Check for existing .claude/sessions and offer to migrate
  const claudePath = path.join(PROJECT_PATH, ".claude/sessions");
  try {
    await fs.access(claudePath);
    process.stderr.write(`Found existing .claude/sessions - these will be accessible via load_session\n`);
  } catch {
    // No existing sessions
  }
  
  process.stderr.write("Server ready for connections\n");
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
