import { getSessionById, updateSession, deleteSession } from '@/lib/db';
import { emitSessionEvent } from '@/lib/events';
import { apiSuccess, apiError, apiNotFound, apiServerError } from '@/lib/api-utils';

type Params = Promise<{ id: string }>;

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description } = body;

    // Validate at least one field to update
    if (name === undefined && description === undefined) {
      return apiError('No fields to update');
    }

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return apiNotFound('Session');
    }

    // Build updates object
    const updates: { name?: string; description?: string } = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const changes = updateSession(id, updates);

    if (changes === 0) {
      return apiServerError('Failed to update session');
    }

    emitSessionEvent('updated', id);
    return apiSuccess({ updated: true });
  } catch (error) {
    console.error('Error updating session:', error);
    return apiServerError('Failed to update session');
  }
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return apiNotFound('Session');
    }

    // Cannot delete active sessions
    if (session.status === 'active') {
      return apiError('Cannot delete an active session');
    }

    const result = deleteSession(id);

    if (result.sessionDeleted === 0) {
      return apiServerError('Failed to delete session');
    }

    emitSessionEvent('deleted', id);
    return apiSuccess({
      deletedSessionId: id,
      deletedSessionName: session.name,
      itemsDeleted: result.itemsDeleted,
      checkpointsDeleted: result.checkpointsDeleted,
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    return apiServerError('Failed to delete session');
  }
}
