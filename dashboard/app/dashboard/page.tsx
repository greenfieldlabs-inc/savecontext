import { getAllProjects, getStats } from '@/lib/db-adapter';
import { FolderKanban, Activity, Bookmark, Brain, CheckSquare } from 'lucide-react';
import { ProjectCard } from '@/components/projects/project-card';
import { ProjectsHeader } from '@/components/projects/projects-header';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await getAllProjects();
  const stats = await getStats();

  return (
    <div className="space-y-8">
      {/* Header */}
      <ProjectsHeader />

      {/* Stats Grid */}
      <div className="grid gap-3 sm:gap-6 grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Sessions"
          value={stats.total_sessions}
          icon={FolderKanban}
          subtitle={`${stats.active_sessions} active`}
        />
        <StatCard
          title="Context Items"
          value={stats.total_context_items}
          icon={Activity}
          subtitle="Across all sessions"
        />
        <StatCard
          title="Checkpoints"
          value={stats.total_checkpoints}
          icon={Bookmark}
          subtitle="Saved snapshots"
        />
        <StatCard
          title="Memory Items"
          value={stats.total_memory_items}
          icon={Brain}
          subtitle="Commands, configs & notes"
        />
        <StatCard
          title="Issues"
          value={stats.tasks_todo}
          icon={CheckSquare}
          subtitle={`${stats.tasks_done} closed`}
        />
        <StatCard
          title="Projects"
          value={stats.total_projects}
          icon={FolderKanban}
          subtitle="Unique repositories"
        />
      </div>

      {/* Projects List */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          All Projects
        </h2>
        {projects.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
            <div className="mx-auto max-w-lg space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                <FolderKanban className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  No Projects Yet
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Start using the SaveContext MCP server to track your coding sessions.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left dark:border-zinc-700 dark:bg-zinc-900">
                <p className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Quick Setup:</p>
                <ol className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">1</span>
                    <span>Install savecontext: npm install -g savecontext</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">2</span>
                    <span>Run: npx savecontext install</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">3</span>
                    <span>Start coding and sessions will appear here</span>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  subtitle: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm transition-all hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400 truncate">{title}</p>
          <p className="mt-1 sm:mt-2 text-xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {value.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500 truncate">{subtitle}</p>
        </div>
        <div className="rounded-lg bg-accent p-2 sm:p-2.5 shrink-0 ml-2">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-accent-foreground" />
        </div>
      </div>
    </div>
  );
}

