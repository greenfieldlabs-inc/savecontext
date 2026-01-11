import { NextResponse } from 'next/server';
import { getWriteDatabase } from '@/lib/db';
import { emitIssueEvent } from '@/lib/events';
import { parseJsonBody, isJsonError } from '@/lib/api-utils';

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (isJsonError(body)) return body;

  const { id, duplicate_of_id } = body as { id?: string; duplicate_of_id?: string };

  if (!id) {
    return NextResponse.json({ error: 'Missing issue id' }, { status: 400 });
  }

  if (!duplicate_of_id) {
    return NextResponse.json({ error: 'Missing duplicate_of_id' }, { status: 400 });
  }

  const db = getWriteDatabase();
  try {
    const now = Date.now();

    // Get the issue to mark as duplicate
    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as { id: string; title: string; status: string } | null;
    if (!issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    // Get the canonical issue
    const canonicalIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(duplicate_of_id) as { id: string; short_id: string; title: string } | null;
    if (!canonicalIssue) {
      return NextResponse.json({ error: 'Canonical issue not found' }, { status: 404 });
    }

    // Update issue status to closed and set closed_at
    // Note: "duplicate" is a relation type, not a status - status becomes "closed"
    db.prepare(`
      UPDATE issues
      SET status = 'closed', closed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id);

    // Create duplicate-of dependency (check if exists first to avoid silent failures)
    let dependencyCreated = false;
    const existingDep = db.prepare(`
      SELECT id FROM issue_dependencies
      WHERE issue_id = ? AND depends_on_id = ? AND dependency_type = 'duplicate-of'
    `).get(id, duplicate_of_id);

    if (existingDep) {
      dependencyCreated = true; // Already exists, that's fine
    } else {
      const depId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
        VALUES (?, ?, ?, 'duplicate-of', ?)
      `).run(depId, id, duplicate_of_id, now);
      dependencyCreated = true;
    }

    // Get the updated issue
    const updatedIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as { id: string; short_id: string; title: string; status: string; closed_at: number };
    emitIssueEvent('updated', id);

    return NextResponse.json({
      success: true,
      data: {
        marked_duplicate: true,
        id: updatedIssue.id,
        shortId: updatedIssue.short_id,
        title: updatedIssue.title,
        status: updatedIssue.status,
        duplicate_of_id: canonicalIssue.id,
        duplicate_of_short_id: canonicalIssue.short_id,
        duplicate_of_title: canonicalIssue.title,
        closedAt: updatedIssue.closed_at,
        dependency_created: dependencyCreated
      }
    });
  } catch (error) {
    console.error('Error marking issue as duplicate:', error);
    return NextResponse.json({ error: 'Failed to mark issue as duplicate' }, { status: 500 });
  }
}
