import { NextRequest, NextResponse } from 'next/server';
import { getCheckpointItems } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const items = getCheckpointItems(id);
    return NextResponse.json(items);
  } catch (error) {
    console.error('Failed to get checkpoint items:', error);
    return NextResponse.json(
      { error: 'Failed to load checkpoint items' },
      { status: 500 }
    );
  }
}
