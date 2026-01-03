import { NextResponse } from 'next/server';
import { deleteProject, getProjectBlockers } from '@/lib/db';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Missing project id' }, { status: 400 });
    }

    // Check for blockers before attempting delete
    const blockers = getProjectBlockers(id);

    if (blockers.plans.length > 0) {
      return NextResponse.json({
        error: 'Cannot delete project: has linked plans',
        blockers: {
          plans: blockers.plans.map(p => ({
            id: p.id,
            shortId: p.short_id,
            title: p.title
          }))
        },
        hint: 'Move or delete these plans first, then retry deletion'
      }, { status: 409 });
    }

    const result = deleteProject(id);

    if (!result.projectDeleted) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      deleted: {
        project: true,
        sessionsUnlinked: result.sessionsUnlinked,
        sessionProjectsRemoved: result.sessionProjectsRemoved,
        issueProjectsRemoved: result.issueProjectsRemoved
      }
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
