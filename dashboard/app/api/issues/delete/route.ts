import { getWriteDatabase } from '@/lib/db';
import { emitIssueEvent } from '@/lib/events';
import { apiSuccess, apiError, apiServerError } from '@/lib/api-utils';

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('Missing issue id');
  }

  const db = getWriteDatabase();
  try {
    // Delete subtasks first (children found via dependencies table)
    db.prepare(`
      DELETE FROM issues WHERE id IN (
        SELECT issue_id FROM issue_dependencies
        WHERE depends_on_id = ? AND dependency_type = 'parent-child'
      )
    `).run(id);
    // Delete issue (CASCADE will handle dependencies)
    db.prepare('DELETE FROM issues WHERE id = ?').run(id);
    emitIssueEvent('deleted', id);
    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error('Error deleting issue:', error);
    return apiServerError('Failed to delete issue');
  }
}
