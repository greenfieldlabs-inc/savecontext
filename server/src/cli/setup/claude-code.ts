/**
 * Claude Code statusline setup
 *
 * Configures:
 * - statusline.py for native status display
 * - PostToolUse hook for status cache updates
 * - Claude Code settings.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import type { ClaudeCodeSettings, ClaudeCodeSetupResult, PythonInfo } from '../../types/index.js';
import {
  CLAUDE_DIR,
  SAVECONTEXT_DIR,
  HOOKS_DIR,
  CACHE_DIR,
  STATUSLINE_DEST,
  CLAUDE_HOOK_DEST,
} from './shared.js';

// Re-export for convenience
export type { ClaudeCodeSetupResult };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Script source paths (relative to compiled output)
const STATUSLINE_SOURCE = join(__dirname, '../../../scripts/statusline.py');
const HOOK_SOURCE = join(__dirname, '../../../scripts/update-status-cache.py');

// Settings path
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');

/**
 * Setup Claude Code statusline
 */
export async function setupClaudeCode(python: PythonInfo): Promise<ClaudeCodeSetupResult> {
  const result: ClaudeCodeSetupResult = {
    success: false,
    settingsPath: SETTINGS_PATH,
    scriptPath: STATUSLINE_DEST,
    hookPath: CLAUDE_HOOK_DEST,
  };

  try {
    // Step 1: Verify Claude Code is installed
    const claudeSpinner = ora('Checking for Claude Code installation').start();

    if (!existsSync(CLAUDE_DIR)) {
      claudeSpinner.fail('Claude Code not found');
      result.error = 'Claude Code not installed (~/.claude not found)';
      return result;
    }
    claudeSpinner.succeed('Claude Code installation found');

    // Step 2: Create directories
    const dirSpinner = ora('Creating directories').start();

    for (const dir of [SAVECONTEXT_DIR, HOOKS_DIR, CACHE_DIR]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
    dirSpinner.succeed('Created ~/.savecontext directories');

    // Step 3: Install statusline script
    const statuslineSpinner = ora('Installing status line script').start();

    if (!existsSync(STATUSLINE_SOURCE)) {
      statuslineSpinner.fail('Status line script not found in package');
      result.error = 'statusline.py not found in package';
      return result;
    }

    copyFileSync(STATUSLINE_SOURCE, STATUSLINE_DEST);
    chmodSync(STATUSLINE_DEST, 0o755);
    statuslineSpinner.succeed('Installed statusline.py');

    // Step 4: Install hook script
    const hookSpinner = ora('Installing PostToolUse hook').start();

    if (!existsSync(HOOK_SOURCE)) {
      hookSpinner.fail('Hook script not found in package');
      result.error = 'update-status-cache.py not found in package';
      return result;
    }

    copyFileSync(HOOK_SOURCE, CLAUDE_HOOK_DEST);
    chmodSync(CLAUDE_HOOK_DEST, 0o755);
    hookSpinner.succeed('Installed update-status-cache.py hook');

    // Step 5: Update Claude Code settings
    const settingsSpinner = ora('Configuring Claude Code settings').start();

    let settings: ClaudeCodeSettings = {};

    if (existsSync(SETTINGS_PATH)) {
      try {
        const content = readFileSync(SETTINGS_PATH, 'utf-8');
        settings = JSON.parse(content);
        settingsSpinner.text = 'Updating existing settings.json';
      } catch {
        settingsSpinner.text = 'Creating new settings.json';
      }
    }

    // Configure statusLine using detected Python command
    settings.statusLine = {
      type: 'command',
      command: `${python.command} ${STATUSLINE_DEST}`,
    };

    // Configure hooks - preserve existing hooks, add/update SaveContext hook
    if (!settings.hooks) {
      settings.hooks = {};
    }
    if (!settings.hooks.PostToolUse) {
      settings.hooks.PostToolUse = [];
    }

    // Remove any existing SaveContext hook matcher
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
      (hook: { matcher?: string }) => hook.matcher !== 'mcp__savecontext__.*'
    );

    // Add SaveContext hook using detected Python command
    settings.hooks.PostToolUse.push({
      matcher: 'mcp__savecontext__.*',
      hooks: [
        {
          type: 'command',
          command: `${python.command} ${CLAUDE_HOOK_DEST}`,
          timeout: 10,
        },
      ],
    });

    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    settingsSpinner.succeed('Updated Claude Code settings');

    result.success = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return result;
}

/**
 * Uninstall Claude Code statusline configuration
 */
export async function uninstallClaudeCode(): Promise<{ success: boolean; error?: string }> {
  try {
    // Remove statusline and hook from settings
    if (existsSync(SETTINGS_PATH)) {
      const settingsSpinner = ora('Removing Claude Code statusline config').start();

      const content = readFileSync(SETTINGS_PATH, 'utf-8');
      const settings: ClaudeCodeSettings = JSON.parse(content);

      // Remove statusline if it's our SaveContext command
      if (settings.statusLine?.command?.includes('savecontext')) {
        delete settings.statusLine;
      }

      // Remove SaveContext hook
      if (settings.hooks?.PostToolUse) {
        settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
          (hook: { matcher?: string }) => hook.matcher !== 'mcp__savecontext__.*'
        );
        if (settings.hooks.PostToolUse.length === 0) {
          delete settings.hooks.PostToolUse;
        }
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
      }

      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
      settingsSpinner.succeed('Removed Claude Code statusline config');
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Print Claude Code specific success message
 */
export function printClaudeCodeSuccess(python: PythonInfo): void {
  console.log(chalk.white('\n  Claude Code:'));
  console.log(chalk.dim(`    • Statusline: ${STATUSLINE_DEST}`));
  console.log(chalk.dim(`    • Hook: ${CLAUDE_HOOK_DEST}`));
  console.log(chalk.dim(`    • Python: ${python.command} (v${python.version})`));
  console.log(chalk.yellow('    • Restart Claude Code to activate'));
}
