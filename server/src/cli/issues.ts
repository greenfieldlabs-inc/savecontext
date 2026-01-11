#!/usr/bin/env bun
/**
 * SaveContext Issues CLI
 * Issue management: list, ready, show, stats
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
import type {
  Issue,
  IssueStatus,
  IssueType,
  ListIssuesResult,
  GetReadyIssuesResult,
  ListIssuesArgs,
} from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

// Singleton database manager
let dbManager: DatabaseManager | null = null;

function getDbManager(): DatabaseManager {
  if (!dbManager) {
    dbManager = new DatabaseManager();
  }
  return dbManager;
}

// Priority labels and colors (0-4: lowest, low, medium, high, critical)
const PRIORITY_LABELS = ['lowest', 'low', 'medium', 'high', 'critical'] as const;
const PRIORITY_COLORS = [chalk.dim, chalk.blue, chalk.white, chalk.yellow, chalk.red] as const;

// Status display config
// Note: "duplicate" is not a status - it's a relation type (duplicate-of dependency)
const STATUS_DISPLAY: Record<IssueStatus, { icon: string; color: typeof chalk }> = {
  backlog: { icon: '◌', color: chalk.dim },
  open: { icon: '○', color: chalk.white },
  in_progress: { icon: '●', color: chalk.cyan },
  blocked: { icon: '○', color: chalk.red },
  closed: { icon: '●', color: chalk.green },
  deferred: { icon: '○', color: chalk.dim },
};

// Task type display config
const TYPE_DISPLAY: Record<IssueType, { label: string; color: typeof chalk }> = {
  task: { label: 'task', color: chalk.white },
  bug: { label: 'bug', color: chalk.red },
  feature: { label: 'feat', color: chalk.green },
  epic: { label: 'epic', color: chalk.magenta },
  chore: { label: 'chore', color: chalk.dim },
};

// ==================
// Helper functions
// ==================

/**
 * Normalize issue for CLI output (add default values for optional fields)
 * Note: DatabaseManager.listIssues() already returns camelCase Issue objects
 */
function normalizeIssue(issue: Issue): Issue {
  return {
    ...issue,
    labels: issue.labels || [],
    subtaskCount: issue.subtaskCount || 0,
    dependencyCount: issue.dependencyCount || 0,
    dependentCount: issue.dependentCount || 0,
  };
}

async function fetchIssues(args: ListIssuesArgs & { project_path: string }): Promise<ListIssuesResult> {
  const db = getDbManager();
  const result = db.listIssues(args.project_path, {
    status: args.status,
    priority: args.priority,
    priorityMin: args.priorityMin,
    priorityMax: args.priorityMax,
    issueType: args.issueType,
    labels: args.labels,
    labelsAny: args.labelsAny,
    parentId: args.parentId,
    hasSubtasks: args.hasSubtasks,
    hasDependencies: args.hasDependencies,
    sortBy: args.sortBy,
    sortOrder: args.sortOrder,
    limit: args.limit,
  });

  return {
    issues: result.issues.map(normalizeIssue),
    count: result.issues.length,
    total: result.issues.length,
  };
}

async function fetchReadyIssues(args: { limit?: number; sortBy?: 'priority' | 'createdAt' }): Promise<GetReadyIssuesResult> {
  const projectPath = process.cwd();
  const db = getDbManager();
  const issues = db.getReadyIssues(projectPath, args.limit);

  return {
    issues: issues.map(normalizeIssue),
    count: issues.length,
  };
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatIssueCompact(issue: Issue): string {
  const status = STATUS_DISPLAY[issue.status];
  const priority = PRIORITY_COLORS[issue.priority] || chalk.white;
  const type = TYPE_DISPLAY[issue.issueType];

  const shortId = issue.shortId ? chalk.cyan(issue.shortId) : chalk.dim(issue.id.slice(0, 8));
  const statusIcon = status.color(status.icon);
  const typeLabel = type.color(`(${type.label})`);
  const title = priority(issue.title);

  const labels = issue.labels?.length ? chalk.dim(` [${issue.labels.join(', ')}]`) : '';

  const counts: string[] = [];
  if (issue.subtaskCount) counts.push(`${issue.subtaskCount} sub`);
  if (issue.dependencyCount) counts.push(`${issue.dependencyCount} dep`);
  const countStr = counts.length ? chalk.dim(` (${counts.join(', ')})`) : '';

  return `${statusIcon} ${shortId} ${typeLabel} ${title}${labels}${countStr}`;
}

function formatIssueLong(issue: Issue): string {
  const lines = [formatIssueCompact(issue)];

  if (issue.description) {
    lines.push(`  ${chalk.dim('Desc:')} ${issue.description.slice(0, 80)}${issue.description.length > 80 ? '...' : ''}`);
  }
  if (issue.parentId) {
    lines.push(`  ${chalk.dim('Parent:')} ${issue.parentId}`);
  }
  if (issue.assignedToAgent) {
    lines.push(`  ${chalk.dim('Assigned:')} ${issue.assignedToAgent}`);
  }
  lines.push(`  ${chalk.dim('Updated:')} ${formatRelativeTime(issue.updatedAt)}`);

  return lines.join('\n');
}

async function pickIssue(issues: Issue[], prompt: string): Promise<Issue | null> {
  if (issues.length === 0) {
    console.log(chalk.yellow('\nNo issues found.\n'));
    return null;
  }

  console.log(chalk.bold(`\n${prompt}\n`));

  issues.forEach((issue, index) => {
    const status = STATUS_DISPLAY[issue.status];
    const shortId = issue.shortId || issue.id.slice(0, 8);
    console.log(`  ${chalk.cyan(`[${index + 1}]`)} ${status.color(status.icon)} ${chalk.cyan(shortId)} ${issue.title}`);
  });

  console.log(`  ${chalk.dim('[0]')} Cancel\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(chalk.dim('Enter number: '), (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (isNaN(num) || num === 0) {
        resolve(null);
      } else if (num < 1 || num > issues.length) {
        console.log(chalk.red('Invalid selection.'));
        resolve(null);
      } else {
        resolve(issues[num - 1]);
      }
    });
  });
}

program
  .name('savecontext-issues')
  .description('SaveContext issue management (list, ready, show, stats)')
  .version(pkg.version);

// ==================
// LIST command
// ==================
program
  .command('list')
  .alias('ls')
  .description('List issues with filtering and sorting')
  .option('-s, --status <status>', 'Filter by status: open, in_progress, blocked, closed, deferred')
  .option('-p, --priority <n>', 'Filter by exact priority (0-4)')
  .option('--priority-min <n>', 'Minimum priority')
  .option('--priority-max <n>', 'Maximum priority')
  .option('-t, --type <type>', 'Filter by type: task, bug, feature, epic, chore')
  .option('-l, --labels <labels>', 'Filter by labels (comma-separated, all must match)')
  .option('--labels-any <labels>', 'Filter by labels (comma-separated, any must match)')
  .option('--parent <id>', 'Filter by parent issue ID')
  .option('--has-subtasks', 'Only show issues with subtasks')
  .option('--has-deps', 'Only show issues with dependencies')
  .option('--sort <field>', 'Sort by: priority, createdAt, updatedAt (default: priority)')
  .option('--asc', 'Sort ascending (default is descending)')
  .option('--limit <n>', 'Maximum issues to show', '50')
  .option('--long', 'Show detailed output')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = options.json ? null : ora(`Fetching issues...`).start();

    try {
      const data = await fetchIssues({
        project_path: process.cwd(),
        status: options.status as IssueStatus,
        priority: options.priority ? parseInt(options.priority, 10) : undefined,
        priorityMin: options.priorityMin ? parseInt(options.priorityMin, 10) : undefined,
        priorityMax: options.priorityMax ? parseInt(options.priorityMax, 10) : undefined,
        issueType: options.type as IssueType,
        labels: options.labels?.split(',').map((l: string) => l.trim()),
        labelsAny: options.labelsAny?.split(',').map((l: string) => l.trim()),
        parentId: options.parent,
        hasSubtasks: options.hasSubtasks,
        hasDependencies: options.hasDeps,
        sortBy: options.sort || 'priority',
        sortOrder: options.asc ? 'asc' : 'desc',
        limit: parseInt(options.limit || '50', 10),
      });

      spinner?.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (!data.issues?.length) {
        console.log(chalk.yellow('\nNo issues found.\n'));
        return;
      }

      const total = data.total ?? data.count;
      console.log(chalk.bold(`\nIssues (${data.issues.length}/${total})\n`));

      // Group by status
      const byStatus = new Map<IssueStatus, Issue[]>();
      for (const issue of data.issues) {
        const existing = byStatus.get(issue.status) || [];
        existing.push(issue);
        byStatus.set(issue.status, existing);
      }

      const statusOrder: IssueStatus[] = ['in_progress', 'blocked', 'open', 'deferred', 'closed'];

      for (const status of statusOrder) {
        const statusIssues = byStatus.get(status);
        if (!statusIssues?.length) continue;

        const statusInfo = STATUS_DISPLAY[status];
        console.log(statusInfo.color.bold(`${status.replace('_', ' ')} (${statusIssues.length})`));
        console.log(chalk.dim('─'.repeat(40)));

        for (const issue of statusIssues) {
          console.log(options.long ? formatIssueLong(issue) : formatIssueCompact(issue));
        }
        console.log('');
      }
    } catch (error) {
      spinner?.fail('Failed to fetch issues');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// READY command
// ==================
program
  .command('ready')
  .description('Show issues ready to work on (open, no blockers, unassigned)')
  .option('--limit <n>', 'Maximum issues to show', '10')
  .option('--sort <field>', 'Sort by: priority, createdAt (default: priority)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = options.json ? null : ora(`Fetching ready issues...`).start();

    try {
      const sortBy = (options.sort === 'createdAt' ? 'createdAt' : 'priority') as 'priority' | 'createdAt';
      const data = await fetchReadyIssues({
        limit: parseInt(options.limit || '10', 10),
        sortBy,
      });

      spinner?.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (!data.issues?.length) {
        console.log(chalk.yellow('\nNo issues ready to work on.\n'));
        console.log(chalk.dim('Issues are ready when: open status, no blocking dependencies, not assigned.\n'));
        return;
      }

      console.log(chalk.bold.green(`\nReady to work (${data.issues.length})\n`));
      console.log(chalk.dim('These issues have no blockers and are not assigned.\n'));

      for (const issue of data.issues) {
        console.log(formatIssueCompact(issue));
      }

      console.log('');
      console.log(chalk.dim('Use "savecontext-issues show <id>" for details.'));
      console.log('');
    } catch (error) {
      spinner?.fail('Failed to fetch ready issues');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// SHOW command
// ==================
program
  .command('show [issue_id]')
  .description('Show detailed issue information')
  .option('--json', 'Output as JSON')
  .action(async (issueId: string | undefined, options) => {
    let targetId = issueId;

    if (!targetId) {
      const spinner = ora(`Fetching issues...`).start();
      try {
        const listData = await fetchIssues({
          project_path: process.cwd(),
          limit: 50,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        });
        spinner.stop();

        if (!listData.issues?.length) {
          console.log(chalk.yellow('\nNo issues found.\n'));
          return;
        }

        const selected = await pickIssue(listData.issues, 'Select an issue to view:');
        if (!selected) {
          console.log(chalk.dim('\nCancelled.\n'));
          return;
        }
        targetId = selected.id;
      } catch (error) {
        spinner.fail('Failed to fetch issues');
        console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
        process.exit(1);
      }
    }

    const spinner = options.json ? null : ora(`Fetching issue details...`).start();

    try {
      const data = await fetchIssues({
        project_path: process.cwd(),
        limit: 200,
      });

      spinner?.stop();

      // Find issue by ID or shortId (partial match)
      const issue = data.issues.find((t: Issue) =>
        t.id === targetId ||
        t.shortId === targetId ||
        t.id.startsWith(targetId!) ||
        t.shortId?.toLowerCase().includes(targetId!.toLowerCase())
      );

      if (!issue) {
        console.error(chalk.red(`\nIssue not found: ${targetId}\n`));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(issue, null, 2));
        return;
      }

      const status = STATUS_DISPLAY[issue.status];
      const type = TYPE_DISPLAY[issue.issueType];
      const priorityLabel = PRIORITY_LABELS[issue.priority];
      const priorityColor = PRIORITY_COLORS[issue.priority];

      let content = `${chalk.bold(issue.title)}\n\n`;
      content += `${chalk.dim('ID:')}       ${issue.shortId || issue.id}\n`;
      content += `${chalk.dim('Full ID:')}  ${issue.id}\n`;
      content += `${chalk.dim('Status:')}   ${status.color(issue.status)}\n`;
      content += `${chalk.dim('Priority:')} ${priorityColor(priorityLabel)} (${issue.priority})\n`;
      content += `${chalk.dim('Type:')}     ${type.color(issue.issueType)}\n`;

      if (issue.labels?.length) {
        content += `${chalk.dim('Labels:')}   ${issue.labels.join(', ')}\n`;
      }

      if (issue.description) {
        content += `\n${chalk.dim('Description:')}\n${issue.description}\n`;
      }

      if (issue.details) {
        content += `\n${chalk.dim('Details:')}\n${issue.details}\n`;
      }

      if (issue.parentId) {
        content += `\n${chalk.dim('Parent:')} ${issue.parentId}\n`;
      }

      if (issue.assignedToAgent) {
        content += `${chalk.dim('Assigned:')} ${issue.assignedToAgent}\n`;
      }

      content += `\n${chalk.dim('Created:')}  ${formatDate(issue.createdAt)}\n`;
      content += `${chalk.dim('Updated:')}  ${formatDate(issue.updatedAt)}`;

      if (issue.closedAt) {
        content += `\n${chalk.dim('Closed:')} ${formatDate(issue.closedAt)}`;
      }

      if (issue.subtaskCount || issue.dependencyCount || issue.dependentCount) {
        content += '\n';
        if (issue.subtaskCount) content += `\n${chalk.dim('Subtasks:')} ${issue.subtaskCount}`;
        if (issue.dependencyCount) content += `\n${chalk.dim('Dependencies:')} ${issue.dependencyCount}`;
        if (issue.dependentCount) content += `\n${chalk.dim('Dependents:')} ${issue.dependentCount}`;
      }

      let borderColor: 'green' | 'yellow' | 'red' | 'cyan' | 'gray' = 'gray';
      if (issue.status === 'closed') borderColor = 'green';
      else if (issue.status === 'in_progress') borderColor = 'cyan';
      else if (issue.status === 'blocked') borderColor = 'red';
      else if (issue.status === 'open') borderColor = 'yellow';

      console.log(boxen(content, {
        padding: 1,
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: 'round',
        borderColor,
      }));

      // Show subtasks
      const subtasks = data.issues.filter(t => t.parentId === issue.id);
      if (subtasks.length) {
        console.log(chalk.bold(`Subtasks (${subtasks.length}):`));
        console.log(chalk.dim('─'.repeat(40)));
        for (const sub of subtasks) {
          console.log(formatIssueCompact(sub));
        }
        console.log('');
      }
    } catch (error) {
      spinner?.fail('Failed to fetch issue');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// STATS command
// ==================
program
  .command('stats')
  .description('Show issue statistics with grouping options')
  .option('--by-status', 'Group by status (default)')
  .option('--by-priority', 'Group by priority')
  .option('--by-type', 'Group by issue type')
  .option('--by-label', 'Group by label')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = options.json ? null : ora(`Fetching issue statistics...`).start();

    try {
      const data = await fetchIssues({
        project_path: process.cwd(),
        limit: 1000,
      });

      spinner?.stop();

      const issues = data.issues || [];

      // Compute statistics
      const stats = {
        total: issues.length,
        by_status: { open: 0, in_progress: 0, blocked: 0, closed: 0, deferred: 0 } as Record<IssueStatus, number>,
        by_priority: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 } as Record<string, number>,
        by_type: { task: 0, bug: 0, feature: 0, epic: 0, chore: 0 } as Record<IssueType, number>,
        by_label: {} as Record<string, number>,
        ready_count: 0,
        blocked_count: 0,
        assigned_count: 0,
      };

      for (const issue of issues) {
        stats.by_status[issue.status]++;
        stats.by_priority[issue.priority.toString()]++;
        stats.by_type[issue.issueType]++;

        if (issue.labels) {
          for (const label of issue.labels) {
            stats.by_label[label] = (stats.by_label[label] || 0) + 1;
          }
        }

        if (issue.status === 'blocked') stats.blocked_count++;
        if (issue.assignedToAgent) stats.assigned_count++;
        if (issue.status === 'open' && !issue.assignedToAgent && !issue.dependencyCount) {
          stats.ready_count++;
        }
      }

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(boxen(
        chalk.bold('Issue Statistics\n\n') +
        `${chalk.dim('Total:')}    ${stats.total}\n` +
        `${chalk.dim('Ready:')}    ${chalk.green(stats.ready_count.toString())}\n` +
        `${chalk.dim('Blocked:')}  ${chalk.red(stats.blocked_count.toString())}\n` +
        `${chalk.dim('Assigned:')} ${stats.assigned_count}`,
        {
          padding: 1,
          margin: { top: 1, bottom: 0, left: 0, right: 0 },
          borderStyle: 'round',
          borderColor: 'cyan',
        }
      ));

      const showAll = !options.byStatus && !options.byPriority && !options.byType && !options.byLabel;

      if (showAll || options.byStatus) {
        console.log(chalk.bold('\nBy Status:'));
        console.log(chalk.dim('─'.repeat(30)));
        const statusOrder: IssueStatus[] = ['in_progress', 'open', 'blocked', 'deferred', 'closed'];
        for (const status of statusOrder) {
          const count = stats.by_status[status];
          if (count === 0) continue;
          const info = STATUS_DISPLAY[status];
          const bar = '█'.repeat(Math.min(count, 20));
          console.log(`${info.color(info.icon)} ${status.padEnd(12)} ${count.toString().padStart(4)} ${info.color(bar)}`);
        }
      }

      if (showAll || options.byPriority) {
        console.log(chalk.bold('\nBy Priority:'));
        console.log(chalk.dim('─'.repeat(30)));
        for (let p = 4; p >= 0; p--) {
          const count = stats.by_priority[p.toString()];
          if (count === 0) continue;
          const label = PRIORITY_LABELS[p];
          const color = PRIORITY_COLORS[p];
          const bar = '█'.repeat(Math.min(count, 20));
          console.log(`${color(label.padEnd(10))} ${count.toString().padStart(4)} ${color(bar)}`);
        }
      }

      if (showAll || options.byType) {
        console.log(chalk.bold('\nBy Type:'));
        console.log(chalk.dim('─'.repeat(30)));
        const typeOrder: IssueType[] = ['feature', 'bug', 'task', 'epic', 'chore'];
        for (const type of typeOrder) {
          const count = stats.by_type[type];
          if (count === 0) continue;
          const info = TYPE_DISPLAY[type];
          const bar = '█'.repeat(Math.min(count, 20));
          console.log(`${info.color(info.label.padEnd(10))} ${count.toString().padStart(4)} ${info.color(bar)}`);
        }
      }

      if (options.byLabel && Object.keys(stats.by_label).length) {
        console.log(chalk.bold('\nBy Label:'));
        console.log(chalk.dim('─'.repeat(30)));
        const sortedLabels = Object.entries(stats.by_label).sort((a, b) => b[1] - a[1]);
        for (const [label, count] of sortedLabels.slice(0, 15)) {
          const bar = '█'.repeat(Math.min(count, 20));
          console.log(`${chalk.cyan(label.padEnd(15))} ${count.toString().padStart(4)} ${chalk.cyan(bar)}`);
        }
        if (sortedLabels.length > 15) {
          console.log(chalk.dim(`  ... and ${sortedLabels.length - 15} more labels`));
        }
      }

      console.log('');
    } catch (error) {
      spinner?.fail('Failed to fetch statistics');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

program.addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.dim('# List all issues')}
  savecontext-issues list

  ${chalk.dim('# List open issues, sorted by priority')}
  savecontext-issues list --status open --sort priority

  ${chalk.dim('# List high priority bugs')}
  savecontext-issues list --type bug --priority-min 3

  ${chalk.dim('# Show issues ready to work on')}
  savecontext-issues ready

  ${chalk.dim('# Show issue details')}
  savecontext-issues show SC-a1b2

  ${chalk.dim('# Show statistics grouped by status and priority')}
  savecontext-issues stats --by-status --by-priority

${chalk.bold('Status icons:')}
  ${chalk.green('●')} closed    ${chalk.cyan('●')} in_progress
  ${chalk.white('○')} open      ${chalk.red('○')} blocked
  ${chalk.dim('○')} deferred

${chalk.bold('Priority levels:')} 0=lowest, 1=low, 2=medium, 3=high, 4=critical
`);

program.parse();
