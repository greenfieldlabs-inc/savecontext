import { getSessionById, getContextItemsBySession, getCheckpointsBySession, getAgentsForSession } from '@/lib/db-adapter';
import { notFound } from 'next/navigation';
import { ChevronRight, Bookmark } from 'lucide-react';
import Link from 'next/link';
import { SessionDetailHeader } from '@/components/dashboard/session-detail-header';
import { ContextItemsSection } from '@/components/dashboard/context-items-section';
import { CheckpointList } from '@/components/dashboard/checkpoint-list';
import { ActiveAgentsSection } from '@/components/dashboard/active-agents-section';
import type { SessionStatus } from '@/lib/types';
import { LocalDate } from '@/components/ui/local-date';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function SessionDetailPage(props: { params: Params; searchParams: SearchParams }) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const session = await getSessionById(params.id);

  if (!session) {
    notFound();
  }

  const contextItems = await getContextItemsBySession(session.id);
  const checkpoints = await getCheckpointsBySession(session.id);
  const agents = await getAgentsForSession(session.id);

  // Use project path for breadcrumb
  const projectName = session.project_path?.split('/').pop() || 'Unknown';
  const projectHref = `/dashboard/sessions?project=${encodeURIComponent(session.project_path || '')}`;

  return (
    <div className="space-y-8">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base text-zinc-600 dark:text-zinc-400 overflow-x-auto">
        <Link
          href="/dashboard"
          className="hover:text-foreground transition-colors shrink-0"
        >
          Projects
        </Link>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
        <Link
          href={projectHref}
          className="hover:text-foreground transition-colors truncate max-w-[120px] sm:max-w-none"
        >
          {projectName}
        </Link>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
        <span className="font-medium text-zinc-900 dark:text-zinc-50 truncate">
          {session.name}
        </span>
      </nav>

      {/* Session Header */}
      <div className="space-y-4">
        <SessionDetailHeader
          sessionId={session.id}
          sessionName={session.name}
          sessionDescription={session.description}
          sessionStatus={session.status as SessionStatus}
        />

        {/* Session Meta */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
          <div>
            <span className="font-medium">Created:</span>{' '}
            <LocalDate date={session.created_at} />
          </div>
          <div>
            <span className="font-medium">Updated:</span>{' '}
            <LocalDate date={session.updated_at} />
          </div>
          {session.channel && (
            <div>
              <span className="font-medium">Channel:</span> {session.channel}
            </div>
          )}
        </div>

        {/* Agents */}
        {agents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Agents:</span>
            {agents.map((agent) => (
              <span
                key={agent.agent_id}
                className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
              >
                <span>{agent.provider}</span>
                {agent.git_branch && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span>{agent.git_branch}</span>
                  </>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Active Agents Section */}
      <ActiveAgentsSection agents={agents} />

      {/* Two Column Layout: Context Items + Checkpoints */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Context Items Timeline (2/3 width) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Context Items
            </h2>
            <span className="text-sm text-zinc-500 dark:text-zinc-500">
              {contextItems.length} items
            </span>
          </div>

          <ContextItemsSection items={contextItems} sessionId={session.id} />
        </div>

        {/* Checkpoints Sidebar (1/3 width) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Checkpoints
            </h2>
            <span className="text-sm text-zinc-500 dark:text-zinc-500">
              {checkpoints.length}
            </span>
          </div>

          {checkpoints.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
              <Bookmark className="mx-auto h-10 w-10 text-zinc-400 dark:text-zinc-600" />
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                No checkpoints saved for this session
              </p>
            </div>
          ) : (
            <CheckpointList checkpoints={checkpoints} />
          )}
        </div>
      </div>
    </div>
  );
}
