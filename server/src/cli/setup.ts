#!/usr/bin/env node
/**
 * SaveContext Status Line Setup for Claude Code
 *
 * Configures Claude Code to display SaveContext session info in the status line.
 * Also installs PostToolUse hook to update status when MCP tools run.
 *
 * Usage: npx @savecontext/mcp@latest --setup-statusline
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import type { ClaudeCodeSettings, SetupStatusLineResult } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const CLAUDE_DIR = join(homedir(), '.claude');
const SAVECONTEXT_DIR = join(homedir(), '.savecontext');
const HOOKS_DIR = join(SAVECONTEXT_DIR, 'hooks');
const CACHE_DIR = join(SAVECONTEXT_DIR, 'status-cache');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');

// Script paths
const STATUSLINE_DEST = join(SAVECONTEXT_DIR, 'statusline.py');
const STATUSLINE_SOURCE = join(__dirname, '../../scripts/statusline.py');
const HOOK_DEST = join(HOOKS_DIR, 'update-status-cache.py');
const HOOK_SOURCE = join(__dirname, '../../scripts/update-status-cache.py');

/**
 * Main setup function for Claude Code status line
 */
export async function setupStatusLine(): Promise<SetupStatusLineResult> {
  // Header
  console.log();
  console.log(boxen(
    chalk.magenta.bold('SaveContext') + chalk.white(' Status Line Setup\n\n') +
    chalk.dim('Configuring status line and hooks for ') + chalk.cyan('Claude Code'),
    {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'magenta',
    }
  ));
  console.log();

  const result: SetupStatusLineResult = {
    success: false,
    settingsPath: SETTINGS_PATH,
    scriptPath: STATUSLINE_DEST,
  };

  try {
    // Step 1: Verify Claude Code is installed
    const claudeSpinner = ora('Checking for Claude Code installation').start();

    if (!existsSync(CLAUDE_DIR)) {
      claudeSpinner.fail('Claude Code not found');
      console.log(chalk.yellow('\n  Claude Code directory (~/.claude) not found.'));
      console.log(chalk.dim('  Install Claude Code first: https://claude.ai/download\n'));
      result.error = 'Claude Code not installed';
      return result;
    }
    claudeSpinner.succeed('Claude Code installation found');

    // Step 2: Create directories
    const dirSpinner = ora('Creating directories').start();

    // Create all required directories
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

    copyFileSync(HOOK_SOURCE, HOOK_DEST);
    chmodSync(HOOK_DEST, 0o755);
    hookSpinner.succeed('Installed update-status-cache.py hook');

    // Step 5: Update Claude Code settings
    const settingsSpinner = ora('Configuring Claude Code settings').start();

    let settings: ClaudeCodeSettings = {};

    // Read existing settings if present
    if (existsSync(SETTINGS_PATH)) {
      try {
        const content = readFileSync(SETTINGS_PATH, 'utf-8');
        settings = JSON.parse(content);
        settingsSpinner.text = 'Updating existing settings.json';
      } catch {
        settingsSpinner.text = 'Creating new settings.json';
      }
    }

    // Configure statusLine
    settings.statusLine = {
      type: 'command',
      command: `python3 ${STATUSLINE_DEST}`,
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

    // Add SaveContext hook
    settings.hooks.PostToolUse.push({
      matcher: 'mcp__savecontext__.*',
      hooks: [
        {
          type: 'command',
          command: `python3 ${HOOK_DEST}`,
          timeout: 10,
        },
      ],
    });

    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    settingsSpinner.succeed('Updated Claude Code settings');

    // Success!
    result.success = true;

    console.log();
    console.log(boxen(
      chalk.green.bold('Setup Complete!\n\n') +
      chalk.white('Installed:\n') +
      chalk.dim(`  • ${STATUSLINE_DEST}\n`) +
      chalk.dim(`  • ${HOOK_DEST}\n\n`) +
      chalk.white('The status line will show:\n') +
      chalk.dim('  • Current SaveContext session name\n') +
      chalk.dim('  • Context usage (tokens + percentage)\n') +
      chalk.dim('  • Session cost and duration\n\n') +
      chalk.white('The hook will update status when:\n') +
      chalk.dim('  • Sessions start, resume, switch, or end\n') +
      chalk.dim('  • Session names change\n\n') +
      chalk.yellow('Restart Claude Code') + chalk.white(' to activate.'),
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'green',
      }
    ));
    console.log();

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    console.log(chalk.red(`\nSetup failed: ${result.error}\n`));
  }

  return result;
}

// Run if called directly
if (process.argv[1]?.includes('setup')) {
  setupStatusLine();
}
