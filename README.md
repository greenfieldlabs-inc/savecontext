# ContextKeeper 🧠

> MCP Server for zero-context-loss AI tool switching
> 
> **Status:** Self-hosting! ContextKeeper is now running on itself during development.

## The Problem

Every time you switch between AI coding tools (Claude Desktop, Factory AI, Cursor, Copilot), you lose context. You have to re-explain your project, rebuild the conversation, and hope the new tool understands what you were doing.

## The Solution

ContextKeeper is an MCP (Model Context Protocol) server that maintains persistent context across all your AI tools. It automatically:

- **Tracks your codebase** - Git status, recent changes, file structure
- **Maintains memory** - API endpoints, schemas, decisions, patterns
- **Enables seamless switching** - Move between tools without losing context
- **Compresses intelligently** - Fits context into each tool's token limits
- **Works immediately** - Zero configuration for existing projects

## Quick Start

### 1. Install

```bash
npm install -g contextkeeper
# or use directly with npx
npx contextkeeper init
```

### 2. Initialize in your project

```bash
cd your-project
npx contextkeeper init
```

This creates:
- `.contextkeeper/` - Local context storage
- Configuration for Claude Desktop

### 3. Start the MCP server

```bash
npx contextkeeper serve
```

### 4. Connect from Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "contextkeeper": {
      "command": "npx",
      "args": ["contextkeeper", "serve"],
      "env": {
        "PROJECT_PATH": "/path/to/your/project"
      }
    }
  }
}
```

## How It Works

When you connect an AI tool to your project, ContextKeeper:

1. **Detects your environment** - Git repo, languages, frameworks
2. **Builds context automatically** - Recent changes, file structure, project profile
3. **Streams to the AI tool** - No manual explanation needed
4. **Maintains continuity** - Saves sessions for seamless switching

### Example Workflow

```
# Working in Claude Desktop
User: "Help me refactor the auth middleware"
Claude: [works on auth.ts, makes changes]

# Switch to Factory AI (better for testing)
# ContextKeeper automatically provides:
# - What Claude just changed
# - Current git diff
# - Project context
# - Conversation summary

# In Factory AI
User: "Write tests for the refactored auth"
Factory: "I see you just refactored the auth middleware. Let me write comprehensive tests..."
```

## MCP Tools Available

### Core Context Tools
- `get_project_context` - Full project overview with git status
- `get_recent_changes` - Changes since last session
- `get_file_structure` - Project file tree
- `explain_codebase` - Auto-generated codebase explanation

### Session Management
- `save_session` - Save current conversation state
- `load_session` - Load previous session
- `compress_context` - Fit context into token limits

### Memory System
- `remember` - Store important information (API keys, patterns, decisions)
- `recall` - Retrieve stored information
- `list_memories` - See all stored memories

## Features

### 🔧 Git-Native Integration
- Tracks branch, uncommitted changes, recent commits
- Understands what changed between sessions
- Provides git context automatically

### 🧠 Smart Compression
- Keeps recent messages verbatim
- Summarizes older conversations
- Compresses code intelligently
- Respects each tool's token limits

### 💾 Persistent Memory
- API endpoints and schemas
- Architecture decisions
- Known bugs and solutions
- User preferences

### 🔄 Tool-Agnostic
- Works with any MCP-compatible tool
- Adapts format for each tool
- Maintains context across switches

## Architecture

```
Your Project
    ├── .git/                 # Git repository
    ├── .contextkeeper/       # Local context storage
    │   ├── profile.json      # Project profile
    │   └── claude_desktop_config.json
    │
    └── [Your code files]

~/.contextkeeper/             # Global storage
    └── contextkeeper.db      # SQLite database
        ├── sessions          # Conversation history
        ├── memories          # Persistent knowledge
        └── git_snapshots     # Git state tracking
```

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/contextkeeper
cd contextkeeper

# Install dependencies
npm install

# Build
npm run build
```

### Project Structure

```
contextkeeper/
├── server/           # MCP server (TypeScript)
│   └── src/
│       ├── git/     # Git integration
│       ├── context/ # Context building
│       └── compression/
├── cli/             # CLI tool
└── src/             # Python compression (from research)
```

## Roadmap

### Phase 1: Core (Current)
- ✅ Git integration
- ✅ Session management
- ✅ Text compression
- ✅ Memory system
- ✅ Claude Desktop support

### Phase 2: Enhanced Compression
- [ ] Vision compression for large files (using Qwen research)
- [ ] LLM-powered summarization
- [ ] Incremental updates
- [ ] Smart caching

### Phase 3: More Tools
- [ ] Cursor integration
- [ ] Factory AI support
- [ ] Copilot compatibility
- [ ] VS Code extension

### Phase 4: Team Features
- [ ] Shared project contexts
- [ ] Team memories
- [ ] Hosted service option
- [ ] Analytics dashboard

## Contributing

Contributions welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

## License

MIT - See [LICENSE](LICENSE) file

## Acknowledgments

Built on top of:
- [Model Context Protocol](https://modelcontextprotocol.io) by Anthropic
- Research on visual compression for code understanding
- Community feedback and contributions

---

**Problem?** Open an issue: [github.com/yourusername/contextkeeper/issues](https://github.com/yourusername/contextkeeper/issues)

**Questions?** Start a discussion: [github.com/yourusername/contextkeeper/discussions](https://github.com/yourusername/contextkeeper/discussions)
