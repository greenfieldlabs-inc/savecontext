import { NextResponse } from 'next/server';
import { getIssues, getIssueStats } from '@/lib/db-adapter';

const VALID_STATUSES = ['open', 'in_progress', 'blocked', 'closed', 'deferred'];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectPath = searchParams.get('projectPath') || undefined;
    const status = searchParams.get('status') || undefined;
    const priority = searchParams.get('priority');
    const issueType = searchParams.get('issueType') || searchParams.get('taskType');
    const parentId = searchParams.get('parentId');

    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    let issues = await getIssues(projectPath, status);

    // Additional client-side filtering for priority and issueType
    if (priority) {
      const priorityNum = parseInt(priority, 10);
      if (!isNaN(priorityNum)) {
        issues = issues.filter(i => i.priority === priorityNum);
      }
    }

    if (issueType) {
      issues = issues.filter(i => i.issue_type === issueType);
    }

    // Filter by parent: parentId=<id> for children, parentId=null for root issues
    if (parentId !== null) {
      if (parentId === 'null' || parentId === '') {
        // Return root issues only (no parent)
        issues = issues.filter(i => !i.parent);
      } else {
        // Return children of specific parent
        issues = issues.filter(i => i.parent?.id === parentId);
      }
    }

    const stats = await getIssueStats(projectPath);

    return NextResponse.json({
      success: true,
      issues,
      stats,
      count: issues.length
    });
  } catch (error) {
    console.error('Error fetching issues:', error);
    return NextResponse.json(
      { error: 'Failed to fetch issues' },
      { status: 500 }
    );
  }
}
