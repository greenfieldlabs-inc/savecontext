import { getWriteDatabase } from '@/lib/db';
import { emitMemoryEvent } from '@/lib/events';
import { parseJsonBody, isJsonError, apiSuccess, apiError, apiServerError } from '@/lib/api-utils';
import { SaveMemorySchema, validate } from '@/lib/validation/schemas';

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (isJsonError(body)) return body;

  // Validate request body
  const validation = validate(SaveMemorySchema, body);
  if (!validation.success) {
    return apiError(validation.error);
  }

  const { projectPath, key, value, category } = validation.data;

  const db = getWriteDatabase();
  try {
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

    emitMemoryEvent('saved', projectPath, key);
    return apiSuccess({ saved: true });
  } catch (error) {
    console.error('Error saving memory:', error);
    return apiServerError('Failed to save memory');
  }
}
