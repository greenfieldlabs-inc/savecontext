import { deleteContextItem, getSessionById } from '@/lib/db';
import { emitContextEvent } from '@/lib/events';
import { apiSuccess, apiError, apiNotFound, apiServerError } from '@/lib/api-utils';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, sessionId } = body;

    if (!key || !sessionId) {
      return apiError('Missing required fields: key and sessionId');
    }

    // Check session exists
    const session = getSessionById(sessionId);
    if (!session) {
      return apiNotFound('Session');
    }

    const changes = deleteContextItem(sessionId, key);

    if (changes === 0) {
      return apiNotFound('Context item');
    }

    emitContextEvent('deleted', sessionId, key);
    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error('Error deleting context item:', error);
    return apiServerError('Failed to delete context item');
  }
}
