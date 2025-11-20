#!/usr/bin/env node

/**
 * SaveContext Migration CLI
 * Minimal CLI to migrate local SQLite data to cloud
 * All validation and tier logic is handled server-side
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import {
  MigrationStatusResponse,
  MigrationResult,
  MigrationStats,
  CheckpointItemRow,
  CheckpointRow
} from '../types/index.js';

const API_URL = 'https://mcp.savecontext.dev/migrate';

export async function runMigration(apiKey: string): Promise<void> {
  console.log('\n=== SaveContext Cloud Migration ===\n');

  // Find database
  const dbPath = path.join(os.homedir(), '.savecontext', 'data', 'savecontext.db');
  if (!fs.existsSync(dbPath)) {
    console.error('No local database found at:', dbPath);
    console.error('Nothing to migrate.');
    process.exit(1);
  }

  // Open database
  const db = new Database(dbPath, { readonly: true });

  try {
    // Check migration status first
    console.log('Checking cloud account status...');
    const statusRes = await fetch(API_URL, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!statusRes.ok) {
      const error = await statusRes.json().catch(() => ({ error: 'Unknown error' })) as MigrationResult;
      console.error('Failed to check migration status:', error.error || statusRes.statusText);
      process.exit(1);
    }

    const status = await statusRes.json() as MigrationStatusResponse;
    if (!status.canMigrate) {
      console.error('\nMigration blocked: Your cloud account already has data.');
      console.error('Sessions:', status.stats?.sessions || 0);
      console.error('Project Memory:', status.stats?.projectMemory || 0);
      console.error('Tasks:', status.stats?.tasks || 0);
      console.error('\nMigration is only available for new accounts to prevent data conflicts.');
      process.exit(1);
    }

    // Extract data from SQLite
    console.log('Reading local database...');

    const sessions = db.prepare('SELECT * FROM sessions').all();
    const contextItems = db.prepare('SELECT * FROM context_items').all();
    const checkpoints = db.prepare('SELECT * FROM checkpoints').all() as CheckpointRow[];
    const checkpointItemsRaw = db.prepare('SELECT * FROM checkpoint_items').all() as CheckpointItemRow[];
    const projectMemory = db.prepare('SELECT * FROM project_memory').all();
    const tasks = db.prepare('SELECT * FROM tasks').all();
    const sessionProjects = db.prepare('SELECT * FROM session_projects').all();
    const agentSessions = db.prepare('SELECT * FROM agent_sessions').all();

    // Group checkpoint items by checkpoint
    const checkpointItemsMap = new Map<string, CheckpointItemRow[]>();
    for (const item of checkpointItemsRaw) {
      const cpId = item.checkpoint_id;
      if (!checkpointItemsMap.has(cpId)) {
        checkpointItemsMap.set(cpId, []);
      }
      checkpointItemsMap.get(cpId)!.push(item);
    }

    // Add items array to checkpoints
    const checkpointsWithItems = checkpoints.map((cp) => ({
      ...cp,
      items: checkpointItemsMap.get(cp.id) || [],
    }));

    const stats: MigrationStats = {
      sessions: sessions.length,
      contextItems: contextItems.length,
      checkpoints: checkpoints.length,
      checkpointItems: checkpointItemsRaw.length,
      projectMemory: projectMemory.length,
      tasks: tasks.length,
      sessionProjects: sessionProjects.length,
      agentSessions: agentSessions.length,
    };

    console.log('\nLocal data summary:');
    console.log('  Sessions:', stats.sessions);
    console.log('  Context Items:', stats.contextItems);
    console.log('  Checkpoints:', stats.checkpoints);
    console.log('  Project Memory:', stats.projectMemory);
    console.log('  Tasks:', stats.tasks);

    if (stats.sessions === 0 && stats.contextItems === 0) {
      console.log('\nNo data to migrate.');
      process.exit(0);
    }

    // Send to cloud (snake_case format - server will normalize)
    console.log('\nMigrating to cloud...');
    const migrateRes = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessions,
        contextItems,
        checkpoints: checkpointsWithItems,
        projectMemory,
        tasks,
        sessionProjects,
        agentSessions,
      }),
    });

    const result = await migrateRes.json() as MigrationResult;

    if (!migrateRes.ok) {
      console.error('\nMigration failed:', result.error || migrateRes.statusText);
      if (result.message) {
        console.error(result.message);
      }
      process.exit(1);
    }

    console.log('\n=== Migration Complete ===\n');
    console.log('Migrated:');
    console.log('  Sessions:', result.migrated?.sessions || 0);
    console.log('  Context Items:', result.migrated?.contextItems || 0);
    console.log('  Checkpoints:', result.migrated?.checkpoints || 0);
    console.log('  Project Memory:', result.migrated?.projectMemory || 0);
    console.log('  Tasks:', result.migrated?.tasks || 0);
    console.log('\nYour local data has been migrated to SaveContext Cloud!');
    console.log('You can now use cloud mode by setting SAVECONTEXT_API_KEY.\n');

  } finally {
    db.close();
  }
}

// Run if called directly
if (process.argv[1].includes('migrate')) {
  const apiKey = process.argv[2] || process.env.SAVECONTEXT_API_KEY;
  if (!apiKey) {
    console.error('Usage: savecontext-migrate <api-key>');
    console.error('Or set SAVECONTEXT_API_KEY environment variable');
    process.exit(1);
  }
  runMigration(apiKey).catch((err) => {
    console.error('Migration error:', err.message);
    process.exit(1);
  });
}
