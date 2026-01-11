import { updateContextItem, getSessionById } from '@/lib/db';
import { emitContextEvent } from '@/lib/events';
import { apiSuccess, apiError, apiNotFound, apiServerError } from '@/lib/api-utils';
import { ContextCategorySchema, ContextPrioritySchema } from '@/lib/validation/schemas';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, sessionId, value, category, priority, channel } = body;

    if (!key || !sessionId) {
      return apiError('Missing required fields: key and sessionId');
    }

    // Validate category if provided
    if (category !== undefined) {
      const categoryResult = ContextCategorySchema.safeParse(category);
      if (!categoryResult.success) {
        return apiError('Invalid category: must be one of reminder, decision, progress, note');
      }
    }

    // Validate priority if provided
    if (priority !== undefined) {
      const priorityResult = ContextPrioritySchema.safeParse(priority);
      if (!priorityResult.success) {
        return apiError('Invalid priority: must be one of high, normal, low');
      }
    }

    // Verify the session exists
    const session = getSessionById(sessionId);
    if (!session) {
      return apiNotFound('Session');
    }

    // Build update data
    const updates: { value?: string; category?: string; priority?: string; channel?: string } = {};

    if (value !== undefined) updates.value = value;
    if (category !== undefined) updates.category = category;
    if (priority !== undefined) updates.priority = priority;
    if (channel !== undefined) updates.channel = channel;

    // Update the context item
    const changes = updateContextItem(sessionId, key, updates);

    if (changes === 0) {
      return apiNotFound('Context item');
    }

    emitContextEvent('updated', sessionId, key);
    return apiSuccess({ updated: true });
  } catch (error) {
    console.error('Error updating context item:', error);
    return apiServerError('Failed to update context item');
  }
}
