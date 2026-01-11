'use client';

import { useRouter } from 'next/navigation';
import { Layers } from 'lucide-react';
import { InlineStatusSelect } from '@/components/dashboard/shared/inline-status-select';
import { InlineEdit } from '@/components/dashboard/shared/inline-edit';
import { SessionActions } from '../shared/session-actions';
import type { SessionStatus } from '@/lib/types';

interface SessionDetailHeaderProps {
  sessionId: string;
  sessionName: string;
  sessionDescription?: string | null;
  sessionStatus: SessionStatus;
}

export function SessionDetailHeader({
  sessionId,
  sessionName,
  sessionDescription,
  sessionStatus,
}: SessionDetailHeaderProps) {
  const router = useRouter();

  const handleSave = async (field: 'name' | 'description', value: string) => {
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex gap-3 sm:gap-4 flex-1 min-w-0">
        <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Layers className="h-5 w-5 sm:h-6 sm:w-6 text-accent-foreground" />
        </div>
        <div className="space-y-1 min-w-0 flex-1">
          <InlineEdit
            value={sessionName}
            onSave={(v) => handleSave('name', v)}
            className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
          />
          {sessionDescription ? (
            <InlineEdit
              value={sessionDescription}
              onSave={(v) => handleSave('description', v)}
              className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400"
              multiline
            />
          ) : (
            <InlineEdit
              value=""
              placeholder="Add description..."
              onSave={(v) => handleSave('description', v)}
              className="text-sm sm:text-base text-zinc-400 dark:text-zinc-500"
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 self-start">
        <InlineStatusSelect
          sessionId={sessionId}
          currentStatus={sessionStatus}
        />
        <SessionActions
          sessionId={sessionId}
          sessionName={sessionName}
          currentStatus={sessionStatus}
          redirectOnDelete="/dashboard/sessions"
        />
      </div>
    </div>
  );
}
