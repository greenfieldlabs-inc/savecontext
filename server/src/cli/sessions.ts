#!/usr/bin/env node
/**
 * SaveContext Sessions CLI
 * User-focused session management: list, rename, delete, archive, paths
 *
 * This CLI is for USER operations (organizing sessions).
 * Agent lifecycle operations (start, resume, switch, pause) should be done via MCP tools.
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

// Session list response type
interface SessionListItem {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'paused' | 'completed';
  project_paths?: string[];
  item_count?: number;
  created_at: string | number;
  updated_at: string | number;
}

interface SessionListResponse {
  sessions: SessionListItem[];
  count?: number;
  total?: number;
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
 * Simple numbered picker using readline (no external deps)
 */
async function pickSession(sessions: SessionListItem[], prompt: string): Promise<SessionListItem | null> {
  if (sessions.length === 0) {
    console.log(chalk.yellow('\nNo sessions found.\n'));
    return null;
  }

  console.log(chalk.bold(`\n${prompt}\n`));

  sessions.forEach((session, index) => {
    const statusIcon = session.status === 'active' ? chalk.green('●') :
                       session.status === 'paused' ? chalk.yellow('○') :
                       chalk.dim('○');
    const itemCount = session.item_count !== undefined ? chalk.dim(` (${session.item_count} items)`) : '';
    console.log(`  ${chalk.cyan(`[${index + 1}]`)} ${statusIcon} ${session.name}${itemCount}`);
    if (session.description) {
      console.log(`      ${chalk.dim(session.description.slice(0, 60))}${session.description.length > 60 ? '...' : ''}`);
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
      } else if (num < 1 || num > sessions.length) {
        console.log(chalk.red('Invalid selection.'));
        resolve(null);
      } else {
        resolve(sessions[num - 1]);
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
 * Format date for display (handles both string and number timestamps)
 */
function formatDate(dateVal: string | number): string {
  const date = typeof dateVal === 'number' ? new Date(dateVal) : new Date(dateVal);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

program
  .name('savecontext-sessions')
  .description('SaveContext session management (list, rename, delete, archive)')
  .version(pkg.version);

// ==================
// LIST command
// ==================
program
  .command('list')
  .alias('ls')
  .description('List all sessions')
  .option('-a, --all', 'Include completed/archived sessions')
  .option('-s, --status <status>', 'Filter by status: active, paused, completed')
  .option('-g, --global', 'Show sessions from all projects (not just current path)')
  .option('-p, --project <path>', 'Filter by specific project path')
  .option('-l, --limit <n>', 'Maximum sessions to show', '50')
  .option('--search <text>', 'Search sessions by name or description')
  .option('--json', 'Output as JSON')
  .action(async (options: { all?: boolean; status?: string; global?: boolean; project?: string; limit?: string; search?: string; json?: boolean }) => {
    const client = getClient();
    const spinner = options.json ? null : ora('Fetching sessions...').start();

    try {
      // Default: filter to current directory (like agent behavior)
      // With --global: show all sessions across all projects
      // With --project: filter to specific path
      const projectPath = options.global ? undefined : (options.project || process.cwd());

      // Status filtering:
      // --status <x>: filter to that specific status (pass status param, API handles it)
      // --all: include completed (show active + paused + completed)
      // default: show active + paused only
      const statusFilter = options.status as 'active' | 'paused' | 'completed' | undefined;
      // Only set include_completed if --all flag is used (not for --status)
      const includeCompleted = options.all ? true : undefined;

      const response = await client.listSessions({
        project_path: projectPath,
        limit: parseInt(options.limit || '50', 10),
        include_completed: includeCompleted,
        status: statusFilter,
        search: options.search,
      });

      spinner?.stop();

      if (!response.success) {
        console.error(chalk.red(`\nFailed to list sessions: ${response.message}\n`));
        process.exit(1);
      }

      const data = response.data as SessionListResponse;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (!data.sessions || data.sessions.length === 0) {
        console.log(chalk.yellow('\nNo sessions found.\n'));
        return;
      }

      const total = data.total ?? data.count ?? data.sessions.length;

      // Group sessions by status
      const activeSessions = data.sessions.filter(s => s.status === 'active');
      const pausedSessions = data.sessions.filter(s => s.status === 'paused');
      const completedSessions = data.sessions.filter(s => s.status === 'completed');

      // Show which path we're filtering by
      if (projectPath) {
        console.log(chalk.dim(`\nFiltering by: ${projectPath}`));
        console.log(chalk.dim(`Use --global to see all sessions\n`));
      }

      console.log(chalk.bold(`Sessions (${data.sessions.length}/${total})\n`));

      const printSession = (session: SessionListItem) => {
        const statusIcon = session.status === 'active' ? chalk.green('●') :
                          session.status === 'paused' ? chalk.yellow('○') :
                          chalk.dim('○');
        const itemCount = session.item_count !== undefined ? chalk.dim(` (${session.item_count} items)`) : '';

        console.log(`${statusIcon} ${chalk.bold(session.name)}${itemCount}`);
        console.log(`  ${chalk.dim('ID:')} ${session.id}`);
        if (session.description) {
          console.log(`  ${chalk.dim('Desc:')} ${session.description.slice(0, 80)}${session.description.length > 80 ? '...' : ''}`);
        }
        if (session.project_paths && session.project_paths.length > 0) {
          console.log(`  ${chalk.dim('Paths:')} ${session.project_paths.join(', ')}`);
        }
        console.log(`  ${chalk.dim('Updated:')} ${formatDate(session.updated_at)}`);
        console.log('');
      };

      // Print grouped by status
      if (activeSessions.length > 0) {
        console.log(chalk.green.bold(`Active (${activeSessions.length})`));
        console.log(chalk.dim('─'.repeat(40)));
        activeSessions.forEach(printSession);
      }

      if (pausedSessions.length > 0) {
        console.log(chalk.yellow.bold(`Paused (${pausedSessions.length})`));
        console.log(chalk.dim('─'.repeat(40)));
        pausedSessions.forEach(printSession);
      }

      if (completedSessions.length > 0) {
        console.log(chalk.dim.bold(`Completed (${completedSessions.length})`));
        console.log(chalk.dim('─'.repeat(40)));
        completedSessions.forEach(printSession);
      }
    } catch (error) {
      spinner?.fail('Failed to fetch sessions');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// SHOW command
// ==================
program
  .command('show [session_id]')
  .description('Show details of a specific session (or pick from list)')
  .option('--json', 'Output as JSON')
  .action(async (sessionId: string | undefined, options: { json?: boolean }) => {
    const client = getClient();
    let targetId = sessionId;

    // If no session_id provided, show picker
    if (!targetId) {
      const spinner = ora('Fetching sessions...').start();
      const listResponse = await client.listSessions({ include_completed: true, limit: 50 });
      spinner.stop();

      if (!listResponse.success || !(listResponse.data as SessionListResponse).sessions?.length) {
        console.log(chalk.yellow('\nNo sessions found.\n'));
        return;
      }

      const selected = await pickSession((listResponse.data as SessionListResponse).sessions, 'Select a session to view:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
      targetId = selected.id;
    }

    const spinner = options.json ? null : ora('Fetching session details...').start();

    try {
      // Get session status which includes details
      const response = await client.listSessions({ include_completed: true, limit: 100 });
      spinner?.stop();

      if (!response.success) {
        console.error(chalk.red(`\nFailed to get session: ${response.message}\n`));
        process.exit(1);
      }

      const data = response.data as SessionListResponse;
      const session = data.sessions.find(s => s.id === targetId);

      if (!session) {
        console.error(chalk.red(`\nSession not found: ${targetId}\n`));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(session, null, 2));
        return;
      }

      const statusColor = session.status === 'active' ? chalk.green :
                         session.status === 'paused' ? chalk.yellow : chalk.dim;

      console.log(boxen(
        `${chalk.bold(session.name)}\n\n` +
        `${chalk.dim('ID:')}      ${session.id}\n` +
        `${chalk.dim('Status:')}  ${statusColor(session.status)}\n` +
        (session.description ? `${chalk.dim('Desc:')}    ${session.description}\n` : '') +
        (session.item_count !== undefined ? `${chalk.dim('Items:')}   ${session.item_count}\n` : '') +
        (session.project_paths?.length ? `${chalk.dim('Paths:')}   ${session.project_paths.join('\n          ')}\n` : '') +
        `${chalk.dim('Created:')} ${formatDate(session.created_at)}\n` +
        `${chalk.dim('Updated:')} ${formatDate(session.updated_at)}`,
        {
          padding: 1,
          margin: { top: 1, bottom: 1, left: 0, right: 0 },
          borderStyle: 'round',
          borderColor: session.status === 'active' ? 'green' : session.status === 'paused' ? 'yellow' : 'gray',
        }
      ));
    } catch (error) {
      spinner?.fail('Failed to fetch session');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// RENAME command
// ==================
program
  .command('rename [session_id] [new_name]')
  .description('Rename a session')
  .action(async (sessionId: string | undefined, newName: string | undefined) => {
    const client = getClient();
    let targetId = sessionId;
    let targetName: string | undefined;

    // If no session_id provided, show picker
    if (!targetId) {
      const spinner = ora('Fetching sessions...').start();
      const listResponse = await client.listSessions({ include_completed: true, limit: 50 });
      spinner.stop();

      if (!listResponse.success || !(listResponse.data as SessionListResponse).sessions?.length) {
        console.log(chalk.yellow('\nNo sessions found.\n'));
        return;
      }

      const selected = await pickSession((listResponse.data as SessionListResponse).sessions, 'Select a session to rename:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
      targetId = selected.id;
      targetName = selected.name;
    } else {
      // Look up session name for verification
      const listResponse = await client.listSessions({ include_completed: true, limit: 100 });
      if (listResponse.success) {
        const session = (listResponse.data as SessionListResponse).sessions.find(s => s.id === targetId);
        targetName = session?.name;
      }
    }

    if (!targetName) {
      console.error(chalk.red(`\nSession not found: ${targetId}\n`));
      process.exit(1);
    }

    // If no new name provided, prompt for it
    if (!newName) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      newName = await new Promise<string>((resolve) => {
        rl.question(`${chalk.dim('Current name:')} ${targetName}\n${chalk.dim('New name:')} `, (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (!newName) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
    }

    const spinner = ora('Renaming session...').start();

    try {
      const response = await client.renameSession({
        session_id: targetId,
        current_name: targetName,
        new_name: newName,
      });

      if (response.success) {
        spinner.succeed(chalk.green(`Renamed "${targetName}" → "${newName}"`));
      } else {
        spinner.fail(chalk.red(`Failed to rename: ${response.message}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.fail('Failed to rename session');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// DELETE command
// ==================
program
  .command('delete [session_id]')
  .alias('rm')
  .description('Delete a session permanently')
  .option('-f, --force', 'Skip confirmation')
  .action(async (sessionId: string | undefined, options: { force?: boolean }) => {
    const client = getClient();
    let targetId = sessionId;
    let targetName: string | undefined;
    let targetStatus: string | undefined;

    // If no session_id provided, show picker
    if (!targetId) {
      const spinner = ora('Fetching sessions...').start();
      const listResponse = await client.listSessions({ include_completed: true, limit: 50 });
      spinner.stop();

      if (!listResponse.success || !(listResponse.data as SessionListResponse).sessions?.length) {
        console.log(chalk.yellow('\nNo sessions found.\n'));
        return;
      }

      const selected = await pickSession((listResponse.data as SessionListResponse).sessions, 'Select a session to delete:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
      targetId = selected.id;
      targetName = selected.name;
      targetStatus = selected.status;
    } else {
      // Look up session for verification
      const listResponse = await client.listSessions({ include_completed: true, limit: 100 });
      if (listResponse.success) {
        const session = (listResponse.data as SessionListResponse).sessions.find(s => s.id === targetId);
        targetName = session?.name;
        targetStatus = session?.status;
      }
    }

    if (!targetName) {
      console.error(chalk.red(`\nSession not found: ${targetId}\n`));
      process.exit(1);
    }

    // Warn if session is active
    if (targetStatus === 'active') {
      console.log(chalk.yellow(`\nWarning: Session "${targetName}" is currently active.`));
      console.log(chalk.dim('An agent may be using this session.\n'));
    }

    // Confirm deletion
    if (!options.force) {
      const confirmed = await confirm(chalk.red(`Delete session "${targetName}" permanently?`));
      if (!confirmed) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
    }

    const spinner = ora('Deleting session...').start();

    try {
      const response = await client.deleteSession({
        session_id: targetId,
        session_name: targetName,
      });

      if (response.success) {
        spinner.succeed(chalk.green(`Deleted session "${targetName}"`));
      } else {
        spinner.fail(chalk.red(`Failed to delete: ${response.message}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.fail('Failed to delete session');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// ARCHIVE command (end/complete a session)
// ==================
program
  .command('archive [session_id]')
  .description('Archive (complete) a session')
  .action(async (sessionId: string | undefined) => {
    const client = getClient();
    let targetId = sessionId;
    let targetName: string | undefined;

    // If no session_id provided, show picker (only non-completed sessions)
    if (!targetId) {
      const spinner = ora('Fetching sessions...').start();
      const listResponse = await client.listSessions({ include_completed: false, limit: 50 });
      spinner.stop();

      if (!listResponse.success || !(listResponse.data as SessionListResponse).sessions?.length) {
        console.log(chalk.yellow('\nNo active sessions found to archive.\n'));
        return;
      }

      // Filter to only active/paused sessions
      const activeSessions = (listResponse.data as SessionListResponse).sessions.filter(
        s => s.status === 'active' || s.status === 'paused'
      );

      if (activeSessions.length === 0) {
        console.log(chalk.yellow('\nNo active sessions found to archive.\n'));
        return;
      }

      const selected = await pickSession(activeSessions, 'Select a session to archive:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
      targetId = selected.id;
      targetName = selected.name;
    } else {
      // Look up session for verification
      const listResponse = await client.listSessions({ include_completed: true, limit: 100 });
      if (listResponse.success) {
        const session = (listResponse.data as SessionListResponse).sessions.find(s => s.id === targetId);
        targetName = session?.name;
      }
    }

    if (!targetName) {
      console.error(chalk.red(`\nSession not found: ${targetId}\n`));
      process.exit(1);
    }

    const spinner = ora('Archiving session...').start();

    try {
      const response = await client.endSession({
        session_id: targetId,
        session_name: targetName,
      });

      if (response.success) {
        spinner.succeed(chalk.green(`Archived session "${targetName}"`));
        console.log(chalk.dim('\nThe session is now marked as completed and won\'t appear in default lists.\n'));
      } else {
        spinner.fail(chalk.red(`Failed to archive: ${response.message}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.fail('Failed to archive session');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// PATHS command group
// ==================
const pathsCmd = program
  .command('paths')
  .description('Manage session project paths');

pathsCmd
  .command('add [session_id] [path]')
  .description('Add a project path to a session')
  .action(async (sessionId: string | undefined, projectPath: string | undefined) => {
    const client = getClient();
    let targetId = sessionId;
    let targetName: string | undefined;

    // If no session_id provided, show picker
    if (!targetId) {
      const spinner = ora('Fetching sessions...').start();
      const listResponse = await client.listSessions({ include_completed: true, limit: 50 });
      spinner.stop();

      if (!listResponse.success || !(listResponse.data as SessionListResponse).sessions?.length) {
        console.log(chalk.yellow('\nNo sessions found.\n'));
        return;
      }

      const selected = await pickSession((listResponse.data as SessionListResponse).sessions, 'Select a session:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
      targetId = selected.id;
      targetName = selected.name;
    } else {
      // Look up session for verification
      const listResponse = await client.listSessions({ include_completed: true, limit: 100 });
      if (listResponse.success) {
        const session = (listResponse.data as SessionListResponse).sessions.find(s => s.id === targetId);
        targetName = session?.name;
      }
    }

    if (!targetName) {
      console.error(chalk.red(`\nSession not found: ${targetId}\n`));
      process.exit(1);
    }

    // If no path provided, use current directory or prompt
    if (!projectPath) {
      projectPath = process.cwd();
      console.log(chalk.dim(`Using current directory: ${projectPath}`));
    }

    const spinner = ora('Adding path...').start();

    try {
      const response = await client.addSessionPath({
        session_id: targetId,
        session_name: targetName,
        project_path: projectPath,
      });

      if (response.success) {
        spinner.succeed(chalk.green(`Added path "${projectPath}" to "${targetName}"`));
      } else {
        spinner.fail(chalk.red(`Failed to add path: ${response.message}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.fail('Failed to add path');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

pathsCmd
  .command('remove [session_id] <path>')
  .description('Remove a project path from a session')
  .action(async (sessionId: string | undefined, projectPath: string) => {
    const client = getClient();
    let targetId = sessionId;
    let targetName: string | undefined;

    // If no session_id provided, show picker
    if (!targetId) {
      const spinner = ora('Fetching sessions...').start();
      const listResponse = await client.listSessions({ include_completed: true, limit: 50 });
      spinner.stop();

      if (!listResponse.success || !(listResponse.data as SessionListResponse).sessions?.length) {
        console.log(chalk.yellow('\nNo sessions found.\n'));
        return;
      }

      const selected = await pickSession((listResponse.data as SessionListResponse).sessions, 'Select a session:');
      if (!selected) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
      targetId = selected.id;
      targetName = selected.name;
    } else {
      // Look up session for verification
      const listResponse = await client.listSessions({ include_completed: true, limit: 100 });
      if (listResponse.success) {
        const session = (listResponse.data as SessionListResponse).sessions.find(s => s.id === targetId);
        targetName = session?.name;
      }
    }

    if (!targetName) {
      console.error(chalk.red(`\nSession not found: ${targetId}\n`));
      process.exit(1);
    }

    const spinner = ora('Removing path...').start();

    try {
      const response = await client.removeSessionPath({
        session_id: targetId,
        session_name: targetName,
        project_path: projectPath,
      });

      if (response.success) {
        spinner.succeed(chalk.green(`Removed path "${projectPath}" from "${targetName}"`));
      } else {
        spinner.fail(chalk.red(`Failed to remove path: ${response.message}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.fail('Failed to remove path');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// Add help text about agent vs user operations
program.addHelpText('after', `
${chalk.bold('Note:')} This CLI is for managing sessions (list, rename, delete, archive).
Agent lifecycle operations (start, resume, switch, pause) should be done via MCP tools.
This ensures CLI operations don't interfere with running agents.
`);

program.parse();
