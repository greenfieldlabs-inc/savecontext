#!/usr/bin/env node
/**
 * SaveContext Status Line Setup for Claude Code
 *
 * Configures Claude Code to display SaveContext session info in the status line.
 * Also installs PostToolUse hook to update status when MCP tools run.
 *
 * Usage: npx @savecontext/mcp@latest --setup-statusline
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, cpSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import type { ClaudeCodeSettings, SetupStatusLineResult, SetupSkillResult, SkillInstallation, SkillSyncConfig, SetupSkillOptions } from '../types/index.js';

/**
 * Detect the correct Python 3 command for the current platform
 * Returns the command to use, or null if Python 3 is not found
 */
function detectPythonCommand(): { command: string | null; version: string | null } {
  const isWindows = platform() === 'win32';

  // Commands to try in order of preference
  // Windows: py -3 is most reliable (Python Launcher), then python, then python3
  // Unix: python3 is standard, then python (might be Python 2 on old systems)
  const candidates = isWindows
    ? ['py -3', 'python', 'python3']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      // Check if command exists and is Python 3
      const versionOutput = execSync(`${cmd} --version 2>&1`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // Parse version - should be "Python 3.x.x"
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
      // Command not found or failed, try next
      continue;
    }
  }

  return { command: null, version: null };
}

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
    // Step 0: Check for Python 3
    const pythonSpinner = ora('Checking for Python 3').start();
    const python = detectPythonCommand();

    if (!python.command) {
      pythonSpinner.fail('Python 3 not found');
      console.log();
      console.log(chalk.yellow('  Python 3 is required for the status line feature.\n'));
      console.log(chalk.white('  Install Python 3:'));
      if (platform() === 'win32') {
        console.log(chalk.dim('    • Windows: https://www.python.org/downloads/'));
        console.log(chalk.dim('    • Or: winget install Python.Python.3.12'));
        console.log(chalk.dim('    • Make sure to check "Add to PATH" during installation\n'));
      } else if (platform() === 'darwin') {
        console.log(chalk.dim('    • macOS: brew install python3'));
        console.log(chalk.dim('    • Or: https://www.python.org/downloads/\n'));
      } else {
        console.log(chalk.dim('    • Ubuntu/Debian: sudo apt install python3'));
        console.log(chalk.dim('    • Fedora: sudo dnf install python3'));
        console.log(chalk.dim('    • Arch: sudo pacman -S python\n'));
      }
      result.error = 'Python 3 not installed';
      return result;
    }
    pythonSpinner.succeed(`Found Python ${python.version} (${python.command})`);

    // Step 1: Verify Claude Code is installed
    const claudeSpinner = ora('Checking for Claude Code installation').start();

    if (!existsSync(CLAUDE_DIR)) {
      claudeSpinner.fail('Claude Code not found');
      console.log(chalk.yellow('\n  Claude Code directory (~/.claude) not found.'));
      console.log(chalk.dim('  Status line setup currently only supports Claude Code.\n'));
      console.log(chalk.white('  Using a different tool? Let us know:'));
      console.log(chalk.cyan('  https://github.com/greenfieldlabs-inc/savecontext/issues/new'));
      console.log(chalk.dim('  Tell us what tool you use and what you want the status line for.\n'));
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
          command: `${python.command} ${HOOK_DEST}`,
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
      chalk.white('Python:\n') +
      chalk.dim(`  • Using: ${python.command} (v${python.version})\n\n`) +
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

// ===========================================
// Skill Installation
// ===========================================

// Known tool skill directories
// Add new tools here as skill support expands
const KNOWN_SKILL_TOOLS: Record<string, string> = {
  claude: join(homedir(), '.claude', 'skills', 'savecontext'),
  codex: join(homedir(), '.codex', 'skills', 'savecontext'),
  // Future tools - add as skill support is confirmed:
  // gemini: join(homedir(), '.gemini', 'skills', 'savecontext'),
  // cursor: join(homedir(), '.cursor', 'skills', 'savecontext'),
};

const SKILL_SYNC_CONFIG = join(SAVECONTEXT_DIR, 'skill-sync.json');
const SKILL_SOURCE = join(__dirname, '../../skills/savecontext');

function loadSkillSyncConfig(): SkillSyncConfig {
  if (existsSync(SKILL_SYNC_CONFIG)) {
    try {
      return JSON.parse(readFileSync(SKILL_SYNC_CONFIG, 'utf-8'));
    } catch {
      return { installations: [] };
    }
  }
  return { installations: [] };
}

function saveSkillSyncConfig(config: SkillSyncConfig): void {
  if (!existsSync(SAVECONTEXT_DIR)) {
    mkdirSync(SAVECONTEXT_DIR, { recursive: true });
  }
  writeFileSync(SKILL_SYNC_CONFIG, JSON.stringify(config, null, 2) + '\n');
}

function addOrUpdateInstallation(config: SkillSyncConfig, tool: string, path: string): void {
  const existing = config.installations.findIndex(i => i.tool === tool);
  const installation: SkillInstallation = { tool, path, installedAt: Date.now() };

  if (existing >= 0) {
    config.installations[existing] = installation;
  } else {
    config.installations.push(installation);
  }
}

function copySkillToPath(destPath: string): { success: boolean; files: string[]; error?: string } {
  try {
    // Create parent directory if needed
    const parentDir = dirname(destPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Copy skill directory recursively
    cpSync(SKILL_SOURCE, destPath, { recursive: true });

    // List installed files
    const files: string[] = [];
    const listFiles = (dir: string, prefix = '') => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          listFiles(fullPath, `${prefix}${entry.name}/`);
        } else {
          files.push(`${prefix}${entry.name}`);
        }
      }
    };
    listFiles(destPath);

    return { success: true, files };
  } catch (error) {
    return {
      success: false,
      files: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Setup function for skill installation
 *
 * Supports:
 * - Default installation to Claude Code: --setup-skill
 * - Specific tool: --setup-skill --tool codex
 * - Custom path: --setup-skill --tool gemini --path ~/.gemini/skills/savecontext
 * - Sync all configured: --setup-skill --sync
 */
export async function setupSkill(options: SetupSkillOptions = {}): Promise<SetupSkillResult> {
  const { tool = 'claude', path, sync = false } = options;

  // Header
  console.log();
  console.log(boxen(
    chalk.magenta.bold('SaveContext') + chalk.white(' Skill Setup\n\n') +
    chalk.dim(sync ? 'Syncing skills to all configured tools' : 'Installing SaveContext skill'),
    {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'magenta',
    }
  ));
  console.log();

  const result: SetupSkillResult = {
    success: false,
    skillPath: '',
  };

  try {
    // Verify skill source exists
    const sourceSpinner = ora('Locating skill files').start();

    if (!existsSync(SKILL_SOURCE)) {
      sourceSpinner.fail('Skill files not found in package');
      result.error = 'Skill directory not found in package';
      return result;
    }

    const skillMdPath = join(SKILL_SOURCE, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      sourceSpinner.fail('SKILL.md not found in package');
      result.error = 'SKILL.md not found in package';
      return result;
    }
    sourceSpinner.succeed('Skill files located');

    // Load existing config
    const config = loadSkillSyncConfig();
    const installResults: Array<{ tool: string; path: string; success: boolean; files: string[] }> = [];

    if (sync) {
      // Sync mode: update all configured installations
      if (config.installations.length === 0) {
        console.log(chalk.yellow('\n  No skill installations configured yet.'));
        console.log(chalk.dim('  Run --setup-skill first to install.\n'));
        result.error = 'No installations to sync';
        return result;
      }

      for (const installation of config.installations) {
        const syncSpinner = ora(`Syncing to ${installation.tool} (${installation.path})`).start();
        const copyResult = copySkillToPath(installation.path);

        if (copyResult.success) {
          syncSpinner.succeed(`Synced to ${installation.tool}`);
          installResults.push({ tool: installation.tool, path: installation.path, success: true, files: copyResult.files });
        } else {
          syncSpinner.fail(`Failed to sync to ${installation.tool}: ${copyResult.error}`);
          installResults.push({ tool: installation.tool, path: installation.path, success: false, files: [] });
        }
      }
    } else {
      // Single installation mode
      let destPath: string;

      if (path) {
        // Custom path provided
        destPath = path.startsWith('~') ? path.replace('~', homedir()) : path;
      } else if (KNOWN_SKILL_TOOLS[tool]) {
        // Known tool
        destPath = KNOWN_SKILL_TOOLS[tool];
      } else {
        // Unknown tool without path
        console.log(chalk.yellow(`\n  Unknown tool: ${tool}`));
        console.log(chalk.dim('  Use --path to specify the installation directory.\n'));
        console.log(chalk.white('  Known tools:'));
        for (const knownTool of Object.keys(KNOWN_SKILL_TOOLS)) {
          console.log(chalk.dim(`    • ${knownTool}`));
        }
        console.log();
        result.error = `Unknown tool: ${tool}. Use --path to specify directory.`;
        return result;
      }

      const installSpinner = ora(`Installing to ${tool} (${destPath})`).start();
      const copyResult = copySkillToPath(destPath);

      if (!copyResult.success) {
        installSpinner.fail(`Failed to install: ${copyResult.error}`);
        result.error = copyResult.error;
        return result;
      }

      installSpinner.succeed(`Installed to ${tool}`);
      installResults.push({ tool, path: destPath, success: true, files: copyResult.files });

      // Save to config for future sync
      addOrUpdateInstallation(config, tool, destPath);
      saveSkillSyncConfig(config);
    }

    // Success summary
    const successCount = installResults.filter(r => r.success).length;
    result.success = successCount > 0;
    result.skillPath = installResults[0]?.path || '';

    console.log();
    console.log(boxen(
      chalk.green.bold(`Skill ${sync ? 'Synced' : 'Installed'}!\n\n`) +
      chalk.white('Installations:\n') +
      installResults.map(r =>
        (r.success ? chalk.green('  ✓ ') : chalk.red('  ✗ ')) +
        chalk.white(r.tool) + chalk.dim(` → ${r.path}`)
      ).join('\n') + '\n\n' +
      chalk.white('Files:\n') +
      (installResults[0]?.files || []).map(f => chalk.dim(`  • ${f}`)).join('\n') + '\n\n' +
      chalk.dim('Config saved to: ') + chalk.cyan(SKILL_SYNC_CONFIG) + '\n\n' +
      chalk.white('Sync all installations later:\n') +
      chalk.cyan('  npx @savecontext/mcp --setup-skill --sync'),
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
