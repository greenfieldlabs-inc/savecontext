import { getAllProjects } from '@/lib/db-adapter';
import { IssuesClient } from '@/components/dashboard/issues/list/issues-list';
import type { DateFilterPreset } from '@/lib/constants/time';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function IssuesPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const projectFilter = typeof searchParams.project === 'string' ? searchParams.project : undefined;
  const statusFilter = typeof searchParams.status === 'string' ? searchParams.status : 'all';
  const dateFilter = typeof searchParams.date === 'string' ? searchParams.date as DateFilterPreset : 'all';
  const cloneIssueId = typeof searchParams.clone === 'string' ? searchParams.clone : undefined;
  const duplicateIssueId = typeof searchParams.duplicate === 'string' ? searchParams.duplicate : undefined;
  const reactivateIssueId = typeof searchParams.reactivate === 'string' ? searchParams.reactivate : undefined;

  const projects = await getAllProjects();

  return (
    <IssuesClient
      projects={projects}
      initialProjectFilter={projectFilter}
      initialStatusFilter={statusFilter}
      initialDateFilter={dateFilter}
      cloneIssueId={cloneIssueId}
      duplicateIssueId={duplicateIssueId}
      reactivateIssueId={reactivateIssueId}
    />
  );
}
