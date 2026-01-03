import { NextResponse } from 'next/server';
import { getSessionById, getSessionStats } from '@/lib/db';

type Params = Promise<{ id: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  try {
    const { id } = await params;

    // Check session exists
    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const stats = getSessionStats(id);

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching session stats:', error);
    return NextResponse.json({ error: 'Failed to fetch session stats' }, { status: 500 });
  }
}
