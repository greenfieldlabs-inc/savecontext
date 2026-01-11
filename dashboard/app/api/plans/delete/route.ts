import { getWriteDatabase } from '@/lib/db';
import { emitPlanEvent } from '@/lib/events';
import { parseJsonBody, isJsonError, apiSuccess, apiError, apiServerError } from '@/lib/api-utils';

// GET: Fetch tasks that will be deleted with this plan (for confirmation)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('Missing plan id');
  }

  const db = getWriteDatabase();
  try {
    const issues = db.prepare('SELECT id, short_id, title FROM issues WHERE plan_id = ?')
      .all(id) as { id: string; short_id: string; title: string }[];
    return apiSuccess({ issues });
  } catch (error) {
    console.error('Error fetching plan issues:', error);
    return apiServerError('Failed to fetch plan issues');
  }
}

export async function DELETE(request: Request) {
  const body = await parseJsonBody(request);
  if (isJsonError(body)) return body;

  const { id } = body as { id?: string };

  if (!id) {
    return apiError('Missing plan id');
  }

  const db = getWriteDatabase();
  try {
    // Delete issues associated with this plan
    const result = db.prepare('DELETE FROM issues WHERE plan_id = ?').run(id);
    const deletedIssueCount = result.changes;

    // Delete plan
    db.prepare('DELETE FROM plans WHERE id = ?').run(id);
    emitPlanEvent('deleted', id);
    return apiSuccess({ deleted: true, deletedIssueCount });
  } catch (error) {
    console.error('Error deleting plan:', error);
    return apiServerError('Failed to delete plan');
  }
}
