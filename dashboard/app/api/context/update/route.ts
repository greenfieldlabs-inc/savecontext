import { NextResponse } from 'next/server';
import { updateContextItem, getSessionById } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, sessionId, value, category, priority, channel } = body;

    if (!key || !sessionId) {
      return NextResponse.json(
        { error: 'Missing required fields: key and sessionId' },
        { status: 400 }
      );
    }

    // Verify the session exists
    const session = getSessionById(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
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
      return NextResponse.json(
        { error: 'Context item not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Context item updated successfully'
    });
  } catch (error) {
    console.error('Error updating context item:', error);
    return NextResponse.json(
      { error: 'Failed to update context item' },
      { status: 500 }
    );
  }
}
