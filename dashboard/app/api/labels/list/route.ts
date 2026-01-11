import { NextResponse } from 'next/server';
import { getAllLabels } from '@/lib/db-adapter';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectPath = searchParams.get('projectPath') || undefined;
    const search = searchParams.get('search') || undefined;

    const labels = await getAllLabels(projectPath, search);

    return NextResponse.json({
      success: true,
      labels,
      count: labels.length
    });
  } catch (error) {
    console.error('Error fetching labels:', error);
    return NextResponse.json(
      { error: 'Failed to fetch labels' },
      { status: 500 }
    );
  }
}
