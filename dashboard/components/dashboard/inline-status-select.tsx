'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusPill } from '@/components/ui/status-pill';
import type { SessionStatus } from '@/lib/types';

interface InlineStatusSelectProps {
  sessionId: string;
  currentStatus: SessionStatus;
  showDropdownIcon?: boolean;
}

const STATUS_OPTIONS: { value: SessionStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
];

export function InlineStatusSelect({
  sessionId,
  currentStatus,
  showDropdownIcon = true,
}: InlineStatusSelectProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleStatusChange = async (e: React.MouseEvent, newStatus: SessionStatus) => {
    e.preventDefault();
    e.stopPropagation();

    if (newStatus === currentStatus) {
      setOpen(false);
      return;
    }

    setLoading(true);
    setOpen(false);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to change status:', data.error);
      }

      router.refresh();
    } catch (err) {
      console.error('Failed to change status:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 rounded-full transition-opacity hover:opacity-80 focus:outline-none disabled:opacity-50"
          disabled={loading}
          onClick={(e) => e.stopPropagation()}
        >
          {loading ? (
            <span className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Updating...
            </span>
          ) : (
            <>
              <StatusPill status={currentStatus} />
              {showDropdownIcon && (
                <ChevronDown className="h-3 w-3 text-zinc-400" />
              )}
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[140px] bg-white dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {STATUS_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={(e) => handleStatusChange(e, option.value)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <StatusPill status={option.value} />
            {option.value === currentStatus && (
              <span className="ml-auto text-xs text-zinc-400">(current)</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
