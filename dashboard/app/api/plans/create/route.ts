import { getWriteDatabase } from '@/lib/db';
import type { Database } from 'bun:sqlite';
import { emitPlanEvent } from '@/lib/events';
import { parseJsonBody, isJsonError, apiSuccess, apiError, apiNotFound, apiServerError } from '@/lib/api-utils';
import { CreatePlanSchema, validate } from '@/lib/validation/schemas';

function getProject(db: Database, projectPath: string): { id: string } | null {
  const existing = db.prepare(
    'SELECT id FROM projects WHERE project_path = ?'
  ).get(projectPath) as { id: string } | undefined;

  return existing || null;
}

function generateShortId(db: Database, projectId: string): string {
  // Get and increment the next plan number for this project
  const project = db.prepare(
    'SELECT next_plan_number FROM projects WHERE id = ?'
  ).get(projectId) as { next_plan_number: number } | undefined;

  const nextNum = project?.next_plan_number || 1;

  // Update the counter
  db.prepare(
    'UPDATE projects SET next_plan_number = ?, updated_at = ? WHERE id = ?'
  ).run(nextNum + 1, Date.now(), projectId);

  return `P-${nextNum}`;
}

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (isJsonError(body)) return body;

  // Validate request body
  const validation = validate(CreatePlanSchema, body);
  if (!validation.success) {
    return apiError(validation.error);
  }

  const { projectPath, title, content, status, successCriteria } = validation.data;

  const db = getWriteDatabase();
  try {
    const now = Date.now();
    const id = crypto.randomUUID();

    // Get project - must exist
    const project = getProject(db, projectPath);
    if (!project) {
      return apiNotFound('Project. Create the project first using context_project_create');
    }
    const projectId = project.id;
    const shortId = generateShortId(db, projectId);

    db.prepare(`
      INSERT INTO plans (id, short_id, project_id, project_path, title, content, status, success_criteria, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, shortId, projectId, projectPath, title, content || null, status || 'draft', successCriteria || null, now, now);

    emitPlanEvent('created', id);
    return apiSuccess({ id, short_id: shortId });
  } catch (error) {
    console.error('Error creating plan:', error);
    return apiServerError('Failed to create plan');
  }
}
