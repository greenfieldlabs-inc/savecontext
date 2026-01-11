/**
 * Shared utilities for statusline setup across different AI coding tools.
 */

import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { SupportedTool, DetectedTool, PythonInfo } from '../../types/index.js';

// Re-export types for convenience
export type { SupportedTool, DetectedTool, PythonInfo };

// Common paths
export const SAVECONTEXT_DIR = join(homedir(), '.savecontext');
export const HOOKS_DIR = join(SAVECONTEXT_DIR, 'hooks');
export const CACHE_DIR = join(SAVECONTEXT_DIR, 'status-cache');

// Tool-specific paths
export const CLAUDE_DIR = join(homedir(), '.claude');

// Script destinations
export const STATUSLINE_DEST = join(SAVECONTEXT_DIR, 'statusline.py');
export const CLAUDE_HOOK_DEST = join(HOOKS_DIR, 'update-status-cache.py');

/**
 * Detect if Claude Code is installed
 */
export function isClaudeCodeInstalled(): boolean {
  return existsSync(CLAUDE_DIR);
}

/**
 * Detect all installed AI coding tools
 */
export function detectInstalledTools(): DetectedTool[] {
  const tools: DetectedTool[] = [];

  tools.push({
    tool: 'claude-code',
    name: 'Claude Code',
    installed: isClaudeCodeInstalled(),
    configDir: CLAUDE_DIR,
  });

  return tools;
}

/**
 * Get only the installed tools
 */
export function getInstalledTools(): DetectedTool[] {
  return detectInstalledTools().filter(t => t.installed);
}

/**
 * Detect the correct Python 3 command for the current platform
 */
export function detectPythonCommand(): PythonInfo {
  const isWindows = platform() === 'win32';

  // Commands to try in order of preference
  const candidates = isWindows
    ? ['py -3', 'python', 'python3']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const versionOutput = execSync(`${cmd} --version 2>&1`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const match = versionOutput.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
      if (match) {
        const major = parseInt(match[1], 10);
        if (major >= 3) {
          return {
            command: cmd,
            version: `${match[1]}.${match[2]}.${match[3]}`,
          };
        }
      }
    } catch {
      continue;
    }
  }

  return { command: null, version: null };
}

/**
 * Get platform-specific Python installation instructions
 */
export function getPythonInstallInstructions(): string[] {
  const plat = platform();

  if (plat === 'win32') {
    return [
      'Windows: https://www.python.org/downloads/',
      'Or: winget install Python.Python.3.12',
      'Make sure to check "Add to PATH" during installation',
    ];
  } else if (plat === 'darwin') {
    return [
      'macOS: brew install python3',
      'Or: https://www.python.org/downloads/',
    ];
  } else {
    return [
      'Ubuntu/Debian: sudo apt install python3',
      'Fedora: sudo dnf install python3',
      'Arch: sudo pacman -S python',
    ];
  }
}
