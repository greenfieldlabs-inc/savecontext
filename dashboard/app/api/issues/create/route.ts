import { NextResponse } from 'next/server';
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

function getWriteDb() {
  const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
  return new Database(dbPath);
}

function generateShortId(db: Database, projectPath: string, parentId?: string): string {
  if (parentId) {
    // Get parent's short_id and count existing children via dependencies
    const parent = db.prepare('SELECT short_id FROM issues WHERE id = ?').get(parentId) as { short_id: string } | undefined;
    if (parent) {
      const childCount = db.prepare(`
        SELECT COUNT(*) as count FROM issue_dependencies
        WHERE depends_on_id = ? AND dependency_type = 'parent-child'
      `).get(parentId) as { count: number };
      return `${parent.short_id}.${childCount.count + 1}`;
    }
  }
  // Root-level issue
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM issues WHERE project_path = ?'
  ).get(projectPath) as { count: number };
  return `I-${result.count + 1}`;
}

export async function POST(request: Request) {
  try {
    const { projectPath, title, description, status, priority, issueType, parentId, dependsOn } = await request.json();

    if (!projectPath || !title) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getWriteDb();
    const now = Date.now();
    const id = crypto.randomUUID();
    const shortId = generateShortId(db, projectPath, parentId);

    // Insert issue without parent_id column
    db.prepare(`
      INSERT INTO issues (id, short_id, project_path, title, description, status, priority, issue_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, shortId, projectPath, title, description || null, status || 'open', priority || 0, issueType || 'task', now, now);

    // Create parent-child dependency if parentId provided
    if (parentId) {
      const depId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
        VALUES (?, ?, ?, 'parent-child', ?)
      `).run(depId, id, parentId, now);
    }

    // Create "blocks" dependencies if dependsOn array provided
    if (dependsOn && Array.isArray(dependsOn) && dependsOn.length > 0) {
      const insertDep = db.prepare(`
        INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
        VALUES (?, ?, ?, 'blocks', ?)
      `);
      for (const depOnId of dependsOn) {
        insertDep.run(crypto.randomUUID(), id, depOnId, now);
      }
      // Mark the new issue as blocked if any dependency is not closed
      const openDeps = db.prepare(`
        SELECT COUNT(*) as count FROM issues WHERE id IN (${dependsOn.map(() => '?').join(',')}) AND status != 'closed'
      `).get(...dependsOn) as { count: number };
      if (openDeps.count > 0) {
        db.prepare('UPDATE issues SET status = ? WHERE id = ?').run('blocked', id);
      }
    }

    db.close();
    return NextResponse.json({ success: true, id, short_id: shortId });
  } catch (error) {
    console.error('Error creating issue:', error);
    return NextResponse.json({ error: 'Failed to create issue' }, { status: 500 });
  }
}
