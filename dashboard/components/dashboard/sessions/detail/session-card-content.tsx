'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers } from 'lucide-react';
import { InlineStatusSelect } from '@/components/dashboard/shared/inline-status-select';
import { InlineEdit } from '@/components/dashboard/shared/inline-edit';
import { SessionActions } from '../shared/session-actions';
import type { SessionStatus } from '@/lib/types';

interface SessionCardContentProps {
  sessionId: string;
  sessionName: string;
  sessionDescription?: string | null;
  sessionStatus: SessionStatus;
  projectNames: string[];
  createdAt: string | number | Date;
}

export function SessionCardContent({
  sessionId,
  sessionName,
  sessionDescription,
  sessionStatus,
  projectNames,
  createdAt,
}: SessionCardContentProps) {
  const router = useRouter();

  // Dedupe and limit project names
  const uniqueNames = [...new Set(projectNames)];
  const displayNames = uniqueNames.slice(0, 2);
  const remainingCount = uniqueNames.length - 2;

  const stopProp = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSave = async (field: 'name' | 'description', value: string) => {
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    router.refresh();
  };

  return (
    <>
      {/* Status and actions - top right */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-2" onClick={stopProp} onMouseDown={stopProp}>
        <InlineStatusSelect
          sessionId={sessionId}
          currentStatus={sessionStatus}
        />
        <SessionActions
          sessionId={sessionId}
          sessionName={sessionName}
          currentStatus={sessionStatus}
        />
      </div>

      <div className="flex gap-3 sm:gap-4 pr-32 sm:pr-40">
        <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Layers className="h-4 w-4 sm:h-5 sm:w-5 text-accent-foreground" />
        </div>
        <div className="space-y-1.5 min-w-0 flex-1">
          <InlineEdit
            value={sessionName}
            onSave={(v) => handleSave('name', v)}
            className="font-semibold text-zinc-900 dark:text-zinc-50"
            size="sm"
            stopPropagation
          />

          {sessionDescription ? (
            <InlineEdit
              value={sessionDescription}
              onSave={(v) => handleSave('description', v)}
              className="text-sm text-zinc-600 dark:text-zinc-400"
              multiline
              size="sm"
              stopPropagation
            />
          ) : (
            <InlineEdit
              value=""
              placeholder="Add description..."
              onSave={(v) => handleSave('description', v)}
              className="text-sm text-zinc-400 dark:text-zinc-500"
              size="sm"
              stopPropagation
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {displayNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {name}
              </span>
            ))}
            {remainingCount > 0 && (
              <span className="text-xs font-medium text-zinc-500">
                +{remainingCount} more
              </span>
            )}
            <span className="text-zinc-400">•</span>
            <span className="text-xs text-zinc-500 shrink-0">
              {new Date(createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
