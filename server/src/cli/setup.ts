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
 *   bunx @savecontext/mcp --setup-skill                # Install MCP skill to Claude Code
 *   bunx @savecontext/mcp --setup-skill --mode cli     # Install CLI skill
 *   bunx @savecontext/mcp --setup-skill --mode both    # Install both
 *   bunx @savecontext/mcp --setup-skill --tool codex   # Install to specific tool
 *   bunx @savecontext/mcp --setup-skill --sync         # Sync to all configured tools
 *
 * Note: Requires Bun runtime. Install via: curl -fsSL https://bun.sh/install | bash
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import type { SetupSkillResult, SkillInstallation, SkillSyncConfig, SetupSkillOptions, SkillMode } from '../types/index.js';

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

// Base skill directories for each tool (without skill subdirectory name)
const KNOWN_SKILL_DIRS: Record<string, string> = {
  claude: join(homedir(), '.claude', 'skills'),
  codex: join(homedir(), '.codex', 'skills'),
  gemini: join(homedir(), '.gemini', 'skills'),
};

// Skill directory names for each mode
const SKILL_DIR_NAMES: Record<'mcp' | 'cli', string> = {
  mcp: 'SaveContext-MCP',
  cli: 'SaveContext-CLI',
};

// Source directories for each mode (relative to compiled output)
const SKILL_SOURCES: Record<'mcp' | 'cli', string> = {
  mcp: join(__dirname, '../../skills/SaveContext-MCP'),
  cli: join(__dirname, '../../skills/SaveContext-CLI'),
};

const SKILL_SYNC_CONFIG = join(SAVECONTEXT_DIR, 'skill-sync.json');

// Legacy skill directory names to clean up on upgrade
const LEGACY_SKILL_NAMES = ['savecontext', 'SaveContext'];

/**
 * Expand SkillMode to the individual modes to install
 */
function getModesToInstall(mode: SkillMode): Array<'mcp' | 'cli'> {
  if (mode === 'both') return ['mcp', 'cli'];
  return [mode];
}

/**
 * Normalize a path that may include an old skill directory suffix.
 * Strips trailing SaveContext, SaveContext-MCP, SaveContext-CLI, savecontext
 * to return the base skills directory.
 */
function normalizeSkillBasePath(p: string): string {
  const base = basename(p);
  if (['SaveContext', 'SaveContext-MCP', 'SaveContext-CLI', 'savecontext'].includes(base)) {
    return dirname(p);
  }
  return p;
}

/**
 * Check for and remove legacy skill directories with old naming.
 * Removes 'savecontext' (lowercase) and 'SaveContext' (pre-mode-aware name).
 * Returns list of removed paths.
 */
function cleanupLegacySkills(skillsDir: string): string[] {
  const removed: string[] = [];

  for (const legacyName of LEGACY_SKILL_NAMES) {
    const legacyPath = join(skillsDir, legacyName);

    if (existsSync(legacyPath)) {
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
      const raw = JSON.parse(readFileSync(SKILL_SYNC_CONFIG, 'utf-8'));
      // Migrate old format: add default mode, normalize paths
      const installations: SkillInstallation[] = (raw.installations || []).map((i: SkillInstallation) => ({
        tool: i.tool,
        path: normalizeSkillBasePath(i.path),
        installedAt: i.installedAt,
        mode: i.mode || 'mcp' as SkillMode,
      }));
      return { installations };
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

function addOrUpdateInstallation(config: SkillSyncConfig, tool: string, basePath: string, mode: SkillMode): void {
  const existing = config.installations.findIndex(i => i.tool === tool);
  const installation: SkillInstallation = { tool, path: basePath, installedAt: Date.now(), mode };

  if (existing >= 0) {
    config.installations[existing] = installation;
  } else {
    config.installations.push(installation);
  }
}

/**
 * Install skill files for the specified mode to a base skills directory.
 * Handles legacy cleanup, directory creation, and file copying.
 */
function installSkillForMode(
  baseDir: string,
  mode: SkillMode
): { success: boolean; files: string[]; legacyRemoved: string[]; installed: string[]; error?: string } {
  try {
    // Create base directory if needed
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    // Clean up legacy skill directories
    const legacyRemoved = cleanupLegacySkills(baseDir);

    const allFiles: string[] = [];
    const installed: string[] = [];

    for (const m of getModesToInstall(mode)) {
      const source = SKILL_SOURCES[m];
      const destPath = join(baseDir, SKILL_DIR_NAMES[m]);

      // Copy skill directory recursively (overwrites existing)
      cpSync(source, destPath, { recursive: true });
      installed.push(SKILL_DIR_NAMES[m]);

      // List installed files for reporting
      const listFiles = (dir: string, prefix = '') => {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            listFiles(fullPath, `${prefix}${entry.name}/`);
          } else {
            allFiles.push(`${SKILL_DIR_NAMES[m]}/${prefix}${entry.name}`);
          }
        }
      };
      listFiles(destPath);
    }

    return { success: true, files: allFiles, legacyRemoved, installed };
  } catch (error) {
    return {
      success: false,
      files: [],
      legacyRemoved: [],
      installed: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Setup function for skill installation
 *
 * Supports:
 * - Default installation to Claude Code: --setup-skill
 * - Specific tool: --setup-skill --tool codex
 * - Custom path: --setup-skill --path ~/.gemini/skills
 * - Mode selection: --setup-skill --mode cli
 * - Both modes: --setup-skill --mode both
 * - Sync all configured: --setup-skill --sync
 */
export async function setupSkill(options: SetupSkillOptions = {}): Promise<SetupSkillResult> {
  const { tool = 'claude', path, sync = false, mode } = options;
  // Effective mode for non-sync installs; sync resolves per-installation
  const effectiveMode = mode ?? 'mcp';

  // Header
  console.log();
  const modeLabel = effectiveMode === 'both' ? 'MCP + CLI' : effectiveMode.toUpperCase();
  console.log(boxen(
    chalk.magenta.bold('SaveContext') + chalk.white(` Skill Setup (${modeLabel})\n\n`) +
    chalk.dim(sync ? 'Syncing skills to all configured tools' : `Installing SaveContext skill (mode: ${effectiveMode})`),
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
    // Verify skill source(s) exist
    const sourceSpinner = ora('Locating skill files').start();

    for (const m of getModesToInstall(effectiveMode)) {
      const source = SKILL_SOURCES[m];
      if (!existsSync(source)) {
        sourceSpinner.fail(`Skill files not found for mode '${m}'`);
        result.error = `Skill directory not found: ${source}`;
        return result;
      }
      const skillMdPath = join(source, 'SKILL.md');
      if (!existsSync(skillMdPath)) {
        sourceSpinner.fail(`SKILL.md not found for mode '${m}'`);
        result.error = `SKILL.md not found in: ${source}`;
        return result;
      }
    }
    sourceSpinner.succeed('Skill files located');

    // Load existing config
    const config = loadSkillSyncConfig();
    const installResults: Array<{
      tool: string;
      path: string;
      success: boolean;
      files: string[];
      legacyRemoved: string[];
      installed: string[];
      mode: SkillMode;
    }> = [];

    if (sync) {
      // Sync mode: update all configured installations
      if (config.installations.length === 0) {
        console.log(chalk.yellow('\n  No skill installations configured yet.'));
        console.log(chalk.dim('  Run --setup-skill first to install.\n'));
        result.error = 'No installations to sync';
        return result;
      }

      for (const installation of config.installations) {
        const baseDir = KNOWN_SKILL_DIRS[installation.tool] || installation.path;
        // CLI --mode flag overrides stored mode; stored mode defaults to 'mcp'
        const installMode = mode ?? installation.mode ?? 'mcp';
        const syncSpinner = ora(`Syncing to ${installation.tool} (${baseDir}, mode: ${installMode})`).start();
        const installResult = installSkillForMode(baseDir, installMode);

        if (installResult.success) {
          const legacyNote = installResult.legacyRemoved.length > 0
            ? ` (removed ${installResult.legacyRemoved.length} legacy)`
            : '';
          syncSpinner.succeed(`Synced ${installResult.installed.join(' + ')} to ${installation.tool}${legacyNote}`);
          installResults.push({
            tool: installation.tool,
            path: baseDir,
            success: true,
            files: installResult.files,
            legacyRemoved: installResult.legacyRemoved,
            installed: installResult.installed,
            mode: installMode,
          });

          // Update config: save mode override and normalize path
          addOrUpdateInstallation(config, installation.tool, baseDir, installMode);
        } else {
          syncSpinner.fail(`Failed to sync to ${installation.tool}: ${installResult.error}`);
          installResults.push({
            tool: installation.tool,
            path: baseDir,
            success: false,
            files: [],
            legacyRemoved: [],
            installed: [],
            mode: installMode,
          });
        }
      }

      // Save updated config with normalized paths
      saveSkillSyncConfig(config);
    } else {
      // Single installation mode
      let baseDir: string;

      if (path) {
        // Custom path provided — normalize in case it includes a skill subdir
        baseDir = normalizeSkillBasePath(
          path.startsWith('~') ? path.replace('~', homedir()) : path
        );
      } else if (KNOWN_SKILL_DIRS[tool]) {
        // Known tool
        baseDir = KNOWN_SKILL_DIRS[tool];
      } else {
        // Unknown tool without path
        console.log(chalk.yellow(`\n  Unknown tool: ${tool}`));
        console.log(chalk.dim('  Use --path to specify the skills directory.\n'));
        console.log(chalk.white('  Known tools:'));
        for (const knownTool of Object.keys(KNOWN_SKILL_DIRS)) {
          console.log(chalk.dim(`    • ${knownTool}`));
        }
        console.log();
        result.error = `Unknown tool: ${tool}. Use --path to specify directory.`;
        return result;
      }

      const installSpinner = ora(`Installing to ${tool} (${baseDir}, mode: ${effectiveMode})`).start();
      const installResult = installSkillForMode(baseDir, effectiveMode);

      if (!installResult.success) {
        installSpinner.fail(`Failed to install: ${installResult.error}`);
        result.error = installResult.error;
        return result;
      }

      const legacyNote = installResult.legacyRemoved.length > 0
        ? ` (removed ${installResult.legacyRemoved.length} legacy)`
        : '';
      installSpinner.succeed(`Installed ${installResult.installed.join(' + ')} to ${tool}${legacyNote}`);
      installResults.push({
        tool,
        path: baseDir,
        success: true,
        files: installResult.files,
        legacyRemoved: installResult.legacyRemoved,
        installed: installResult.installed,
        mode: effectiveMode,
      });

      // Save to config for future sync
      addOrUpdateInstallation(config, tool, baseDir, effectiveMode);
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
        chalk.white(r.tool) + chalk.dim(` → ${r.path}`) +
        chalk.cyan(` [${r.installed.join(', ')}]`)
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
