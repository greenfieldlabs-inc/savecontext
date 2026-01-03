import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

function getWriteDb() {
  const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
  return new Database(dbPath);
}

export async function POST(request: Request) {
  try {
    const { projectPath, key, value, category } = await request.json();

    if (!projectPath || !key || !value) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getWriteDb();
    const now = Date.now();

    // Check if exists
    const existing = db.prepare(
      'SELECT id FROM project_memory WHERE project_path = ? AND key = ?'
    ).get(projectPath, key) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        'UPDATE project_memory SET value = ?, category = ?, updated_at = ? WHERE project_path = ? AND key = ?'
      ).run(value, category || 'note', now, projectPath, key);
    } else {
      const id = crypto.randomUUID();
      db.prepare(
        'INSERT INTO project_memory (id, project_path, key, value, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, projectPath, key, value, category || 'note', now, now);
    }

    db.close();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving memory:', error);
    return NextResponse.json({ error: 'Failed to save memory' }, { status: 500 });
  }
}
