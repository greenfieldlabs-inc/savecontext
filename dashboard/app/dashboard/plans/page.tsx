import { getAllProjects } from '@/lib/db-adapter';
import { PlansClient } from '@/components/dashboard/plans-client';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function PlansPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const projectFilter = typeof searchParams.project === 'string' ? searchParams.project : undefined;
  const statusFilter = typeof searchParams.status === 'string' ? searchParams.status : 'all';

  const projects = await getAllProjects();

  return (
    <PlansClient
      projects={projects}
      initialProjectFilter={projectFilter}
      initialStatusFilter={statusFilter}
    />
  );
}
