'use client';

import { useState } from 'react';
import type { Checkpoint } from '@/lib/types';
import { Bookmark, X, Calendar, FileText } from 'lucide-react';
import { CheckpointModal } from '../dialogs/checkpoint-modal';

interface CheckpointListProps {
  checkpoints: Checkpoint[];
}

export function CheckpointList({ checkpoints }: CheckpointListProps) {
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint | null>(null);

  return (
    <>
      <div className="space-y-2">
        {checkpoints.map((checkpoint) => (
          <button
            key={checkpoint.id}
            onClick={() => setSelectedCheckpoint(checkpoint)}
            className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-all hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--checkpoint-bg))]">
                <Bookmark className="h-4 w-4 text-[rgb(var(--checkpoint-foreground))]" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                  {checkpoint.name}
                </h3>
                {checkpoint.description && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                    {checkpoint.description}
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
                  <Calendar className="h-3 w-3" />
                  {new Date(checkpoint.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Checkpoint Modal */}
      {selectedCheckpoint && (
        <CheckpointModal
          checkpoint={selectedCheckpoint}
          onClose={() => setSelectedCheckpoint(null)}
        />
      )}
    </>
  );
}
