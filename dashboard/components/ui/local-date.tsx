'use client';

import type { LocalDateProps } from '@/lib/types';

function formatRelativeDate(date: Date, format: 'date' | 'datetime'): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const isToday = dateOnly.getTime() === today.getTime();
  const isYesterday = dateOnly.getTime() === yesterday.getTime();
  const isThisYear = date.getFullYear() === now.getFullYear();

  if (format === 'date') {
    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';
    if (isThisYear) {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // datetime format
  if (isToday) return `Today at ${timeStr}`;
  if (isYesterday) return `Yesterday at ${timeStr}`;
  if (isThisYear) {
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${dateStr} at ${timeStr}`;
  }
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${dateStr} at ${timeStr}`;
}

export function LocalDate({ date, format = 'datetime' }: LocalDateProps) {
  const d = new Date(date);
  return formatRelativeDate(d, format);
}
