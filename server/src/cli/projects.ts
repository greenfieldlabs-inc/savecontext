#!/usr/bin/env node
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
import { CloudClient } from '../cloud-client.js';
import {
  loadCredentials,
  getCloudApiUrl,
} from '../utils/config.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

// Project list response types
interface ProjectListItem {
  id: string;
  name: string;
  description?: string;
  source_path?: string;
  session_count?: number;
  created_at: string | number;
  updated_at: string | number;
}

interface ProjectListResponse {
  projects: ProjectListItem[];
  count?: number;
}

/**
 * Get CloudClient instance with API key
 */
function getClient(): CloudClient {
  const apiKey = process.env.SAVECONTEXT_API_KEY || loadCredentials()?.apiKey;
  if (!apiKey) {
    console.error(chalk.red('\nNot authenticated.'));
    console.error(chalk.dim('Run "savecontext-auth login" first.\n'));
    process.exit(1);
  }
  return new CloudClient(apiKey, getCloudApiUrl());
}

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
    const client = getClient();
    const spinner = ora('Loading projects...').start();

    try {
      const response = await client.listProjects({
        limit: parseInt(options.limit, 10),
        include_session_count: options.counts,
      });

      spinner.stop();

      if (!response.success) {
        console.error(chalk.red(`\nError: ${response.message || 'Failed to list projects'}\n`));
        process.exit(1);
      }

      const data = response.data as ProjectListResponse;
      const projects = data.projects || [];

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
    const client = getClient();
    const spinner = ora('Loading projects...').start();

    try {
      const response = await client.listProjects({ limit: 50 });
      spinner.stop();

      if (!response.success) {
        console.error(chalk.red(`\nError: ${response.message || 'Failed to list projects'}\n`));
        process.exit(1);
      }

      const data = response.data as ProjectListResponse;
      const projects = data.projects || [];

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
      const renameResponse = await client.renameProject({
        project_id: selected.id,
        current_name: selected.name,
        new_name: newName,
      });
      renameSpinner.stop();

      if (renameResponse.success) {
        console.log(chalk.green(`\n✓ Renamed "${selected.name}" to "${newName}"\n`));
      } else {
        console.error(chalk.red(`\nError: ${renameResponse.message || 'Failed to rename project'}\n`));
        process.exit(1);
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
    const client = getClient();
    const spinner = ora('Loading projects...').start();

    try {
      const response = await client.listProjects({ limit: 50, include_session_count: true });
      spinner.stop();

      if (!response.success) {
        console.error(chalk.red(`\nError: ${response.message || 'Failed to list projects'}\n`));
        process.exit(1);
      }

      const data = response.data as ProjectListResponse;
      const projects = data.projects || [];

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
      const deleteResponse = await client.deleteProject({
        project_id: selected.id,
        project_name: selected.name,
        force: options.force || (selected.session_count && selected.session_count > 0),
      });
      deleteSpinner.stop();

      if (deleteResponse.success) {
        const unlinked = (deleteResponse.data as { sessions_unlinked?: number })?.sessions_unlinked;
        if (unlinked && unlinked > 0) {
          console.log(chalk.green(`\n✓ Deleted "${selected.name}" and unlinked ${unlinked} session(s)\n`));
        } else {
          console.log(chalk.green(`\n✓ Deleted "${selected.name}"\n`));
        }
      } else {
        console.error(chalk.red(`\nError: ${deleteResponse.message || 'Failed to delete project'}\n`));
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
    const client = getClient();
    const spinner = ora('Loading projects...').start();

    try {
      const response = await client.listProjects({ limit: 50, include_session_count: true });
      spinner.stop();

      if (!response.success) {
        console.error(chalk.red(`\nError: ${response.message || 'Failed to list projects'}\n`));
        process.exit(1);
      }

      const data = response.data as ProjectListResponse;
      const projects = data.projects || [];

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
      const mergeResponse = await client.mergeProjects({
        source_project_id: source.id,
        source_project_name: source.name,
        target_project_id: target.id,
        target_project_name: target.name,
        delete_source: deleteSource,
        confirm: true,
      });
      mergeSpinner.stop();

      if (mergeResponse.success) {
        const result = mergeResponse.data as { sessions_moved?: number; source_deleted?: boolean };
        console.log(chalk.green(`\n✓ Merged ${result.sessions_moved || 0} session(s) into "${target.name}"`));
        if (result.source_deleted) {
          console.log(chalk.dim(`  Source project "${source.name}" was deleted.`));
        }
        console.log();
      } else {
        console.error(chalk.red(`\nError: ${mergeResponse.message || 'Failed to merge projects'}\n`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`\nError: ${(error as Error).message}\n`));
      process.exit(1);
    }
  });

program.parse();
