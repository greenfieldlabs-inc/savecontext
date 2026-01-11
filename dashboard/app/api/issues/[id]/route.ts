import { NextRequest, NextResponse } from 'next/server';
import { getIssueById } from '@/lib/db-adapter';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Issue ID is required' }, { status: 400 });
    }

    const issue = await getIssueById(id);

    if (!issue) {
      return NextResponse.json({ success: false, error: 'Issue not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, issue });
  } catch (error) {
    console.error('Failed to get issue:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get issue' },
      { status: 500 }
    );
  }
}
