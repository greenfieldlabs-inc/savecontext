#!/usr/bin/env node
/**
 * SaveContext Plans CLI
 * Dashboard-style terminal output for plans, epics, and tasks
 *
 * Supports both local (SQLite) and cloud modes.
 * Default: local mode. Cloud mode when API key is present.
 *
 * Commands:
 * - list: List all plans
 * - show: Show plan details
 * - roadmap: Full dashboard view (Matt's design)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { CloudClient } from '../cloud-client.js';
import { DatabaseManager } from '../database/index.js';
import {
  loadCredentials,
  getCloudApiUrl,
} from '../utils/config.js';
import type {
  Plan,
  Issue,
  ListPlansArgs,
  CreatePlanArgs,
} from '../types/index.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

// Plan list response type
interface PlanListItem {
  id: string;
  short_id: string | null;
  project_path: string;
  project_id: string;
  title: string;
  content: string | null;
  status: 'draft' | 'active' | 'completed' | 'archived';
  success_criteria: string | null;
  epic_count: number;
  created_in_session: string | null;
  completed_in_session: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface PlanListResponse {
  plans: PlanListItem[];
  count?: number;
}

// Issue response type
interface IssueItem {
  id: string;
  shortId?: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'blocked' | 'closed' | 'deferred';
  priority: number;
  issueType: 'task' | 'bug' | 'feature' | 'epic' | 'chore';
  parentId?: string;
  labels?: string[];
  dependencyCount?: number;
  subtaskCount?: number;
}

interface IssueListResponse {
  issues: IssueItem[];
  count?: number;
}

// Mode detection
type Mode = 'local' | 'cloud';

function getMode(): Mode {
  const apiKey = process.env.SAVECONTEXT_API_KEY || loadCredentials()?.apiKey;
  return apiKey ? 'cloud' : 'local';
}

// Singleton instances
let cloudClient: CloudClient | null = null;
let dbManager: DatabaseManager | null = null;

function getCloudClient(): CloudClient | null {
  if (cloudClient) return cloudClient;
  const apiKey = process.env.SAVECONTEXT_API_KEY || loadCredentials()?.apiKey;
  if (!apiKey) return null;
  cloudClient = new CloudClient(apiKey, getCloudApiUrl());
  return cloudClient;
}

function getDbManager(): DatabaseManager {
  if (!dbManager) {
    dbManager = new DatabaseManager();
  }
  return dbManager;
}

/**
 * Format date for display
 */
function formatDate(dateVal: string | number): string {
  const date = typeof dateVal === 'number' ? new Date(dateVal) : new Date(dateVal);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Get status icon and color (Matt's design)
 */
function getStatusDisplay(status: string): { icon: string; color: typeof chalk } {
  switch (status) {
    case 'closed':
    case 'completed':
    case 'released':
      return { icon: '\u2713', color: chalk.green };
    case 'in_progress':
    case 'active':
    case 'in-progress':
      return { icon: '\u25CF', color: chalk.blue };
    case 'open':
    case 'planned':
    case 'draft':
      return { icon: '\u25CB', color: chalk.yellow };
    case 'blocked':
      return { icon: '\u25CF', color: chalk.red };
    case 'deferred':
      return { icon: '\u25CB', color: chalk.dim };
    default:
      return { icon: '\u25CB', color: chalk.gray };
  }
}

/**
 * Get priority color
 */
function getPriorityColor(priority: number): typeof chalk {
  if (priority >= 4) return chalk.red;
  if (priority >= 3) return chalk.yellow;
  return chalk.green;
}

/**
 * Get label color (Matt's design)
 */
function getLabelColor(label: string): typeof chalk {
  switch (label.toLowerCase()) {
    case 'story':
    case 'feature':
      return chalk.magenta;
    case 'bug':
      return chalk.red;
    case 'epic':
      return chalk.hex('#FF8C00');
    default:
      return chalk.cyan;
  }
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

/**
 * Pad string to fixed width
 */
function pad(str: string, width: number): string {
  if (str.length >= width) return str.substring(0, width);
  return str + ' '.repeat(width - str.length);
}

// ==================
// Dual-mode helper functions
// ==================

/**
 * Convert local Plan format to PlanListItem format
 * Plan type already uses snake_case, just need to cast and add defaults
 */
function planToListItem(plan: Plan & { content?: string }): PlanListItem {
  return {
    id: plan.id,
    short_id: plan.short_id,
    project_path: plan.project_path,
    project_id: plan.project_id,
    title: plan.title,
    content: plan.content || null,
    status: plan.status as 'draft' | 'active' | 'completed' | 'archived',
    success_criteria: plan.success_criteria,
    epic_count: plan.epic_count || 0,
    created_in_session: plan.created_in_session,
    completed_in_session: plan.completed_in_session,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    completed_at: plan.completed_at,
  };
}

/**
 * Convert local Issue format to IssueItem format
 */
function issueToItem(issue: Issue): IssueItem {
  return {
    id: issue.id,
    shortId: issue.shortId,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    issueType: issue.issueType,
    parentId: issue.parentId,
    labels: issue.labels,
    dependencyCount: issue.dependencyCount,
    subtaskCount: issue.subtaskCount,
  };
}

async function fetchPlans(args: { project_path: string; status?: string; limit?: number }): Promise<PlanListResponse> {
  const mode = getMode();

  if (mode === 'cloud') {
    const client = getCloudClient()!;
    const response = await client.listPlans({
      project_path: args.project_path,
      status: args.status as ListPlansArgs['status'],
      limit: args.limit,
    });
    if (!response.success) {
      throw new Error(response.message || 'Failed to list plans');
    }
    return response.data as PlanListResponse;
  }

  // Local mode
  const db = getDbManager();
  const plans = db.listPlans(args.project_path, {
    status: args.status as ListPlansArgs['status'],
    limit: args.limit,
  });

  return {
    plans: plans.map(planToListItem),
    count: plans.length,
  };
}

async function fetchPlan(planId: string): Promise<PlanListItem | null> {
  const mode = getMode();

  if (mode === 'cloud') {
    const client = getCloudClient()!;
    const response = await client.getPlan({ plan_id: planId });
    if (!response.success) {
      throw new Error(response.message || 'Failed to get plan');
    }
    return response.data as PlanListItem;
  }

  // Local mode
  const db = getDbManager();
  const plan = db.getPlan(planId);
  if (!plan) return null;

  return planToListItem(plan);
}

async function fetchIssues(args: { project_path: string; issueType?: string; status?: string; limit?: number }): Promise<IssueListResponse> {
  const mode = getMode();

  if (mode === 'cloud') {
    const client = getCloudClient()!;
    const response = await client.listIssues({
      project_path: args.project_path,
      issueType: args.issueType as 'task' | 'bug' | 'feature' | 'epic' | 'chore' | undefined,
      status: args.status as 'open' | 'in_progress' | 'blocked' | 'closed' | 'deferred' | undefined,
      limit: args.limit,
    });
    if (!response.success) {
      throw new Error(response.message || 'Failed to list issues');
    }
    return response.data as IssueListResponse;
  }

  // Local mode
  const db = getDbManager();
  const result = db.listIssues(args.project_path, {
    issueType: args.issueType as 'task' | 'bug' | 'feature' | 'epic' | 'chore' | undefined,
    status: args.status as 'open' | 'in_progress' | 'blocked' | 'closed' | 'deferred' | undefined,
    limit: args.limit,
  });

  return {
    issues: result.issues.map(issueToItem),
    count: result.issues.length,
  };
}

async function createPlan(args: { title: string; content: string; status: string; project_path: string }): Promise<{ id: string; short_id?: string; title: string }> {
  const mode = getMode();

  if (mode === 'cloud') {
    const client = getCloudClient()!;
    const response = await client.createPlan({
      title: args.title,
      content: args.content,
      status: args.status as 'draft' | 'active' | 'completed',
      project_path: args.project_path,
    });
    if (!response.success) {
      throw new Error(response.message || 'Failed to create plan');
    }
    return response.data as { id: string; short_id?: string; title: string };
  }

  // Local mode
  const db = getDbManager();
  const plan = db.createPlan(args.project_path, {
    title: args.title,
    content: args.content,
    status: args.status as 'draft' | 'active' | 'completed',
  });

  return {
    id: plan.id,
    short_id: plan.short_id ?? undefined,
    title: plan.title,
  };
}

// ==================
// Claude Plans Import Helpers
// ==================

interface ClaudePlanFile {
  name: string;
  path: string;
  mtime: Date;
}

interface ParsedPlan {
  title: string;
  status: 'draft' | 'active' | 'completed';
  content: string;
}

/**
 * List markdown files in ~/.claude/plans/
 */
function listClaudePlans(): ClaudePlanFile[] {
  const plansDir = join(homedir(), '.claude', 'plans');

  if (!existsSync(plansDir)) {
    return [];
  }

  try {
    const files = readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const fullPath = join(plansDir, f);
        const stats = statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          mtime: stats.mtime,
        };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // Most recent first

    return files;
  } catch {
    return [];
  }
}

/**
 * Parse Claude plan markdown file
 * Extracts title from H1, detects status from ## Status: line
 */
function parseClaudePlan(content: string, filename: string): ParsedPlan {
  const lines = content.split('\n');

  // Find title from first H1
  let title = basename(filename, '.md');
  for (const line of lines) {
    if (line.startsWith('# ')) {
      title = line.slice(2).trim();
      break;
    }
  }

  // Detect status from ## Status: line
  let status: 'draft' | 'active' | 'completed' = 'draft';
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('## status:') || lower.startsWith('**status:**')) {
      const statusText = line.split(':')[1]?.trim().toLowerCase() || '';
      if (statusText.includes('complete') || statusText.includes('done') || statusText.includes('finished')) {
        status = 'completed';
      } else if (statusText.includes('active') || statusText.includes('in progress') || statusText.includes('wip')) {
        status = 'active';
      }
      break;
    }
  }

  return { title, status, content };
}

/**
 * Interactive picker for selecting a plan
 */
async function pickPlan(plans: ClaudePlanFile[], prompt: string): Promise<ClaudePlanFile | null> {
  if (plans.length === 0) {
    console.log(chalk.yellow('\nNo Claude plans found in ~/.claude/plans/\n'));
    return null;
  }

  console.log(chalk.bold(`\n${prompt}\n`));

  plans.forEach((plan, index) => {
    const dateStr = plan.mtime.toLocaleDateString();
    console.log(`  ${chalk.cyan(`[${index + 1}]`)} ${plan.name} ${chalk.dim(`(${dateStr})`)}`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(chalk.dim('\nEnter number (or q to cancel): '), (answer) => {
      rl.close();
      if (answer.toLowerCase() === 'q') {
        resolve(null);
        return;
      }
      const num = parseInt(answer.trim(), 10);
      resolve(num >= 1 && num <= plans.length ? plans[num - 1] : null);
    });
  });
}

program
  .name('savecontext-plans')
  .description('SaveContext plans dashboard (plans, epics, tasks)')
  .version(pkg.version);

// ==================
// LIST command
// ==================
program
  .command('list')
  .alias('ls')
  .description('List all plans')
  .option('-s, --status <status>', 'Filter by status: draft, active, completed, archived, all')
  .option('-p, --project <path>', 'Filter by project path')
  .option('-l, --limit <n>', 'Maximum plans to show', '20')
  .option('--json', 'Output as JSON')
  .action(async (options: { status?: string; project?: string; limit?: string; json?: boolean }) => {
    const mode = getMode();
    const spinner = options.json ? null : ora(`Fetching plans...`).start();

    try {
      const data = await fetchPlans({
        project_path: options.project || process.cwd(),
        status: options.status,
        limit: parseInt(options.limit || '20', 10),
      });

      spinner?.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (!data.plans || data.plans.length === 0) {
        console.log(chalk.yellow('\nNo plans found.\n'));
        return;
      }

      console.log(chalk.bold(`\nPlans (${data.plans.length})\n`));

      data.plans.forEach((plan) => {
        const { icon, color } = getStatusDisplay(plan.status);
        console.log(`${color(icon)} ${chalk.bold(plan.title)}`);
        console.log(`  ${chalk.dim('ID:')} ${plan.id}${plan.short_id ? chalk.dim(` (${plan.short_id})`) : ''}`);
        console.log(`  ${chalk.dim('Status:')} ${color(plan.status)}${plan.epic_count > 0 ? chalk.dim(` · ${plan.epic_count} epics`) : ''}`);
        if (plan.project_path) {
          console.log(`  ${chalk.dim('Project:')} ${plan.project_path}`);
        }
        console.log(`  ${chalk.dim('Updated:')} ${formatDate(plan.updated_at)}`);
        console.log('');
      });
    } catch (error) {
      spinner?.fail('Failed to fetch plans');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// SHOW command
// ==================
program
  .command('show <plan_id>')
  .description('Show details of a specific plan')
  .option('--full', 'Show full plan content')
  .option('--json', 'Output as JSON')
  .action(async (planId: string, options: { full?: boolean; json?: boolean }) => {
    const mode = getMode();
    const spinner = options.json ? null : ora(`Fetching plan...`).start();

    try {
      const plan = await fetchPlan(planId);
      spinner?.stop();

      if (!plan) {
        console.error(chalk.red(`\nPlan not found: ${planId}\n`));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      const { color } = getStatusDisplay(plan.status);

      // Header box with metadata
      console.log(boxen(
        `${chalk.bold(plan.title)}\n\n` +
        `${chalk.dim('ID:')}      ${plan.id}${plan.short_id ? ` (${plan.short_id})` : ''}\n` +
        `${chalk.dim('Status:')}  ${color(plan.status)}\n` +
        `${chalk.dim('Epics:')}   ${plan.epic_count || 0}\n` +
        `${chalk.dim('Updated:')} ${formatDate(plan.updated_at)}`,
        {
          padding: 1,
          margin: { top: 1, bottom: 0, left: 0, right: 0 },
          borderStyle: 'round',
          borderColor: plan.status === 'active' ? 'blue' : plan.status === 'completed' ? 'green' : 'gray',
        }
      ));

      // Show content
      const content = plan.content || plan.success_criteria;
      if (content) {
        console.log('');
        if (options.full) {
          console.log(content);
        } else {
          // Preview (first 1500 chars to get complete sections)
          const preview = content.slice(0, 1500);
          console.log(preview);
          if (content.length > 1500) {
            console.log(chalk.dim(`\n... (${content.length - 1500} more characters)`));
            console.log(chalk.dim('Use --full to see complete content'));
          }
        }
      }
    } catch (error) {
      spinner?.fail('Failed to fetch plan');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// ROADMAP command (Matt's dashboard design)
// ==================
program
  .command('roadmap', { isDefault: true })
  .description('Show project roadmap dashboard with epics and tasks')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('--json', 'Output as JSON')
  .action(async (options: { project?: string; json?: boolean }) => {
    const mode = getMode();
    const spinner = options.json ? null : ora(`Loading roadmap...`).start();

    try {
      const projectPath = options.project || process.cwd();

      // Fetch plans and issues in parallel
      const [plansData, issuesData, epicsData] = await Promise.all([
        fetchPlans({ project_path: projectPath, status: 'all', limit: 10 }),
        fetchIssues({ project_path: projectPath, limit: 100 }),
        fetchIssues({ project_path: projectPath, issueType: 'epic', limit: 50 }),
      ]);

      spinner?.stop();

      if (options.json) {
        console.log(JSON.stringify({ plans: plansData, issues: issuesData, epics: epicsData }, null, 2));
        return;
      }

      const activePlan = plansData.plans?.find(p => p.status === 'active');
      const epics = epicsData.issues || [];
      const issues = issuesData.issues || [];

      // Sort epics: in-progress first, then open, then closed
      const sortedEpics = [...epics].sort((a, b) => {
        const order: Record<string, number> = { 'in_progress': 0, 'open': 1, 'blocked': 2, 'closed': 3, 'deferred': 4 };
        return (order[a.status] ?? 5) - (order[b.status] ?? 5);
      });

      console.log('');

      // Show each epic with its issues
      sortedEpics.forEach((epic) => {
        const epicIssues = issues.filter(t => t.parentId === epic.id);
        const closed = epicIssues.filter(t => t.status === 'closed').length;
        const total = epicIssues.length;
        const progress = total > 0 ? Math.round((closed / total) * 100) : 0;

        const { icon, color } = getStatusDisplay(epic.status);

        // Epic header
        console.log(chalk.gray('\u2500'.repeat(80)));
        console.log(
          chalk.bold(`Epic: ${epic.title}`) +
          ' | ' +
          color(`${icon} ${epic.status.toUpperCase().replace('_', ' ')}`) +
          ' | ' +
          `${progress}%`
        );
        console.log('');

        // Epic description
        if (epic.description) {
          console.log(chalk.bold('Description:'));
          console.log(epic.description.slice(0, 200) + (epic.description.length > 200 ? '...' : ''));
          console.log('');
        }

        // Issues table
        if (epicIssues.length > 0) {
          console.log(chalk.gray('| ID       | Title                                    | Status      | Type    | Priority |'));
          console.log(chalk.gray('|----------|------------------------------------------|-------------|---------|----------|'));

          epicIssues.forEach((issue) => {
            const { icon: issueIcon, color: issueColor } = getStatusDisplay(issue.status);
            const priorityColor = getPriorityColor(issue.priority);
            const typeColor = getLabelColor(issue.issueType);

            const statusText = issueColor(`${issueIcon} ${pad(issue.status, 9)}`);
            const typeText = typeColor(pad(issue.issueType, 7));
            const priorityText = priorityColor(String(issue.priority));

            console.log(
              chalk.gray('| ') + pad(issue.shortId || issue.id.slice(0, 8), 8) +
              chalk.gray(' | ') + pad(truncate(issue.title, 40), 40) +
              chalk.gray(' | ') + statusText +
              chalk.gray(' | ') + typeText +
              chalk.gray(' | ') + priorityText + ' '.repeat(8 - String(issue.priority).length) +
              chalk.gray(' |')
            );
          });
        } else {
          console.log(chalk.dim('  No issues in this epic'));
        }
        console.log('');
      });

      // Project & PRD Summary
      console.log(chalk.gray('\u2550'.repeat(80)));

      if (activePlan) {
        console.log(chalk.hex('#FF8C00').bold(`PRD: ${activePlan.title}`) + (activePlan.short_id ? chalk.gray(` (${activePlan.short_id})`) : ''));
        console.log('');

        if (activePlan.success_criteria) {
          // Show first section of success criteria
          const contentPreview = activePlan.success_criteria.slice(0, 300);
          console.log(chalk.dim(contentPreview + (activePlan.success_criteria.length > 300 ? '...' : '')));
          console.log('');
        }
      } else if (plansData.plans && plansData.plans.length > 0) {
        console.log(chalk.dim('No active plan. Available plans:'));
        plansData.plans.slice(0, 3).forEach((p) => {
          const { icon, color } = getStatusDisplay(p.status);
          console.log(`  ${color(icon)} ${p.title} ${chalk.dim(`(${p.status})`)}`);
        });
        console.log('');
      }

      // Epics Summary Table
      if (sortedEpics.length > 0) {
        console.log(chalk.bold('Epics Summary'));
        console.log('');
        console.log(chalk.gray('| Epic                            | Status        | Issues | Closed | Progress |'));
        console.log(chalk.gray('|---------------------------------|---------------|--------|--------|----------|'));

        sortedEpics.forEach((epic) => {
          const epicIssues = issues.filter(t => t.parentId === epic.id);
          const closed = epicIssues.filter(t => t.status === 'closed').length;
          const progress = epicIssues.length > 0 ? Math.round((closed / epicIssues.length) * 100) : 0;

          const { icon, color } = getStatusDisplay(epic.status);
          const statusText = color(`${icon} ${pad(epic.status.toUpperCase().replace('_', ' '), 11)}`);

          console.log(
            chalk.gray('| ') + pad(truncate(epic.title, 31), 31) +
            chalk.gray(' | ') + statusText +
            chalk.gray(' | ') + String(epicIssues.length).padStart(6) +
            chalk.gray(' | ') + String(closed).padStart(6) +
            chalk.gray(' | ') + `${progress}%`.padStart(8) +
            chalk.gray(' |')
          );
        });
        console.log('');
      } else {
        console.log(chalk.dim('\nNo epics found. Create issues with issueType: "epic" to organize work.\n'));
      }

      // Quick stats
      const totalIssues = issues.length;
      const closedIssues = issues.filter(t => t.status === 'closed').length;
      const inProgressIssues = issues.filter(t => t.status === 'in_progress').length;
      const blockedIssues = issues.filter(t => t.status === 'blocked').length;

      console.log(chalk.dim(`Total: ${totalIssues} issues | `) +
        chalk.green(`${closedIssues} closed`) + chalk.dim(' | ') +
        chalk.blue(`${inProgressIssues} in progress`) +
        (blockedIssues > 0 ? chalk.dim(' | ') + chalk.red(`${blockedIssues} blocked`) : ''));
      console.log('');

    } catch (error) {
      spinner?.fail('Failed to load roadmap');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// ISSUES command (list issues grouped by status)
// ==================
program
  .command('issues')
  .description('List issues grouped by status')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-t, --type <type>', 'Filter by type: task, bug, feature, epic, chore')
  .option('-s, --status <status>', 'Filter by status: open, in_progress, blocked, closed, deferred')
  .option('-l, --limit <n>', 'Maximum issues to show', '50')
  .option('--json', 'Output as JSON')
  .action(async (options: { project?: string; type?: string; status?: string; limit?: string; json?: boolean }) => {
    const mode = getMode();
    const spinner = options.json ? null : ora(`Fetching issues...`).start();

    try {
      const data = await fetchIssues({
        project_path: options.project || process.cwd(),
        issueType: options.type,
        status: options.status,
        limit: parseInt(options.limit || '50', 10),
      });

      spinner?.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (!data.issues || data.issues.length === 0) {
        console.log(chalk.yellow('\nNo issues found.\n'));
        return;
      }

      // Group by status
      const grouped = {
        in_progress: data.issues.filter(t => t.status === 'in_progress'),
        blocked: data.issues.filter(t => t.status === 'blocked'),
        open: data.issues.filter(t => t.status === 'open'),
        closed: data.issues.filter(t => t.status === 'closed'),
        deferred: data.issues.filter(t => t.status === 'deferred'),
      };

      console.log(chalk.bold(`\nIssues (${data.issues.length})\n`));

      const printGroup = (status: string, issues: IssueItem[]) => {
        if (issues.length === 0) return;

        const { icon, color } = getStatusDisplay(status);
        console.log(color.bold(`${icon} ${status.toUpperCase().replace('_', ' ')} (${issues.length})`));
        console.log(chalk.dim('\u2500'.repeat(60)));

        issues.forEach((issue) => {
          const typeColor = getLabelColor(issue.issueType);
          const priorityColor = getPriorityColor(issue.priority);

          console.log(
            `  ${chalk.dim(issue.shortId || issue.id.slice(0, 8))} ` +
            chalk.bold(truncate(issue.title, 45)) +
            ` ${typeColor(`[${issue.issueType}]`)}` +
            ` ${priorityColor(`P${issue.priority}`)}`
          );
        });
        console.log('');
      };

      printGroup('in_progress', grouped.in_progress);
      printGroup('blocked', grouped.blocked);
      printGroup('open', grouped.open);
      printGroup('closed', grouped.closed);
      printGroup('deferred', grouped.deferred);

    } catch (error) {
      spinner?.fail('Failed to fetch issues');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// EPICS command (list epics with progress)
// ==================
program
  .command('epics')
  .description('List epics with progress')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-s, --status <status>', 'Filter by status')
  .option('--json', 'Output as JSON')
  .action(async (options: { project?: string; status?: string; json?: boolean }) => {
    const mode = getMode();
    const spinner = options.json ? null : ora(`Fetching epics...`).start();

    try {
      const projectPath = options.project || process.cwd();
      const [epicsData, issuesData] = await Promise.all([
        fetchIssues({ project_path: projectPath, issueType: 'epic', status: options.status }),
        fetchIssues({ project_path: projectPath, limit: 200 }),
      ]);

      spinner?.stop();

      const epics = epicsData.issues || [];
      const issues = issuesData.issues || [];

      if (options.json) {
        console.log(JSON.stringify({ epics, issues }, null, 2));
        return;
      }

      if (epics.length === 0) {
        console.log(chalk.yellow('\nNo epics found.\n'));
        console.log(chalk.dim('Create issues with issueType: "epic" to organize work into epics.\n'));
        return;
      }

      console.log(chalk.bold('\nEpics Overview\n'));
      console.log(chalk.gray('| Epic                                 | Status        | Issues | Closed | Progress |'));
      console.log(chalk.gray('|--------------------------------------|---------------|--------|--------|----------|'));

      epics.forEach((epic) => {
        const epicIssues = issues.filter(t => t.parentId === epic.id);
        const closed = epicIssues.filter(t => t.status === 'closed').length;
        const progress = epicIssues.length > 0 ? Math.round((closed / epicIssues.length) * 100) : 0;

        const { icon, color } = getStatusDisplay(epic.status);
        const statusText = color(`${icon} ${pad(epic.status.toUpperCase().replace('_', ' '), 11)}`);

        console.log(
          chalk.gray('| ') + pad(truncate(epic.title, 36), 36) +
          chalk.gray(' | ') + statusText +
          chalk.gray(' | ') + String(epicIssues.length).padStart(6) +
          chalk.gray(' | ') + String(closed).padStart(6) +
          chalk.gray(' | ') + `${progress}%`.padStart(8) +
          chalk.gray(' |')
        );
      });

      console.log('');
    } catch (error) {
      spinner?.fail('Failed to fetch epics');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// IMPORT command
// ==================
program
  .command('import [file]')
  .description('Import a plan from Claude Code or markdown file')
  .option('--list', 'List available plans in ~/.claude/plans/')
  .option('--from-claude', 'Interactive picker from Claude plans')
  .option('-s, --status <status>', 'Override plan status: draft, active, completed')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('--dry-run', 'Preview without creating')
  .option('--json', 'Output as JSON')
  .action(async (file: string | undefined, options: {
    list?: boolean;
    fromClaude?: boolean;
    status?: string;
    project?: string;
    dryRun?: boolean;
    json?: boolean;
  }) => {
    // List mode
    if (options.list) {
      const plans = listClaudePlans();

      if (options.json) {
        console.log(JSON.stringify(plans.map(p => ({
          name: p.name,
          path: p.path,
          modified: p.mtime.toISOString(),
        })), null, 2));
        return;
      }

      if (plans.length === 0) {
        console.log(chalk.yellow('\nNo plans found in ~/.claude/plans/\n'));
        return;
      }

      console.log(chalk.bold(`\nClaude Plans (${plans.length})\n`));
      console.log(chalk.dim('Location: ~/.claude/plans/\n'));

      plans.forEach((plan) => {
        const dateStr = plan.mtime.toLocaleDateString();
        const timeStr = plan.mtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        console.log(`  ${chalk.cyan(plan.name)}`);
        console.log(`    ${chalk.dim('Modified:')} ${dateStr} ${timeStr}`);
        console.log(`    ${chalk.dim('Path:')} ${plan.path}`);
        console.log('');
      });
      return;
    }

    // Interactive picker mode
    if (options.fromClaude) {
      const plans = listClaudePlans();
      const selected = await pickPlan(plans, 'Select a plan to import:');

      if (!selected) {
        console.log(chalk.dim('Cancelled.\n'));
        return;
      }

      file = selected.path;
    }

    // Need a file at this point
    if (!file) {
      console.error(chalk.red('\nNo file specified.'));
      console.error(chalk.dim('Usage: savecontext-plans import <file>'));
      console.error(chalk.dim('       savecontext-plans import --from-claude'));
      console.error(chalk.dim('       savecontext-plans import --list\n'));
      process.exit(1);
    }

    // Validate file exists
    if (!existsSync(file)) {
      console.error(chalk.red(`\nFile not found: ${file}\n`));
      process.exit(1);
    }

    // Read and parse file
    const content = readFileSync(file, 'utf-8');
    const parsed = parseClaudePlan(content, file);

    // Override status if specified
    if (options.status) {
      const validStatuses = ['draft', 'active', 'completed'];
      if (!validStatuses.includes(options.status)) {
        console.error(chalk.red(`\nInvalid status: ${options.status}`));
        console.error(chalk.dim(`Valid values: ${validStatuses.join(', ')}\n`));
        process.exit(1);
      }
      parsed.status = options.status as 'draft' | 'active' | 'completed';
    }

    const projectPath = options.project || process.cwd();

    // Dry run mode
    if (options.dryRun) {
      if (options.json) {
        console.log(JSON.stringify({
          title: parsed.title,
          status: parsed.status,
          project_path: projectPath,
          content_length: parsed.content.length,
          source_file: file,
        }, null, 2));
        return;
      }

      console.log(boxen(
        `${chalk.bold('Plan Import Preview')}\n\n` +
        `${chalk.dim('Title:')}   ${parsed.title}\n` +
        `${chalk.dim('Status:')}  ${parsed.status}\n` +
        `${chalk.dim('Project:')} ${projectPath}\n` +
        `${chalk.dim('Content:')} ${parsed.content.length} characters\n` +
        `${chalk.dim('Source:')}  ${file}`,
        {
          padding: 1,
          margin: { top: 1, bottom: 1, left: 0, right: 0 },
          borderStyle: 'round',
          borderColor: 'yellow',
        }
      ));

      console.log(chalk.dim('Run without --dry-run to create the plan.\n'));
      return;
    }

    // Create the plan
    const mode = getMode();
    const spinner = options.json ? null : ora(`Creating plan...`).start();

    try {
      const plan = await createPlan({
        title: parsed.title,
        content: parsed.content,
        status: parsed.status,
        project_path: projectPath,
      });

      spinner?.stop();

      if (options.json) {
        console.log(JSON.stringify({
          success: true,
          plan: {
            id: plan.id,
            short_id: plan.short_id,
            title: plan.title,
            status: parsed.status,
            project_path: projectPath,
            source_file: file,
          },
        }, null, 2));
        return;
      }

      console.log(boxen(
        `${chalk.green('\u2713')} ${chalk.bold('Plan imported successfully')}\n\n` +
        `${chalk.dim('ID:')}      ${plan.id}${plan.short_id ? ` (${plan.short_id})` : ''}\n` +
        `${chalk.dim('Title:')}   ${plan.title}\n` +
        `${chalk.dim('Status:')}  ${parsed.status}\n` +
        `${chalk.dim('Project:')} ${projectPath}`,
        {
          padding: 1,
          margin: { top: 1, bottom: 1, left: 0, right: 0 },
          borderStyle: 'round',
          borderColor: 'green',
        }
      ));
    } catch (error) {
      spinner?.fail('Failed to import plan');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

program.addHelpText('after', `
${chalk.bold('Examples:')}
  $ savecontext-plans                    # Show roadmap dashboard (default)
  $ savecontext-plans list               # List all plans
  $ savecontext-plans show <plan_id>     # Show plan details
  $ savecontext-plans issues             # List issues by status
  $ savecontext-plans epics              # List epics with progress
  $ savecontext-plans import --list      # List Claude Code plans
  $ savecontext-plans import --from-claude  # Import interactively
  $ savecontext-plans import <file>      # Import specific file
`);

program.parse();
