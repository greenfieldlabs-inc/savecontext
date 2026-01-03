#!/usr/bin/env node

/**
 * SaveContext Migration CLI
 * Import cloud data to local SQLite
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { loadConfig, saveConfig } from '../utils/config.js';

const EXPORT_URL = 'https://mcp.savecontext.dev/user/export';

export async function runMigration(apiKey: string): Promise<void> {
  console.log('\n=== SaveContext Cloud → Local Migration ===\n');

  // Setup database path
  const dataDir = path.join(os.homedir(), '.savecontext', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'savecontext.db');

  // Check if local DB already has data
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const sessionCount = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;
      if (sessionCount > 0) {
        console.error('Local database already has data.');
        console.error(`Sessions: ${sessionCount}`);
        console.error('\nTo avoid conflicts, migration only works on empty databases.');
        console.error('Back up and delete ~/.savecontext/data/savecontext.db to proceed.');
        process.exit(1);
      }
    } catch {
      // Table doesn't exist - fresh database, that's fine
    } finally {
      db.close();
    }
  }

  // Fetch cloud data
  console.log('Fetching data from cloud...');
  const res = await fetch(EXPORT_URL, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    console.error('Failed to fetch cloud data:', (error as { error?: string }).error || res.statusText);
    process.exit(1);
  }

  const exportData = await res.json() as {
    success: boolean;
    stats: {
      projects: number;
      sessions: number;
      context_items: number;
      checkpoints: number;
      memory_items: number;
      issues: number;
      plans: number;
    };
    data: {
      projects: any[];
      sessions: any[];
      memory: any[];
      issues: any[];
      issue_labels: any[];
      issue_dependencies: any[];
      plans: any[];
    };
  };

  if (!exportData.success) {
    console.error('Export failed');
    process.exit(1);
  }

  console.log('\nCloud data summary:');
  console.log('  Projects:', exportData.stats.projects);
  console.log('  Sessions:', exportData.stats.sessions);
  console.log('  Context Items:', exportData.stats.context_items);
  console.log('  Checkpoints:', exportData.stats.checkpoints);
  console.log('  Memory Items:', exportData.stats.memory_items);
  console.log('  Issues:', exportData.stats.issues);
  console.log('  Plans:', exportData.stats.plans);

  if (exportData.stats.sessions === 0) {
    console.log('\nNo data to migrate.');
    process.exit(0);
  }

  // Initialize local database with schema
  console.log('\nInitializing local database...');
  const { DatabaseManager } = await import('../database/index.js');
  const dbManager = new DatabaseManager();
  const db = dbManager.getDatabase();

  console.log('Importing data...');

  // Disable foreign keys during import to avoid ordering issues
  db.pragma('foreign_keys = OFF');

  const { data } = exportData;

  // Import projects
  if (data.projects.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO projects (id, project_path, name, description, issue_prefix, next_issue_number, plan_prefix, next_plan_number, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of data.projects) {
      stmt.run(p.id, p.sourcePath, p.name, p.description, p.issuePrefix, p.nextIssueNumber, p.planPrefix, p.nextPlanNumber, p.createdAt, p.updatedAt);
    }
    console.log(`  Projects: ${data.projects.length}`);
  }

  // Import sessions
  let contextItemCount = 0;
  let checkpointCount = 0;
  if (data.sessions.length > 0) {
    const sessionStmt = db.prepare(`
      INSERT OR REPLACE INTO sessions (id, name, description, branch, channel, project_path, status, created_at, updated_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const contextStmt = db.prepare(`
      INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority, channel, tags, size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const checkpointStmt = db.prepare(`
      INSERT OR REPLACE INTO checkpoints (id, session_id, name, description, git_status, git_branch, item_count, total_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const checkpointItemStmt = db.prepare(`
      INSERT OR REPLACE INTO checkpoint_items (id, checkpoint_id, context_item_id, group_name, group_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    const sessionProjectStmt = db.prepare(`
      INSERT OR REPLACE INTO session_projects (session_id, project_path, added_at)
      VALUES (?, ?, ?)
    `);

    for (const s of data.sessions) {
      // Session
      sessionStmt.run(s.id, s.name, s.description, s.branch, s.channel, s.projectPath, s.status, s.createdAt, s.updatedAt, s.endedAt);

      // Context items
      for (const ci of s.contextItems || []) {
        const tags = Array.isArray(ci.tags) ? JSON.stringify(ci.tags) : (ci.tags || '[]');
        contextStmt.run(ci.id, s.id, ci.key, ci.value, ci.category, ci.priority, ci.channel, tags, ci.size, ci.createdAt, ci.updatedAt);
        contextItemCount++;
      }

      // Checkpoints
      for (const cp of s.checkpoints || []) {
        checkpointStmt.run(cp.id, s.id, cp.name, cp.description, cp.gitStatus, cp.gitBranch, cp.itemCount, cp.totalSize, cp.createdAt);
        checkpointCount++;

        // Checkpoint items
        for (const cpi of cp.checkpointItems || []) {
          checkpointItemStmt.run(cpi.id, cp.id, cpi.contextItemId, cpi.groupName, cpi.groupOrder);
        }
      }

      // Session projects
      for (const sp of s.sessionProjects || []) {
        sessionProjectStmt.run(s.id, sp.projectPath, sp.addedAt);
      }
    }
    console.log(`  Sessions: ${data.sessions.length}`);
    console.log(`  Context Items: ${contextItemCount}`);
    console.log(`  Checkpoints: ${checkpointCount}`);
  }

  // Import memory
  if (data.memory.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO project_memory (id, project_path, key, value, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of data.memory) {
      stmt.run(m.id, m.projectPath, m.key, m.value, m.category, m.createdAt, m.updatedAt);
    }
    console.log(`  Memory Items: ${data.memory.length}`);
  }

  // Import issues (parent_id handled via dependencies below)
  if (data.issues.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO issues (id, short_id, project_path, title, description, details, status, priority, issue_type, created_in_session, closed_in_session, created_at, updated_at, closed_at, deferred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const depStmt = db.prepare(`
      INSERT OR IGNORE INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
      VALUES (?, ?, ?, 'parent-child', ?)
    `);
    let parentDepsCreated = 0;
    for (const t of data.issues) {
      stmt.run(t.id, t.shortId, t.projectPath, t.title, t.description, t.details, t.status, t.priority, t.issueType, t.createdInSession, t.closedInSession, t.createdAt, t.updatedAt, t.closedAt, t.deferredAt);
      // Create parent-child dependency if parentId exists
      if (t.parentId) {
        depStmt.run(crypto.randomUUID(), t.id, t.parentId, t.createdAt);
        parentDepsCreated++;
      }
    }
    console.log(`  Issues: ${data.issues.length}${parentDepsCreated > 0 ? ` (${parentDepsCreated} parent-child deps created)` : ''}`);
  }

  // Import issue labels
  if (data.issue_labels.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO issue_labels (id, issue_id, label)
      VALUES (?, ?, ?)
    `);
    for (const il of data.issue_labels) {
      stmt.run(il.id, il.issueId, il.label);
    }
    console.log(`  Issue Labels: ${data.issue_labels.length}`);
  }

  // Import issue dependencies
  if (data.issue_dependencies.length > 0) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const id of data.issue_dependencies) {
      stmt.run(id.id, id.issueId, id.dependsOnId, id.dependencyType, id.createdAt);
    }
    console.log(`  Issue Dependencies: ${data.issue_dependencies.length}`);
  }

  // Import plans (lookup project_id by path if missing)
  if (data.plans.length > 0) {
    const findProjectStmt = db.prepare('SELECT id FROM projects WHERE project_path = ?');
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO plans (id, short_id, project_path, project_id, title, content, status, success_criteria, created_in_session, completed_in_session, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let imported = 0;
    let skipped = 0;
    for (const p of data.plans) {
      let projectId = p.projectId;
      if (!projectId && p.projectPath) {
        const project = findProjectStmt.get(p.projectPath) as { id: string } | undefined;
        if (project) projectId = project.id;
      }
      if (projectId) {
        stmt.run(p.id, p.shortId, p.projectPath, projectId, p.title, p.content, p.status, p.successCriteria, p.createdInSession, p.completedInSession, p.createdAt, p.updatedAt, p.completedAt);
        imported++;
      } else {
        skipped++;
      }
    }
    console.log(`  Plans: ${imported}${skipped > 0 ? ` (${skipped} skipped - no project)` : ''}`);
  }

  // Re-enable foreign keys
  db.pragma('foreign_keys = ON');

  dbManager.close();

  // Mark migration complete
  const config = loadConfig();
  config.migrated = true;
  config.migratedAt = new Date().toISOString();
  saveConfig(config);

  console.log('\n=== Migration Complete ===\n');
  console.log('Your cloud data has been imported to local SQLite!');
  console.log(`Database: ${dbPath}`);
}

// Run if called directly
if (process.argv[1].includes('migrate')) {
  const args = process.argv.slice(2);
  const apiKey = args.find(arg => !arg.startsWith('--')) || process.env.SAVECONTEXT_API_KEY;

  if (!apiKey) {
    console.error('Usage: savecontext-migrate [api-key]');
    console.error('Or set SAVECONTEXT_API_KEY environment variable');
    process.exit(1);
  }

  runMigration(apiKey).catch((err) => {
    console.error('Migration error:', err.message);
    process.exit(1);
  });
}
