import { getAllProjects } from '@/lib/db-adapter';
import { IssuesClient } from '@/components/dashboard/issues-client';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function IssuesPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const projectFilter = typeof searchParams.project === 'string' ? searchParams.project : undefined;
  const statusFilter = typeof searchParams.status === 'string' ? searchParams.status : 'all';

  const projects = await getAllProjects();

  return (
    <IssuesClient
      projects={projects}
      initialProjectFilter={projectFilter}
      initialStatusFilter={statusFilter}
    />
  );
}
