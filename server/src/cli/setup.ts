#!/usr/bin/env bun
/**
 * SaveContext Setup Commands
 *
 * Status Line Setup:
 *   bunx @savecontext/mcp --setup-statusline           # Auto-detect and setup all tools
 *   bunx @savecontext/mcp --setup-statusline --tool claude-code
 *   bunx @savecontext/mcp --uninstall-statusline       # Remove statusline config
 *
 * Skill Setup:
 *   bunx @savecontext/mcp --setup-skill                # Install to Claude Code
 *   bunx @savecontext/mcp --setup-skill --tool codex   # Install to specific tool
 *   bunx @savecontext/mcp --setup-skill --sync         # Sync to all configured tools
 *
 * Note: Requires Bun runtime. Install via: curl -fsSL https://bun.sh/install | bash
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import type { SetupSkillResult, SkillInstallation, SkillSyncConfig, SetupSkillOptions } from '../types/index.js';

// Re-export the new modular statusline setup
export { setupStatusLine, type SetupStatusLineOptions, type SetupStatusLineResult } from './setup/index.js';

// Import for direct CLI usage
import { setupStatusLine as runSetupStatusLine } from './setup/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Shared paths
const SAVECONTEXT_DIR = join(homedir(), '.savecontext');

// ===========================================
// Skill Installation
// ===========================================

// Known tool skill directories
// Add new tools here as skill support expands
const KNOWN_SKILL_TOOLS: Record<string, string> = {
  claude: join(homedir(), '.claude', 'skills', 'SaveContext'),
  codex: join(homedir(), '.codex', 'skills', 'SaveContext'),
  gemini: join(homedir(), '.gemini', 'skills', 'SaveContext'),
  // Future tools - add as skill support is confirmed:
  // cursor: join(homedir(), '.cursor', 'skills', 'SaveContext'),
};

const SKILL_SYNC_CONFIG = join(SAVECONTEXT_DIR, 'skill-sync.json');
const SKILL_SOURCE = join(__dirname, '../../skills/SaveContext');

// Legacy skill directory names to clean up (lowercase versions)
const LEGACY_SKILL_NAMES = ['savecontext'];

/**
 * Check for and remove legacy skill directories with wrong casing
 * Returns list of removed paths
 */
function cleanupLegacySkills(skillsDir: string): string[] {
  const removed: string[] = [];

  for (const legacyName of LEGACY_SKILL_NAMES) {
    const legacyPath = join(skillsDir, legacyName);

    // Only remove if it exists and is different from the correct path
    if (existsSync(legacyPath) && legacyPath !== join(skillsDir, 'SaveContext')) {
      try {
        rmSync(legacyPath, { recursive: true, force: true });
        removed.push(legacyPath);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }

  return removed;
}

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

function copySkillToPath(destPath: string): { success: boolean; files: string[]; legacyRemoved: string[]; error?: string } {
  try {
    // Create parent directory if needed
    const parentDir = dirname(destPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Clean up legacy skill directories with wrong casing
    const legacyRemoved = cleanupLegacySkills(parentDir);

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

    return { success: true, files, legacyRemoved };
  } catch (error) {
    return {
      success: false,
      files: [],
      legacyRemoved: [],
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
 * - Custom path: --setup-skill --tool gemini --path ~/.gemini/skills/SaveContext
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
    const installResults: Array<{ tool: string; path: string; success: boolean; files: string[]; legacyRemoved: string[] }> = [];

    if (sync) {
      // Sync mode: update all configured installations
      if (config.installations.length === 0) {
        console.log(chalk.yellow('\n  No skill installations configured yet.'));
        console.log(chalk.dim('  Run --setup-skill first to install.\n'));
        result.error = 'No installations to sync';
        return result;
      }

      for (const installation of config.installations) {
        // Use correct TitleCase path from KNOWN_SKILL_TOOLS if available,
        // otherwise migrate any lowercase 'savecontext' to 'SaveContext'
        let correctPath = KNOWN_SKILL_TOOLS[installation.tool] || installation.path;
        if (correctPath.endsWith('/savecontext') || correctPath.endsWith('\\savecontext')) {
          correctPath = correctPath.replace(/[/\\]savecontext$/, '/SaveContext');
        }
        const syncSpinner = ora(`Syncing to ${installation.tool} (${correctPath})`).start();
        const copyResult = copySkillToPath(correctPath);

        if (copyResult.success) {
          const legacyNote = copyResult.legacyRemoved.length > 0
            ? ` (removed ${copyResult.legacyRemoved.length} legacy)`
            : '';
          syncSpinner.succeed(`Synced to ${installation.tool}${legacyNote}`);
          installResults.push({ tool: installation.tool, path: correctPath, success: true, files: copyResult.files, legacyRemoved: copyResult.legacyRemoved });

          // Update config with correct path if it changed
          if (correctPath !== installation.path) {
            addOrUpdateInstallation(config, installation.tool, correctPath);
          }
        } else {
          syncSpinner.fail(`Failed to sync to ${installation.tool}: ${copyResult.error}`);
          installResults.push({ tool: installation.tool, path: correctPath, success: false, files: [], legacyRemoved: [] });
        }
      }

      // Save updated config with correct paths
      saveSkillSyncConfig(config);
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

      const legacyNote = copyResult.legacyRemoved.length > 0
        ? ` (removed ${copyResult.legacyRemoved.length} legacy)`
        : '';
      installSpinner.succeed(`Installed to ${tool}${legacyNote}`);
      installResults.push({ tool, path: destPath, success: true, files: copyResult.files, legacyRemoved: copyResult.legacyRemoved });

      // Save to config for future sync
      addOrUpdateInstallation(config, tool, destPath);
      saveSkillSyncConfig(config);
    }

    // Success summary
    const successCount = installResults.filter(r => r.success).length;
    const totalLegacyRemoved = installResults.reduce((sum, r) => sum + r.legacyRemoved.length, 0);
    result.success = successCount > 0;
    result.skillPath = installResults[0]?.path || '';

    // Build legacy cleanup message if any were removed
    const legacyMessage = totalLegacyRemoved > 0
      ? chalk.yellow(`\nLegacy Cleanup:\n`) +
        installResults
          .filter(r => r.legacyRemoved.length > 0)
          .flatMap(r => r.legacyRemoved.map(p => chalk.dim(`  • Removed: ${p}`)))
          .join('\n') + '\n'
      : '';

    console.log();
    console.log(boxen(
      chalk.green.bold(`Skill ${sync ? 'Synced' : 'Installed'}!\n\n`) +
      chalk.white('Installations:\n') +
      installResults.map(r =>
        (r.success ? chalk.green('  ✓ ') : chalk.red('  ✗ ')) +
        chalk.white(r.tool) + chalk.dim(` → ${r.path}`)
      ).join('\n') + '\n' +
      legacyMessage + '\n' +
      chalk.white('Files:\n') +
      (installResults[0]?.files || []).map(f => chalk.dim(`  • ${f}`)).join('\n') + '\n\n' +
      chalk.dim('Config saved to: ') + chalk.cyan(SKILL_SYNC_CONFIG) + '\n\n' +
      chalk.white('Sync all installations later:\n') +
      chalk.cyan('  bunx @savecontext/mcp --setup-skill --sync'),
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
  runSetupStatusLine();
}
