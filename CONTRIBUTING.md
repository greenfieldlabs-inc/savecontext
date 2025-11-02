# Contributing to SaveContext

Thank you for your interest in contributing to SaveContext! We welcome contributions from the community.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm (recommended) or npm

### Setup

1. Fork the repository
2. Clone your fork:
```bash
git clone https://github.com/YOUR_USERNAME/savecontext.git
cd savecontext
```

3. Install dependencies:
```bash
cd server
pnpm install
```

4. Build the project:
```bash
pnpm build
```

5. Run in development mode:
```bash
pnpm dev
```

## Development Workflow

### Making Changes

1. Create a new branch for your feature/fix:
```bash
git checkout -b feature/your-feature-name
```

2. Make your changes
3. Test your changes:
```bash
pnpm build
pnpm test
```

4. Commit your changes:
```bash
git add .
git commit -m "feat: description of your feature"
```

We follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test additions or changes
- `chore:` - Maintenance tasks

### Submitting a Pull Request

1. Push to your fork:
```bash
git push origin feature/your-feature-name
```

2. Open a Pull Request on GitHub
3. Describe your changes and link any related issues
4. Wait for review and address any feedback

## Code Standards

- Use TypeScript for all code
- Follow existing code style
- Add comments for complex logic
- Update documentation for user-facing changes
- Ensure all types are properly defined

## Testing

Before submitting:
- Build succeeds: `pnpm build`
- No TypeScript errors
- Test locally with an MCP client (Claude Code, Cursor, etc.)

## Project Structure

```
savecontext/
├── server/                 # MCP Server
│   ├── src/
│   │   ├── index.ts       # Main server entry
│   │   ├── database/      # SQLite database layer
│   │   ├── utils/         # Utility functions
│   │   └── types/         # TypeScript types
│   └── dist/              # Built output
├── LICENSE                 # MIT License
└── README.md              # Documentation
```

## Feature Requests

Have an idea? Open an issue with:
- Clear description of the feature
- Use cases
- Potential implementation approach

## Bug Reports

Found a bug? Open an issue with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (OS, Node version, MCP client)
- Relevant logs or error messages

## Questions?

- GitHub Discussions: Ask questions and discuss ideas
- GitHub Issues: Report bugs and request features

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to SaveContext! 🎉
