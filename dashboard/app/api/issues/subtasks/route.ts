import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get('parentId');

    if (!parentId) {
      return NextResponse.json({ error: 'Missing parentId' }, { status: 400 });
    }

    const db = getDatabase();
    // Single query with child counts using correlated subqueries
    const issuesWithCounts = db.prepare(`
      SELECT i.*,
        (SELECT COUNT(*) FROM issue_dependencies
         WHERE depends_on_id = i.id AND dependency_type = 'parent-child') as child_count,
        (SELECT COUNT(*) FROM issue_dependencies dep2
         JOIN issues i2 ON i2.id = dep2.issue_id
         WHERE dep2.depends_on_id = i.id AND dep2.dependency_type = 'parent-child' AND i2.status = 'closed') as completed_count
      FROM issues i
      JOIN issue_dependencies dep ON i.id = dep.issue_id
      WHERE dep.depends_on_id = ? AND dep.dependency_type = 'parent-child'
      ORDER BY i.created_at ASC
    `).all(parentId) as Array<Record<string, unknown>>;

    return NextResponse.json({ success: true, issues: issuesWithCounts });
  } catch (error) {
    console.error('Error fetching subtasks:', error);
    return NextResponse.json({ error: 'Failed to fetch subtasks' }, { status: 500 });
  }
}
