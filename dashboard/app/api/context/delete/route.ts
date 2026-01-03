import { NextResponse } from 'next/server';
import { deleteContextItem, getSessionById } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, sessionId } = body;

    if (!key || !sessionId) {
      return NextResponse.json(
        { error: 'Missing required fields: key and sessionId' },
        { status: 400 }
      );
    }

    // Check session exists
    const session = getSessionById(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const changes = deleteContextItem(sessionId, key);

    if (changes === 0) {
      return NextResponse.json({ error: 'Context item not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Context item deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting context item:', error);
    return NextResponse.json({ error: 'Failed to delete context item' }, { status: 500 });
  }
}
