import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

function getWriteDb() {
  const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
  return new Database(dbPath);
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing issue id' }, { status: 400 });
    }

    const db = getWriteDb();
    const now = Date.now();

    // Build dynamic update query (parent_id handled separately via dependencies)
    const allowedFields = ['title', 'description', 'details', 'status', 'priority', 'issue_type', 'project_path'];
    const setClauses: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(updates[field]);
      }
    }

    // Handle closed_at for closed status
    if (updates.status === 'closed') {
      setClauses.push('closed_at = ?');
      values.push(now);
    } else if (updates.status && updates.status !== 'closed') {
      setClauses.push('closed_at = NULL');
    }

    // Handle parent_id change via dependencies table
    if (updates.parent_id !== undefined) {
      // Remove existing parent-child dependency
      db.prepare(`
        DELETE FROM issue_dependencies
        WHERE issue_id = ? AND dependency_type = 'parent-child'
      `).run(id);

      // Add new parent-child dependency if parent_id is set
      if (updates.parent_id) {
        const depId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
          VALUES (?, ?, ?, 'parent-child', ?)
        `).run(depId, id, updates.parent_id, now);
      }
    }

    // Handle add_project_path (multi-project support)
    if (updates.add_project_path) {
      const existing = db.prepare(
        'SELECT 1 FROM issue_projects WHERE issue_id = ? AND project_path = ?'
      ).get(id, updates.add_project_path);

      if (!existing) {
        db.prepare(
          'INSERT INTO issue_projects (issue_id, project_path, added_at) VALUES (?, ?, ?)'
        ).run(id, updates.add_project_path, now);
      }
    }

    // Handle remove_project_path (multi-project support)
    if (updates.remove_project_path) {
      db.prepare(
        'DELETE FROM issue_projects WHERE issue_id = ? AND project_path = ?'
      ).run(id, updates.remove_project_path);
    }

    values.push(id);
    db.prepare(`UPDATE issues SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    db.close();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating issue:', error);
    return NextResponse.json({ error: 'Failed to update issue' }, { status: 500 });
  }
}
