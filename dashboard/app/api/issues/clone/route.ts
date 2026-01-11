import { NextResponse } from 'next/server';
import { getWriteDatabase } from '@/lib/db';
import type { CloneIssueRequest, CloneIssueResult } from '@/lib/types/issues';
import { emitIssueEvent } from '@/lib/events';

export async function POST(request: Request) {
  try {
    const body: CloneIssueRequest = await request.json();
    const { id, ...overrides } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing issue id' }, { status: 400 });
    }

    const db = getWriteDatabase();
    const now = Date.now();

    // Get the original issue
    const original = db.prepare(`
      SELECT i.*, GROUP_CONCAT(DISTINCT il.label) as labels_csv
      FROM issues i
      LEFT JOIN issue_labels il ON i.id = il.issue_id
      WHERE i.id = ?
      GROUP BY i.id
    `).get(id) as {
      id: string;
      short_id: string;
      project_path: string;
      plan_id: string | null;
      title: string;
      description: string | null;
      details: string | null;
      status: string;
      priority: number;
      issue_type: string;
      labels_csv: string | null;
    } | null;

    if (!original) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    // Get the original's parent (if any)
    const parentDep = db.prepare(`
      SELECT depends_on_id FROM issue_dependencies
      WHERE issue_id = ? AND dependency_type = 'parent-child'
    `).get(original.id) as { depends_on_id: string } | null;

    const originalLabels = original.labels_csv ? original.labels_csv.split(',') : [];

    // Determine final values
    const newTitle = overrides.title || `Copy of ${original.title}`;
    const newDescription = overrides.description !== undefined ? overrides.description : original.description;
    const newDetails = overrides.details !== undefined ? overrides.details : original.details;
    const newStatus = overrides.status || 'open';
    const newPriority = overrides.priority !== undefined ? overrides.priority : original.priority;
    const newIssueType = overrides.issue_type || original.issue_type;
    const newParentId = overrides.parent_id !== undefined ? overrides.parent_id : (parentDep?.depends_on_id || null);
    const newPlanId = overrides.plan_id !== undefined ? overrides.plan_id : original.plan_id;

    // Labels: use override if provided, otherwise copy from original (if include_labels !== false)
    let newLabels: string[] = [];
    if (overrides.labels !== undefined) {
      newLabels = overrides.labels;
    } else if (overrides.include_labels !== false && originalLabels.length > 0) {
      newLabels = [...originalLabels];
    }

    // Generate new ID and short_id
    const newId = crypto.randomUUID();

    // Generate short_id - get the project's issue prefix
    const projectRow = db.prepare('SELECT issue_prefix FROM projects WHERE project_path = ?').get(original.project_path) as { issue_prefix: string } | null;
    const prefix = projectRow?.issue_prefix || original.project_path.split('/').pop()?.substring(0, 4).toUpperCase() || 'ISSUE';

    // Get the next number for this prefix
    const maxShortId = db.prepare(`
      SELECT short_id FROM issues
      WHERE project_path = ? AND short_id LIKE ?
      ORDER BY created_at DESC LIMIT 1
    `).get(original.project_path, `${prefix}-%`) as { short_id: string } | null;

    let nextNum = 1;
    if (maxShortId?.short_id) {
      const match = maxShortId.short_id.match(new RegExp(`^${prefix}-(\\w+)`));
      if (match) {
        nextNum = parseInt(match[1], 36) + 1;
      }
    }
    const newShortId = `${prefix}-${nextNum.toString(36)}`;

    // Insert the cloned issue
    db.prepare(`
      INSERT INTO issues (
        id, short_id, project_path, plan_id, title, description, details, status,
        priority, issue_type, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId, newShortId, original.project_path, newPlanId, newTitle, newDescription, newDetails,
      newStatus, newPriority, newIssueType, now, now
    );

    // Create parent-child dependency if there's a parent
    if (newParentId) {
      const depId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO issue_dependencies (id, issue_id, depends_on_id, dependency_type, created_at)
        VALUES (?, ?, ?, 'parent-child', ?)
      `).run(depId, newId, newParentId, now);
    }

    // Create labels if any
    if (newLabels.length > 0) {
      const labelStmt = db.prepare('INSERT OR IGNORE INTO issue_labels (id, issue_id, label) VALUES (?, ?, ?)');
      for (const label of newLabels) {
        labelStmt.run(crypto.randomUUID(), newId, label.trim().toLowerCase());
      }
    }

    emitIssueEvent('created', newId, original.project_path);

    const result: CloneIssueResult = {
      cloned: true,
      original_id: original.id,
      original_short_id: original.short_id,
      original_title: original.title,
      new_issue: {
        id: newId,
        short_id: newShortId,
        title: newTitle,
        status: newStatus as CloneIssueResult['new_issue']['status'],
        priority: newPriority as CloneIssueResult['new_issue']['priority'],
        issue_type: newIssueType as CloneIssueResult['new_issue']['issue_type'],
        labels: newLabels,
        parent_id: newParentId,
        plan_id: newPlanId,
      }
    };

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Error cloning issue:', error);
    return NextResponse.json({ error: 'Failed to clone issue' }, { status: 500 });
  }
}
