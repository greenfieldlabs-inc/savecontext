import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

function getDb() {
  const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
  return new Database(dbPath, { readonly: true });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get('parentId');

    if (!parentId) {
      return NextResponse.json({ error: 'Missing parentId' }, { status: 400 });
    }

    const db = getDb();
    // Query children via issue_dependencies table (parent-child relationship)
    const issues = db.prepare(`
      SELECT i.* FROM issues i
      JOIN issue_dependencies dep ON i.id = dep.issue_id
      WHERE dep.depends_on_id = ? AND dep.dependency_type = 'parent-child'
      ORDER BY i.created_at ASC
    `).all(parentId) as Array<Record<string, unknown>>;

    // Add child_count and completed_count for each subtask (3-level hierarchy: Epic -> Task -> Subtask)
    const issuesWithCounts = issues.map((issue) => {
      const childCount = db.prepare(`
        SELECT COUNT(*) as count FROM issue_dependencies
        WHERE depends_on_id = ? AND dependency_type = 'parent-child'
      `).get(issue.id) as { count: number };

      // Count closed children for progress indicator
      const completedCount = db.prepare(`
        SELECT COUNT(*) as count FROM issue_dependencies dep
        JOIN issues i ON i.id = dep.issue_id
        WHERE dep.depends_on_id = ? AND dep.dependency_type = 'parent-child' AND i.status = 'closed'
      `).get(issue.id) as { count: number };

      return { ...issue, child_count: childCount.count, completed_count: completedCount.count };
    });

    db.close();

    return NextResponse.json({ success: true, issues: issuesWithCounts });
  } catch (error) {
    console.error('Error fetching subtasks:', error);
    return NextResponse.json({ error: 'Failed to fetch subtasks' }, { status: 500 });
  }
}
