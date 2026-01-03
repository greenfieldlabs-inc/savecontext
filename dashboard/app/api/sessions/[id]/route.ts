import { NextResponse } from 'next/server';
import { getSessionById, updateSession, deleteSession } from '@/lib/db';

type Params = Promise<{ id: string }>;

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description } = body;

    // Validate at least one field to update
    if (name === undefined && description === undefined) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Build updates object
    const updates: { name?: string; description?: string } = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const changes = updateSession(id, updates);

    if (changes === 0) {
      return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating session:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Cannot delete active sessions
    if (session.status === 'active') {
      return NextResponse.json({ error: 'Cannot delete an active session' }, { status: 400 });
    }

    const result = deleteSession(id);

    if (result.sessionDeleted === 0) {
      return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deletedSessionId: id,
      deletedSessionName: session.name,
      itemsDeleted: result.itemsDeleted,
      checkpointsDeleted: result.checkpointsDeleted,
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
