import { NextResponse } from 'next/server';
import { getSessionById, updateSessionStatus } from '@/lib/db';
import { emitSessionEvent } from '@/lib/events';
import type { SessionStatus } from '@/lib/types';

type Params = Promise<{ id: string }>;

const VALID_STATUSES: SessionStatus[] = ['active', 'paused', 'completed'];

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    // Validate status
    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const changes = updateSessionStatus(id, status as SessionStatus);

    if (changes === 0) {
      return NextResponse.json({ error: 'Failed to update session status' }, { status: 500 });
    }

    emitSessionEvent('status_changed', id);
    return NextResponse.json({
      success: true,
      sessionId: id,
      status,
    });
  } catch (error) {
    console.error('Error updating session status:', error);
    return NextResponse.json({ error: 'Failed to update session status' }, { status: 500 });
  }
}
