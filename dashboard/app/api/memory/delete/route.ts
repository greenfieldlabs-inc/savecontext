import { getWriteDatabase } from '@/lib/db';
import { emitMemoryEvent } from '@/lib/events';
import { apiSuccess, apiError, apiServerError } from '@/lib/api-utils';

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectPath = searchParams.get('projectPath');
  const key = searchParams.get('key');

  if (!projectPath || !key) {
    return apiError('Missing projectPath or key');
  }

  const db = getWriteDatabase();
  try {
    db.prepare('DELETE FROM project_memory WHERE project_path = ? AND key = ?').run(projectPath, key);
    emitMemoryEvent('deleted', projectPath, key);
    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error('Error deleting memory:', error);
    return apiServerError('Failed to delete memory');
  }
}
