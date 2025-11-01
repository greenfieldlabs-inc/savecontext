# SaveContext

SaveContext is a zero-context-loss MCP server that solves a critical problem: AI tools fragment and lose context as you work. They pre-compact conversations, drop important details, and force you to re-explain your project from scratch. SaveContext is your single source of truth—preserving complete, uncompressed context across every tool.

## Why SaveContext?

- **Tracks your codebase** - Git status, recent changes, file structure
- **Maintains memory** - API endpoints, schemas, decisions, patterns
- **Enables seamless switching** - Move between tools without losing context
- **Preserves complete context** - No pre-compaction, no dropped details
- **Works immediately** - Zero configuration for existing projects

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (local or remote)
- pnpm (recommended) or npm

### Installation

```bash
# Clone the repository
git clone https://github.com/greenfieldlabs-inc/savecontext.git
cd savecontext

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL

# Run Prisma migrations
cd db
npx prisma migrate dev
cd ..

# Build the server
cd server
npm run build
cd ..
```

### Configure Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "savecontext": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/savecontext/server/src/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://username@localhost:5432/savecontext_dev",
        "USER_ID": "your-user-id"
      }
    }
  }
}
```

Replace:
- `/absolute/path/to/savecontext` with your actual installation path
- `username` with your PostgreSQL username
- `your-user-id` with a unique identifier

## MCP Tools Available

### Core Context Tools
- `get_project_context` - Full project overview with git status
- `get_recent_changes` - Changes since last session
- `get_file_structure` - Project file tree
- `explain_codebase` - Auto-generated codebase explanation

### Session Management
- `save_session` - Save current conversation state with token counting
- `load_session` - Load previous session
- `compress_context` - Fit context into token limits
- `sync_now` - Force immediate sync (Pro users)
- `get_stats` - Usage statistics and quota information (Pro users)

### Memory System
- `remember` - Store important information (API keys, patterns, decisions)
- `recall` - Retrieve stored information

## Features

### Git-Native Integration
- Tracks branch, uncommitted changes, recent commits
- Understands what changed between sessions
- Provides git context automatically

### Smart Compression
- Keeps recent messages verbatim
- Summarizes older conversations
- Compresses code intelligently
- Respects each tool's token limits

### Persistent Memory
- API endpoints and schemas
- Architecture decisions
- Known bugs and solutions
- User preferences

### Tool-Agnostic
- Works with any MCP-compatible tool
- Adapts format for each tool
- Maintains context across switches

### Secure Storage
- OS keychain integration for API keys
- Encrypted context storage
- Soft delete for GDPR compliance

## Architecture

```
savecontext/
├── server/           # MCP server (TypeScript)
│   └── src/
│       ├── git/      # Git integration
│       ├── context/  # Context building
│       ├── crypto.ts # Secure API key storage
│       ├── sync.ts   # Database synchronization
│       └── queue.ts  # Offline sync queue
├── db/               # Prisma schema and migrations
│   ├── schema.prisma
│   └── migrations/
└── app/              # Next.js dashboard (planned)
```

## Database Schema

SaveContext uses PostgreSQL with Prisma ORM:

- **Users** - Authentication and subscription management
- **Sessions** - Conversation history with token counts
- **SessionFiles** - Searchable file content
- **SessionTasks** - Current work items
- **SessionMemory** - Key-value pairs per session
- **GitSnapshots** - Git state tracking
- **UsageStats** - Daily aggregation for quota management
- **AuditLog** - Security and compliance tracking

## Development

### Running the Server

```bash
# Development mode with auto-reload
cd server
npm run serve

# Production mode
npm run build
npm start
```

### Testing

```bash
# Test local PostgreSQL sync
cd server
node test-sync.mjs
```

### Database Management

```bash
# Generate Prisma client
cd db
npx prisma generate

# Create new migration
npx prisma migrate dev --name migration_name

# View database
npx prisma studio
```

## Roadmap

### Current Status
- Local PostgreSQL storage
- Accurate token counting with tiktoken
- Secure API key management
- Offline sync queue with retry logic
- 10 MCP tools available

### Planned Features
- Cloud synchronization API
- Next.js dashboard for session visualization
- NextAuth integration
- Stripe payment processing
- Enhanced compression with vision models
- Multi-tool integration (Cursor, Factory AI, Copilot)
- Team collaboration features

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT - See [LICENSE](LICENSE) file

## Acknowledgments

Built on top of:
- [Model Context Protocol](https://modelcontextprotocol.io) by Anthropic
- [Prisma](https://www.prisma.io) for database management
- [tiktoken](https://github.com/openai/tiktoken) for accurate token counting

---

**Issues:** [github.com/greenfieldlabs-inc/savecontext/issues](https://github.com/greenfieldlabs-inc/savecontext/issues)

**Discussions:** [github.com/greenfieldlabs-inc/savecontext/discussions](https://github.com/greenfieldlabs-inc/savecontext/discussions)
