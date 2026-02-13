# Hook Integration Guide

SaveContext works with any AI coding tool that supports lifecycle hooks. The `sc` CLI is the only dependency — hooks are just config entries that call `sc` commands.

## Useful `sc` Commands for Hooks

| Command | What It Does | Good For |
|---------|-------------|----------|
| `sc prime --compact` | Output session context as markdown | Injecting context on session start |
| `sc checkpoint create "name"` | Snapshot current session state | Preserving context before compaction |
| `sc checkpoint create "name" --include-git` | Snapshot with git status | End-of-session preservation |
| `sc compaction` | Prepare compaction summary | Pre-compaction context preservation |
| `sc status --json` | Current session stats | Monitoring item counts |
| `sc save "key" "value" -c progress` | Save a context item | Logging agent progress |
| `sc session pause` | Pause current session | Clean session teardown |

## Tool Templates

### Claude Code

Config: `~/.claude/settings.json`

```json
{
  "hooks": {
    "PreCompact": [
      {
        "type": "command",
        "command": "sc checkpoint create pre-compact-$(date +%s)",
        "timeout": 30
      }
    ],
    "SessionStart": [
      {
        "type": "command",
        "command": "sc prime --compact",
        "timeout": 15
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "sc save agent-turn-$(date +%s) \"Agent turn completed\" -c progress",
        "timeout": 10
      }
    ]
  }
}
```

Events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `Notification`, `TaskCompleted`, `PermissionRequest`, `PostToolUseFailure`, `TeammateIdle`

Docs: https://code.claude.com/docs/en/hooks-guide

### Cursor

Config: `.cursor/hooks.json` (project) or `~/.cursor/hooks.json` (user)

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "command": "sc prime --compact",
        "timeout": 15
      }
    ],
    "preCompact": [
      {
        "type": "command",
        "command": "sc checkpoint create pre-compact-$(date +%s)",
        "timeout": 30
      }
    ],
    "stop": [
      {
        "type": "command",
        "command": "sc save agent-turn-$(date +%s) \"Agent turn completed\" -c progress",
        "timeout": 10
      }
    ]
  }
}
```

Events: `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `subagentStart`, `subagentStop`, `afterAgentResponse`, `preCompact`, `stop`

Docs: https://cursor.com/docs/agent/hooks

### Windsurf

Config: `.windsurf/hooks.json` (workspace) or `~/.codeium/windsurf/hooks.json` (user)

```json
{
  "hooks": {
    "post_cascade_response": [
      {
        "command": "sc save agent-turn-$(date +%s) \"Agent turn completed\" -c progress",
        "show_output": false
      }
    ],
    "pre_mcp_tool_use": [
      {
        "command": "sc status --json",
        "show_output": false
      }
    ]
  }
}
```

Events: `pre_read_code`, `pre_write_code`, `pre_run_command`, `pre_mcp_tool_use`, `pre_user_prompt`, `post_read_code`, `post_write_code`, `post_run_command`, `post_mcp_tool_use`, `post_cascade_response`

Docs: https://docs.windsurf.com/windsurf/cascade/hooks

### Kiro / Amazon Q Developer CLI

Config: Agent configuration files

```yaml
hooks:
  PreToolUse:
    - type: command
      command: "sc status --json"
      timeout_ms: 10000
  PostToolUse:
    - type: command
      command: "sc save agent-action-$(date +%s) \"Tool executed\" -c progress"
      timeout_ms: 10000
  Stop:
    - type: command
      command: "sc checkpoint create turn-end-$(date +%s)"
      timeout_ms: 30000
```

Events: `AgentSpawn`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`

Docs: https://kiro.dev/docs/cli/hooks/

### GitHub Copilot CLI

Config: `.github/hooks/*.json` (repo-local only)

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "sc prime --compact",
        "timeoutSec": 15
      }
    ],
    "sessionEnd": [
      {
        "type": "command",
        "bash": "sc checkpoint create session-end-$(date +%s)",
        "timeoutSec": 30
      }
    ]
  }
}
```

Events: `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`

Docs: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks

### OpenCode

Config: `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global)

OpenCode uses a JavaScript plugin system (runs on Bun). Session events go through a generic `event` handler with type discrimination. The `$` is Bun's shell tagged template literal — interpolated values are auto-escaped.

```javascript
// .opencode/plugins/savecontext.js
export const SaveContextPlugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        await $`sc prime --compact`.quiet()
      }

      if (event.type === "session.compacted") {
        await $`sc checkpoint create pre-compact-${Date.now()}`.quiet()
      }

      if (event.type === "session.idle") {
        await $`sc save session-idle-${Date.now()} "Session went idle" -c progress`.quiet()
      }
    }
  }
}
```

Direct-key hooks (for tool interception and compaction injection):

```javascript
// Can be combined with the event handler above
return {
  event: async ({ event }) => { /* ... */ },

  "tool.execute.before": async (input, output) => {
    // Runs before each tool call — input.tool, input.args
  },

  "experimental.session.compacting": async (input, output) => {
    // Inject SaveContext state into compaction summary
    const status = await $`sc status --json`.text()
    output.context.push(`## SaveContext State\n${status}`)
  }
}
```

Events (via `event` handler): `session.created`, `session.updated`, `session.compacted`, `session.idle`, `session.deleted`, `session.error`, `session.diff`, `message.updated`, `file.edited`, `command.executed`, `permission.asked`, `permission.replied`, `todo.updated`, and more.

Direct-key hooks: `tool.execute.before`, `tool.execute.after`, `shell.env`, `experimental.session.compacting`, `experimental.chat.system.transform`

Docs: https://opencode.ai/docs/plugins/

## Tools Without Hooks

These tools don't have hook systems. Use the SaveContext MCP server instead:

- **Codex (OpenAI)** — MCP server via `~/.codex/config.toml`
- **Cline / Roo Code** — MCP server integration
- **Continue.dev** — MCP server or event data destinations
- **Aider** — No hooks or MCP. Wrap with shell scripts.

## Tips

- **Keep hooks fast.** Use timeouts (10-30s). Hooks that block the agent degrade the experience.
- **Use `--json` for parsing.** When hooks need to read `sc` output, `sc status --json` is reliable.
- **`sc` resolves sessions automatically.** No need to pass session IDs — the CLI resolves from the status cache.
- **Customize freely.** These templates are starting points. Hook any `sc` command into any event that makes sense for your workflow.
