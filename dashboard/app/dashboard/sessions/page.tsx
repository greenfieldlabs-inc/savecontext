import { getAllSessionsWithAgents, getAllProjects, getSessionsByProjectWithAgents } from '@/lib/db-adapter';
import { FolderKanban } from 'lucide-react';
import { SessionFilters } from '@/components/dashboard/session-filters';
import { SessionCardContent } from '@/components/dashboard/session-card-content';
import Link from 'next/link';
import type { SessionStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function SessionsPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const projectIdFilter = typeof searchParams.projectId === 'string' ? searchParams.projectId : undefined;
  const statusFilter = typeof searchParams.status === 'string' ? searchParams.status : 'all';
  const searchFilter = typeof searchParams.search === 'string' ? searchParams.search.toLowerCase() : '';

  const projects = await getAllProjects();

  // Find project path from project ID filter
  const selectedProject = projectIdFilter ? projects.find(p => p.id === projectIdFilter) : undefined;
  const projectPath = selectedProject?.source_path || selectedProject?.project_path;

  let filteredSessions = projectPath
    ? await getSessionsByProjectWithAgents(projectPath)
    : await getAllSessionsWithAgents();

  // Apply status filter
  if (statusFilter !== 'all') {
    filteredSessions = filteredSessions.filter(s => s.status === statusFilter);
  }

  // Apply search filter (name or description)
  if (searchFilter) {
    filteredSessions = filteredSessions.filter(s =>
      s.name.toLowerCase().includes(searchFilter) ||
      (s.description && s.description.toLowerCase().includes(searchFilter))
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sessions
        </h1>
        <p className="mt-1 sm:mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          All your AI coding sessions across projects
        </p>
      </div>

      {/* Filters */}
      <SessionFilters
        projects={projects}
        currentProjectId={projectIdFilter}
        currentStatus={statusFilter}
        currentSearch={searchFilter}
      />

      {/* Sessions List */}
      <div className="space-y-3">
        {filteredSessions.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
            <div className="mx-auto max-w-lg space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                <FolderKanban className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {projectIdFilter || statusFilter !== 'all' || searchFilter ? 'No sessions found' : 'No Sessions Yet'}
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {projectIdFilter || statusFilter !== 'all' || searchFilter
                    ? 'Try adjusting your filters or search term'
                    : 'Your AI agent will automatically create sessions when you start coding with the SaveContext MCP server.'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          filteredSessions.map((session) => {
            // Build URL with navigation context
            const detailUrl = projectIdFilter
              ? `/dashboard/sessions/${session.id}?fromProjectId=${encodeURIComponent(projectIdFilter)}`
              : `/dashboard/sessions/${session.id}`;

            return (
              <Link
                key={session.id}
                href={detailUrl}
                className="group relative block rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm transition-all hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <SessionCardContent
                  sessionId={session.id}
                  sessionName={session.name}
                  sessionDescription={session.description}
                  sessionStatus={session.status as SessionStatus}
                  projectNames={session.all_project_paths.map((path) => path.split('/').pop() || path)}
                  createdAt={session.created_at}
                />
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
