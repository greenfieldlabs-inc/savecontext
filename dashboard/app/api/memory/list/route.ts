import { NextResponse } from 'next/server';
import { getMemoryItems } from '@/lib/db-adapter';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectPath = searchParams.get('projectPath') || undefined;
    const category = searchParams.get('category') || undefined;

    const memories = await getMemoryItems(
      projectPath,
      category as 'command' | 'config' | 'note' | undefined
    );

    return NextResponse.json({
      success: true,
      memories,
      count: memories.length
    });
  } catch (error) {
    console.error('Error fetching memory items:', error);
    return NextResponse.json(
      { error: 'Failed to fetch memory items' },
      { status: 500 }
    );
  }
}
