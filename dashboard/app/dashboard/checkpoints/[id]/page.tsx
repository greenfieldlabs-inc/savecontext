import { getCheckpointById, getCheckpointItems, getSessionById } from '@/lib/db-adapter';
import { notFound } from 'next/navigation';
import { ChevronRight, Bookmark } from 'lucide-react';
import Link from 'next/link';
import { ContextItemCard } from '@/components/dashboard/context/shared/context-item-card';
import { LocalDate } from '@/components/ui/local-date';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function CheckpointDetailPage(props: { params: Params }) {
  const params = await props.params;
  const checkpoint = await getCheckpointById(params.id);

  if (!checkpoint) {
    notFound();
  }

  const items = await getCheckpointItems(checkpoint.id);
  const session = await getSessionById(checkpoint.session_id);

  return (
    <div className="space-y-8">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-base text-zinc-600 dark:text-zinc-400">
        <Link
          href="/dashboard"
          className="hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
        >
          Projects
        </Link>
        <ChevronRight className="h-5 w-5" />
        <Link
          href="/dashboard/checkpoints"
          className="hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
        >
          Checkpoints
        </Link>
        <ChevronRight className="h-5 w-5" />
        <span className="font-medium text-zinc-900 dark:text-zinc-50">
          {checkpoint.name}
        </span>
      </nav>

      {/* Checkpoint Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--checkpoint-bg))]">
              <Bookmark className="h-6 w-6 text-[rgb(var(--checkpoint-foreground))]" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {checkpoint.name}
              </h1>
              {checkpoint.description && (
                <p className="text-zinc-600 dark:text-zinc-400">
                  {checkpoint.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Checkpoint Meta */}
        <div className="flex flex-wrap gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <div>
            <span className="font-medium">Created:</span>{' '}
            <LocalDate date={checkpoint.created_at} />
          </div>
          <div>
            <span className="font-medium">Items:</span> {checkpoint.item_count}
          </div>
          {checkpoint.git_branch && (
            <div>
              <span className="font-medium">Branch:</span> {checkpoint.git_branch}
            </div>
          )}
          {session && (
            <div>
              <span className="font-medium">Session:</span>{' '}
              <Link
                href={`/dashboard/sessions/${session.id}`}
                className="text-zinc-900 hover:underline dark:text-zinc-50"
              >
                {session.name}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Context Items */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Checkpoint Contents
          </h2>
          <span className="text-sm text-zinc-500 dark:text-zinc-500">
            {items.length} items
          </span>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-12 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No items in this checkpoint
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <ContextItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
