import { getWriteDatabase } from '@/lib/db';
import { emitIssueEvent } from '@/lib/events';
import { parseJsonBody, isJsonError, apiSuccess, apiError, apiServerError } from '@/lib/api-utils';
import { UpdateIssueSchema, validate } from '@/lib/validation/schemas';

export async function PATCH(request: Request) {
  const body = await parseJsonBody(request);
  if (isJsonError(body)) return body;

  // Validate core fields (id, status, priority, issueType)
  const validation = validate(UpdateIssueSchema, body);
  if (!validation.success) {
    return apiError(validation.error);
  }

  const { id, ...validatedUpdates } = validation.data;
  // Merge with other fields not in schema (parent_id, add_project_path, etc.)
  const updates: Record<string, unknown> = { ...(body as Record<string, unknown>), ...validatedUpdates };

  const db = getWriteDatabase();
  try {
    const now = Date.now();

    // Build dynamic update query (parent_id handled separately via dependencies)
    const allowedFields = ['title', 'description', 'details', 'status', 'priority', 'issue_type', 'project_path'];
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(updates[field] as string | number | null);
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
        `).run(depId, id, updates.parent_id as string, now);
      }
    }

    // Handle add_project_path (multi-project support)
    if (updates.add_project_path) {
      const addPath = updates.add_project_path as string;
      const existing = db.prepare(
        'SELECT 1 FROM issue_projects WHERE issue_id = ? AND project_path = ?'
      ).get(id, addPath);

      if (!existing) {
        db.prepare(
          'INSERT INTO issue_projects (issue_id, project_path, added_at) VALUES (?, ?, ?)'
        ).run(id, addPath, now);
      }
    }

    // Handle remove_project_path (multi-project support)
    if (updates.remove_project_path) {
      db.prepare(
        'DELETE FROM issue_projects WHERE issue_id = ? AND project_path = ?'
      ).run(id, updates.remove_project_path as string);
    }

    values.push(id);
    db.prepare(`UPDATE issues SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    emitIssueEvent('updated', id);
    return apiSuccess({ updated: true });
  } catch (error) {
    console.error('Error updating issue:', error);
    return apiServerError('Failed to update issue');
  }
}
