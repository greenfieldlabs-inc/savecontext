import { getAllCheckpoints, getCheckpointsByProject, getAllProjects } from '@/lib/db-adapter';
import { Bookmark } from 'lucide-react';
import { SessionFilters } from '@/components/dashboard/session-filters';
import Link from 'next/link';
import { LocalDate } from '@/components/ui/local-date';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function CheckpointsPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const projectIdFilter = typeof searchParams.projectId === 'string' ? searchParams.projectId : undefined;

  const projects = await getAllProjects();

  const selectedProject = projectIdFilter ? projects.find(p => p.id === projectIdFilter) : undefined;
  const projectPath = selectedProject?.source_path || selectedProject?.project_path;

  const checkpoints = projectPath
    ? await getCheckpointsByProject(projectPath)
    : await getAllCheckpoints();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Checkpoints
        </h1>
        <p className="mt-1 sm:mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Saved snapshots of your session state
        </p>
      </div>

      {/* Filters */}
      <SessionFilters
        projects={projects}
        currentProjectId={projectIdFilter}
        currentStatus="all"
        hideStatusFilter
      />

      {/* Checkpoints Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {checkpoints.length === 0 ? (
          <div className="col-span-full rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
            <div className="mx-auto max-w-lg space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                <Bookmark className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {projectIdFilter ? 'No checkpoints found' : 'No Checkpoints Yet'}
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {projectIdFilter
                    ? 'Try adjusting your filters'
                    : 'Have your AI agent call the context_checkpoint tool in your project to save session snapshots.'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          checkpoints.map((checkpoint) => (
            <Link
              key={checkpoint.id}
              href={`/dashboard/checkpoints/${checkpoint.id}`}
              className="group rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm transition-all hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="rounded-lg bg-[rgb(var(--checkpoint-bg))] p-2.5">
                    <Bookmark className="h-5 w-5 text-[rgb(var(--checkpoint-foreground))]" />
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-500">
                    {checkpoint.item_count} items
                  </span>
                </div>

                <div>
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {checkpoint.name}
                  </h3>
                  {checkpoint.description && (
                    <p className="mt-1 text-sm text-zinc-600 line-clamp-2 dark:text-zinc-400">
                      {checkpoint.description}
                    </p>
                  )}
                </div>

                <div className="text-xs text-zinc-500 dark:text-zinc-500">
                  <LocalDate date={checkpoint.created_at} />
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
