'use client';

import { CirclePause, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionStatus } from '@/lib/types';

interface StatusPillProps {
  status: SessionStatus;
  className?: string;
  size?: 'sm' | 'md';
  count?: number;
}

const statusConfig = {
  active: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  paused: {
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-700 dark:text-amber-400',
    dot: '',
  },
  completed: {
    bg: 'bg-zinc-100 dark:bg-zinc-800',
    text: 'text-zinc-600 dark:text-zinc-400',
    dot: '',
  },
};

export function StatusPill({ status, className, size = 'md', count }: StatusPillProps) {
  const config = statusConfig[status];

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
  };

  const iconSize = {
    sm: 'h-3 w-3',
    md: 'h-3.5 w-3.5',
  };

  const dotSize = {
    sm: 'h-1.5 w-1.5',
    md: 'h-2 w-2',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold',
        config.bg,
        config.text,
        sizeClasses[size],
        className
      )}
    >
      {status === 'active' && (
        <span className={cn('rounded-full bg-emerald-500 animate-pulse', dotSize[size])} />
      )}
      {status === 'paused' && <CirclePause className={iconSize[size]} />}
      {status === 'completed' && <CircleCheck className={iconSize[size]} />}
      <span className="capitalize">
        {count !== undefined ? `${count} ${status}` : status}
      </span>
    </span>
  );
}
