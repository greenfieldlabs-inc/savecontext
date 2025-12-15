#!/usr/bin/env node
/**
 * SaveContext Status Line Setup for Claude Code
 *
 * Configures Claude Code to display SaveContext session info in the status line.
 * This setup is specifically for Claude Code (Anthropic's CLI tool).
 *
 * Usage: npx @savecontext/mcp@latest --setup-statusline
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
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
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const SCRIPT_DEST = join(SAVECONTEXT_DIR, 'statusline.py');
const SCRIPT_SOURCE = join(__dirname, '../../scripts/statusline.py');

/**
 * Main setup function for Claude Code status line
 */
export async function setupStatusLine(): Promise<SetupStatusLineResult> {
  // Header - make it clear this is for Claude Code
  console.log();
  console.log(boxen(
    chalk.magenta.bold('SaveContext') + chalk.white(' Status Line Setup\n\n') +
    chalk.dim('Configuring status line for ') + chalk.cyan('Claude Code'),
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
    scriptPath: SCRIPT_DEST,
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

    // Step 2: Create SaveContext directory
    const dirSpinner = ora('Creating SaveContext directory').start();

    if (!existsSync(SAVECONTEXT_DIR)) {
      mkdirSync(SAVECONTEXT_DIR, { recursive: true });
      dirSpinner.succeed('Created ~/.savecontext directory');
    } else {
      dirSpinner.succeed('SaveContext directory exists');
    }

    // Step 3: Copy status line script
    const scriptSpinner = ora('Installing status line script').start();

    if (!existsSync(SCRIPT_SOURCE)) {
      scriptSpinner.fail('Status line script not found in package');
      result.error = 'Script not found in package';
      return result;
    }

    copyFileSync(SCRIPT_SOURCE, SCRIPT_DEST);
    scriptSpinner.succeed(`Installed statusline.py to ~/.savecontext/`);

    // Step 4: Update Claude Code settings
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

    // Update only the statusLine field - preserve everything else
    settings.statusLine = {
      type: 'command',
      command: `python3 ${SCRIPT_DEST}`,
    };

    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    settingsSpinner.succeed('Updated Claude Code settings');

    // Step 5: Create status cache directory
    const cacheSpinner = ora('Setting up status cache').start();
    const cacheDir = join(SAVECONTEXT_DIR, 'status-cache');

    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    cacheSpinner.succeed('Status cache directory ready');

    // Success!
    result.success = true;

    console.log();
    console.log(boxen(
      chalk.green.bold('Setup Complete!\n\n') +
      chalk.white('The status line will show:\n') +
      chalk.dim('  • Current SaveContext session name\n') +
      chalk.dim('  • Context usage (tokens + percentage)\n') +
      chalk.dim('  • Session cost and duration\n\n') +
      chalk.yellow('Restart Claude Code') + chalk.white(' to see the status line.'),
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
