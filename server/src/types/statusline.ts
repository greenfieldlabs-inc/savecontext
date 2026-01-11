// ====================
// Statusline Setup Types (Multi-tool)
// ====================

/**
 * Supported AI coding tools for statusline setup
 */
export type SupportedTool = 'claude-code';

/**
 * Tool detection result
 */
export interface DetectedTool {
  tool: SupportedTool;
  name: string;
  installed: boolean;
  configDir: string;
}

/**
 * Python detection result
 */
export interface PythonInfo {
  command: string | null;
  version: string | null;
}

/**
 * Setup status line options
 */
export interface SetupStatusLineOptions {
  tool?: SupportedTool;
  uninstall?: boolean;
}

/**
 * Setup status line result (multi-tool)
 */
export interface SetupStatusLineResult {
  success: boolean;
  tools: Array<{
    tool: SupportedTool;
    success: boolean;
    error?: string;
  }>;
  error?: string;
}

/**
 * Claude Code statusline setup result
 */
export interface ClaudeCodeSetupResult {
  success: boolean;
  settingsPath: string;
  scriptPath: string;
  hookPath: string;
  error?: string;
}
