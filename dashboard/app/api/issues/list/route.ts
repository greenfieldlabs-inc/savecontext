import { getIssues, getIssueStats } from '@/lib/db-adapter';
import { relativeToAbsoluteTime } from '@/lib/constants/time';
import { VALID_STATUSES } from '@/lib/types/issues';
import { apiSuccess, apiError, apiServerError } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectPath = searchParams.get('projectPath') || undefined;
    const status = searchParams.get('status') || undefined;
    const priority = searchParams.get('priority');
    const issueType = searchParams.get('issueType') || searchParams.get('taskType');
    const parentId = searchParams.get('parentId');

    // Timestamp filters (relative time - converted to absolute)
    const createdInLastDays = searchParams.get('createdInLastDays');
    const createdInLastHours = searchParams.get('createdInLastHours');
    const updatedInLastDays = searchParams.get('updatedInLastDays');
    const updatedInLastHours = searchParams.get('updatedInLastHours');

    // Convert relative time to absolute timestamps
    const timeFilter = relativeToAbsoluteTime({
      createdInLastDays: createdInLastDays ? parseInt(createdInLastDays, 10) : undefined,
      createdInLastHours: createdInLastHours ? parseInt(createdInLastHours, 10) : undefined,
      updatedInLastDays: updatedInLastDays ? parseInt(updatedInLastDays, 10) : undefined,
      updatedInLastHours: updatedInLastHours ? parseInt(updatedInLastHours, 10) : undefined,
    });

    if (status && !(VALID_STATUSES as string[]).includes(status)) {
      return apiError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    let issues = await getIssues(projectPath, status, timeFilter);

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

    return apiSuccess({ issues, stats, count: issues.length });
  } catch (error) {
    console.error('Error fetching issues:', error);
    return apiServerError('Failed to fetch issues');
  }
}
