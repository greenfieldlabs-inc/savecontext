#!/usr/bin/env bun
/**
 * SaveContext Projects CLI
 * User-focused project management: list, rename, delete, merge
 *
 * This CLI is for USER operations (organizing projects).
 * These operations are NOT available as MCP tools.
 */

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { DatabaseManager } from '../database/index.js';
import { Project } from '../types/index.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

// Singleton instance
let dbManager: DatabaseManager | null = null;

function getDbManager(): DatabaseManager {
  if (!dbManager) {
    dbManager = new DatabaseManager();
  }
  return dbManager;
}

// Project list item type
interface ProjectListItem {
  id: string;
  name: string;
  description?: string;
  source_path?: string;
  issue_prefix?: string;
  session_count?: number;
  created_at: string | number;
  updated_at: string | number;
}

/**
 * Convert local Project to ProjectListItem
 */
function projectToListItem(project: Project & { session_count?: number }): ProjectListItem {
  return {
    id: project.id,
    name: project.name,
    description: project.description || undefined,
    source_path: project.project_path,
    issue_prefix: project.issue_prefix || undefined,
    session_count: project.session_count,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

// ==================
// Helper functions
// ==================

async function fetchProjects(options: { limit?: number; includeSessionCount?: boolean }): Promise<{ projects: ProjectListItem[]; count: number }> {
  const db = getDbManager();
  const result = db.listProjects({
    limit: options.limit,
    includeSessionCount: options.includeSessionCount,
  });
  return {
    projects: result.projects.map(projectToListItem),
    count: result.count,
  };
}

async function renameProjectOp(projectId: string, _currentName: string, newName: string, description?: string): Promise<{ success: boolean; message?: string }> {
  const db = getDbManager();
  const success = db.renameProject(projectId, newName, description);
  return { success, message: success ? undefined : 'Project not found' };
}

async function deleteProjectOp(projectId: string, _projectName: string, force?: boolean): Promise<{ success: boolean; sessionsUnlinked?: number; message?: string }> {
  const db = getDbManager();
  const result = db.deleteProject(projectId, force);
  return { success: result.success, sessionsUnlinked: result.sessionsUnlinked, message: result.success ? undefined : 'Project has sessions (use --force)' };
}

async function mergeProjectsOp(
  sourceId: string,
  _sourceName: string,
  targetId: string,
  _targetName: string,
  deleteSource?: boolean
): Promise<{ success: boolean; sessionsMoved?: number; sourceDeleted?: boolean; message?: string }> {
  const db = getDbManager();
  const result = db.mergeProjects(sourceId, targetId, deleteSource);
  return { success: result.success, sessionsMoved: result.sessionsMoved, sourceDeleted: result.sourceDeleted };
}

// ==================
// Interactive prompts
// ==================

/**
 * Simple numbered picker using readline
 */
async function pickProject(projects: ProjectListItem[], prompt: string): Promise<ProjectListItem | null> {
  if (projects.length === 0) {
    console.log(chalk.yellow('\nNo projects found.\n'));
    return null;
  }

  console.log(chalk.bold(`\n${prompt}\n`));

  projects.forEach((project, index) => {
    const sessionCount = project.session_count !== undefined ? chalk.dim(` (${project.session_count} sessions)`) : '';
    console.log(`  ${chalk.cyan(`[${index + 1}]`)} ${project.name}${sessionCount}`);
    if (project.description) {
      console.log(`      ${chalk.dim(project.description.slice(0, 60))}${project.description.length > 60 ? '...' : ''}`);
    }
    if (project.source_path) {
      console.log(`      ${chalk.dim('Path:')} ${chalk.dim(project.source_path)}`);
    }
  });

  console.log(`  ${chalk.dim('[0]')} Cancel\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.dim('Enter number: '), (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (isNaN(num) || num === 0) {
        resolve(null);
      } else if (num < 1 || num > projects.length) {
        console.log(chalk.red('Invalid selection.'));
        resolve(null);
      } else {
        resolve(projects[num - 1]);
      }
    });
  });
}

/**
 * Confirm action with yes/no prompt
 */
async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} ${chalk.dim('[y/N]')} `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Prompt for text input
 */
async function promptText(message: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Format date for display
 */
function formatDate(dateVal: string | number): string {
  const date = typeof dateVal === 'number' ? new Date(dateVal) : new Date(dateVal);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

program
  .name('savecontext-projects')
  .description('SaveContext project management (list, rename, delete, merge)')
  .version(pkg.version);

// ==================
// LIST command
// ==================
program
  .command('list')
  .alias('ls')
  .description('List all projects')
  .option('-l, --limit <n>', 'Maximum projects to show', '50')
  .option('-c, --counts', 'Include session counts (slower)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora(`Loading projects...`).start();

    try {
      const data = await fetchProjects({
        limit: parseInt(options.limit, 10),
        includeSessionCount: options.counts,
      });

      spinner.stop();

      const projects = data.projects;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (projects.length === 0) {
        console.log(chalk.yellow('\nNo projects found.\n'));
        console.log(chalk.dim('Projects are created automatically when you start sessions.'));
        console.log(chalk.dim('You can also create them explicitly via the MCP project_create tool.\n'));
        return;
      }

      console.log(boxen(chalk.bold('Projects'), { padding: { left: 2, right: 2, top: 0, bottom: 0 }, borderStyle: 'round' }));
      console.log();

      for (const project of projects) {
        const sessionInfo = project.session_count !== undefined
          ? chalk.dim(` · ${project.session_count} session${project.session_count !== 1 ? 's' : ''}`)
          : '';
        console.log(`  ${chalk.cyan(project.name)}${sessionInfo}`);
        if (project.description) {
          console.log(`    ${chalk.dim(project.description)}`);
        }
        if (project.source_path) {
          console.log(`    ${chalk.dim('Path:')} ${project.source_path}`);
        }
        const prefixDisplay = project.issue_prefix || chalk.yellow('ISSUE (default)');
        console.log(`    ${chalk.dim('Prefix:')} ${prefixDisplay}`);
        console.log(`    ${chalk.dim('ID:')} ${project.id}`);
        console.log(`    ${chalk.dim('Created:')} ${formatDate(project.created_at)}`);
        console.log();
      }

      console.log(chalk.dim(`Total: ${projects.length} project${projects.length !== 1 ? 's' : ''}`));
      console.log();
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`\nError: ${(error as Error).message}\n`));
      process.exit(1);
    }
  });

// ==================
// RENAME command
// ==================
program
  .command('rename')
  .description('Rename a project (interactive picker)')
  .action(async () => {
    const spinner = ora(`Loading projects...`).start();

    try {
      const data = await fetchProjects({ limit: 50 });
      spinner.stop();

      const projects = data.projects;

      const selected = await pickProject(projects, 'Select project to rename:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }

      const newName = await promptText(chalk.cyan('New name:'));
      if (!newName) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }

      const renameSpinner = ora('Renaming project...').start();
      const result = await renameProjectOp(selected.id, selected.name, newName);
      renameSpinner.stop();

      if (result.success) {
        console.log(chalk.green(`\n✓ Renamed "${selected.name}" to "${newName}"\n`));
      } else {
        console.error(chalk.red(`\nError: ${result.message || 'Failed to rename project'}\n`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`\nError: ${(error as Error).message}\n`));
      process.exit(1);
    }
  });

// ==================
// UPDATE command (prefix management)
// ==================
program
  .command('update')
  .description('Update project settings (prefix, description)')
  .option('-p, --prefix <prefix>', 'Set issue prefix (e.g., SC, AUTH, API)')
  .option('-d, --description <desc>', 'Set project description')
  .option('--cascade', 'Update existing issue IDs when changing prefix')
  .action(async (options) => {
    const spinner = ora(`Loading projects...`).start();

    try {
      const data = await fetchProjects({ limit: 50 });
      spinner.stop();

      const projects = data.projects;

      const selected = await pickProject(projects, 'Select project to update:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }

      const db = getDbManager();

      // Handle prefix update
      if (options.prefix) {
        const newPrefix = options.prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!newPrefix) {
          console.error(chalk.red('\nError: Prefix must contain alphanumeric characters.\n'));
          process.exit(1);
        }

        const oldPrefix = selected.issue_prefix || 'ISSUE';

        // Count issues that would be affected
        const issueCount = db.getDatabase().prepare(`
          SELECT COUNT(*) as count FROM issues
          WHERE project_path = ? AND short_id LIKE ?
        `).get(selected.source_path ?? null, `${oldPrefix}-%`) as { count: number };

        console.log(boxen(
          chalk.bold('Prefix Update Preview') + '\n\n' +
          `${chalk.dim('Project:')} ${selected.name}\n` +
          `${chalk.dim('Old prefix:')} ${oldPrefix}\n` +
          `${chalk.dim('New prefix:')} ${newPrefix}\n` +
          `${chalk.dim('Issues affected:')} ${issueCount.count}\n\n` +
          (options.cascade
            ? chalk.cyan(`Will rename: ${oldPrefix}-xxxx → ${newPrefix}-xxxx`)
            : chalk.yellow(`Issues will keep old IDs. Use --cascade to rename them.`)),
          { padding: 1, borderStyle: 'round' }
        ));

        const proceed = await confirm(chalk.yellow('\nProceed with update?'));
        if (!proceed) {
          console.log(chalk.dim('\nCancelled.\n'));
          return;
        }

        const updateSpinner = ora('Updating prefix...').start();
        const result = db.updateProjectPrefix(selected.source_path!, newPrefix, options.cascade);
        updateSpinner.stop();

        if (result.success) {
          console.log(chalk.green(`\n✓ Updated prefix: ${result.oldPrefix} → ${newPrefix}`));
          if (result.issuesUpdated && result.issuesUpdated > 0) {
            console.log(chalk.green(`✓ Renamed ${result.issuesUpdated} issue(s)`));
          }
          console.log();
        } else {
          console.error(chalk.red(`\nError: ${result.error || 'Failed to update prefix'}\n`));
          process.exit(1);
        }
      }

      // Handle description update (if prefix not provided)
      else if (options.description !== undefined) {
        const result = db.updateProject(selected.source_path!, { description: options.description });
        if (result) {
          console.log(chalk.green(`\n✓ Updated description for "${selected.name}"\n`));
        } else {
          console.error(chalk.red('\nError: Failed to update project\n'));
          process.exit(1);
        }
      }

      // No options provided - prompt for prefix
      else {
        const currentPrefix = selected.issue_prefix || chalk.dim('(none - using ISSUE)');
        console.log(`\n${chalk.dim('Current prefix:')} ${currentPrefix}`);

        const newPrefix = await promptText(chalk.cyan('New prefix (or Enter to cancel):'));
        if (!newPrefix) {
          console.log(chalk.dim('\nCancelled.\n'));
          return;
        }

        const cleanPrefix = newPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!cleanPrefix) {
          console.error(chalk.red('\nError: Prefix must contain alphanumeric characters.\n'));
          process.exit(1);
        }

        const wantCascade = await confirm(chalk.yellow('Also rename existing issues?'));

        const updateSpinner = ora('Updating prefix...').start();
        const result = db.updateProjectPrefix(selected.source_path!, cleanPrefix, wantCascade);
        updateSpinner.stop();

        if (result.success) {
          console.log(chalk.green(`\n✓ Updated prefix: ${result.oldPrefix} → ${cleanPrefix}`));
          if (result.issuesUpdated && result.issuesUpdated > 0) {
            console.log(chalk.green(`✓ Renamed ${result.issuesUpdated} issue(s)`));
          }
          console.log();
        } else {
          console.error(chalk.red(`\nError: ${result.error || 'Failed to update prefix'}\n`));
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(chalk.red(`\nError: ${(error as Error).message}\n`));
      process.exit(1);
    }
  });

// ==================
// DELETE command
// ==================
program
  .command('delete')
  .description('Delete a project (interactive picker)')
  .option('-f, --force', 'Force delete even if project has sessions (unlinks sessions, does not delete them)')
  .action(async (options) => {
    const spinner = ora(`Loading projects...`).start();

    try {
      const data = await fetchProjects({ limit: 50, includeSessionCount: true });
      spinner.stop();

      const projects = data.projects;

      const selected = await pickProject(projects, 'Select project to delete:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }

      // Show warning if project has sessions
      if (selected.session_count && selected.session_count > 0) {
        console.log(chalk.yellow(`\nWarning: This project has ${selected.session_count} linked session(s).`));
        console.log(chalk.dim('Sessions will NOT be deleted, only unlinked from this project.'));
        if (!options.force) {
          console.log(chalk.dim('Use --force to proceed anyway.\n'));
          const proceed = await confirm(chalk.yellow('Delete anyway?'));
          if (!proceed) {
            console.log(chalk.dim('\nCancelled.\n'));
            return;
          }
        }
      } else {
        const proceed = await confirm(chalk.red(`Delete project "${selected.name}"?`));
        if (!proceed) {
          console.log(chalk.dim('\nCancelled.\n'));
          return;
        }
      }

      const deleteSpinner = ora('Deleting project...').start();
      const result = await deleteProjectOp(
        selected.id,
        selected.name,
        options.force || (selected.session_count && selected.session_count > 0)
      );
      deleteSpinner.stop();

      if (result.success) {
        if (result.sessionsUnlinked && result.sessionsUnlinked > 0) {
          console.log(chalk.green(`\n✓ Deleted "${selected.name}" and unlinked ${result.sessionsUnlinked} session(s)\n`));
        } else {
          console.log(chalk.green(`\n✓ Deleted "${selected.name}"\n`));
        }
      } else {
        console.error(chalk.red(`\nError: ${result.message || 'Failed to delete project'}\n`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`\nError: ${(error as Error).message}\n`));
      process.exit(1);
    }
  });

// ==================
// MERGE command
// ==================
program
  .command('merge')
  .description('Merge one project into another (moves all sessions)')
  .option('--keep-source', 'Keep the source project after merge (default: delete it)')
  .action(async (options) => {
    const spinner = ora(`Loading projects...`).start();

    try {
      const data = await fetchProjects({ limit: 50, includeSessionCount: true });
      spinner.stop();

      const projects = data.projects;

      if (projects.length < 2) {
        console.log(chalk.yellow('\nNeed at least 2 projects to merge.\n'));
        return;
      }

      // Pick source project
      const source = await pickProject(projects, 'Select SOURCE project (to merge FROM):');
      if (!source) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }

      // Filter out source from target options
      const targetOptions = projects.filter(p => p.id !== source.id);

      // Pick target project
      const target = await pickProject(targetOptions, 'Select TARGET project (to merge INTO):');
      if (!target) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }

      const deleteSource = !options.keepSource;

      // Preview
      console.log(boxen(
        chalk.bold('Merge Preview') + '\n\n' +
        `${chalk.cyan('From:')} ${source.name} (${source.session_count || 0} sessions)\n` +
        `${chalk.cyan('Into:')} ${target.name} (${target.session_count || 0} sessions)\n\n` +
        (deleteSource
          ? chalk.yellow(`Source project "${source.name}" will be DELETED after merge.`)
          : chalk.dim(`Source project "${source.name}" will be kept (no sessions).`)),
        { padding: 1, borderStyle: 'round' }
      ));

      const proceed = await confirm(chalk.yellow('\nProceed with merge?'));
      if (!proceed) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }

      const mergeSpinner = ora('Merging projects...').start();
      const result = await mergeProjectsOp(
        source.id,
        source.name,
        target.id,
        target.name,
        deleteSource
      );
      mergeSpinner.stop();

      if (result.success) {
        console.log(chalk.green(`\n✓ Merged ${result.sessionsMoved || 0} session(s) into "${target.name}"`));
        if (result.sourceDeleted) {
          console.log(chalk.dim(`  Source project "${source.name}" was deleted.`));
        }
        console.log();
      } else {
        console.error(chalk.red(`\nError: ${result.message || 'Failed to merge projects'}\n`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`\nError: ${(error as Error).message}\n`));
      process.exit(1);
    }
  });

program.parse();
