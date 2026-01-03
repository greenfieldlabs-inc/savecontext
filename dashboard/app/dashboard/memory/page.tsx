import { getAllProjects } from '@/lib/db-adapter';
import { MemoryClient } from '@/components/dashboard/memory-client';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function MemoryPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const projectFilter = typeof searchParams.project === 'string' ? searchParams.project : undefined;
  const categoryFilter = typeof searchParams.category === 'string' ? searchParams.category : 'all';

  const projects = await getAllProjects();

  return (
    <MemoryClient
      projects={projects}
      initialProjectFilter={projectFilter}
      initialCategoryFilter={categoryFilter}
    />
  );
}
