// ====================
// Claude Code Settings Types
// ====================

/**
 * Claude Code status line configuration
 */
export interface ClaudeCodeStatusLine {
  type: 'command';
  command: string;
}

/**
 * Claude Code hook configuration
 */
export interface ClaudeCodeHook {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface ClaudeCodeHookMatcher {
  matcher: string;
  hooks: ClaudeCodeHook[];
}

/**
 * Claude Code settings.json structure
 */
export interface ClaudeCodeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
  };
  statusLine?: ClaudeCodeStatusLine;
  hooks?: {
    PostToolUse?: ClaudeCodeHookMatcher[];
    PreToolUse?: ClaudeCodeHookMatcher[];
  };
}


