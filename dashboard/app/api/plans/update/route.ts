import { getWriteDatabase } from '@/lib/db';
import { emitPlanEvent } from '@/lib/events';
import { parseJsonBody, isJsonError, apiSuccess, apiError, apiNotFound, apiServerError } from '@/lib/api-utils';
import { UpdatePlanSchema, validate } from '@/lib/validation/schemas';

export async function PATCH(request: Request) {
  const body = await parseJsonBody(request);
  if (isJsonError(body)) return body;

  // Validate core fields
  const validation = validate(UpdatePlanSchema, body);
  if (!validation.success) {
    return apiError(validation.error);
  }

  const { id, ...validatedUpdates } = validation.data;
  const updates: Record<string, unknown> = { ...(body as Record<string, unknown>), ...validatedUpdates };

  const db = getWriteDatabase();
  try {
    const now = Date.now();

    // Get current plan to check for project_path change
    const currentPlan = db.prepare('SELECT project_path FROM plans WHERE id = ?').get(id) as { project_path: string } | undefined;
    if (!currentPlan) {
      return apiNotFound('Plan');
    }

    // Track if we need to cascade project change to issues
    let newProjectPath: string | null = null;

    // If project_path is changing, look up the new project
    if (updates.project_path !== undefined && updates.project_path !== currentPlan.project_path) {
      const projectPath = updates.project_path as string;
      const newProject = db.prepare('SELECT id FROM projects WHERE project_path = ?').get(projectPath) as { id: string } | undefined;
      if (!newProject) {
        return apiError(`Project not found for path: ${projectPath}`);
      }
      newProjectPath = projectPath;

      // Also update project_id in the plan
      updates.project_id = newProject.id;
    }

    // Build dynamic update query
    const allowedFields = ['title', 'content', 'status', 'success_criteria', 'project_path', 'project_id'];
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(updates[field] as string | number | null);
      }
    }

    // Handle completed_at for completed status
    if (updates.status === 'completed') {
      setClauses.push('completed_at = ?');
      values.push(now);
    } else if (updates.status && updates.status !== 'completed') {
      setClauses.push('completed_at = NULL');
    }

    values.push(id);
    db.prepare(`UPDATE plans SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    // Cascade project change to all linked issues
    if (newProjectPath) {
      db.prepare(`
        UPDATE issues
        SET project_path = ?, updated_at = ?
        WHERE plan_id = ?
      `).run(newProjectPath, now, id);
    }

    emitPlanEvent('updated', id);
    return apiSuccess({ updated: true, cascaded: newProjectPath !== null });
  } catch (error) {
    console.error('Error updating plan:', error);
    return apiServerError('Failed to update plan');
  }
}
