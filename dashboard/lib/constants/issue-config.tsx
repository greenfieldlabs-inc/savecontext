/**
 * Issue configuration constants
 * Centralized options for status, priority, and type dropdowns
 */

import {
  CheckSquare, Circle, CheckCircle2, AlertTriangle, Pause,
  Bug, Sparkles, Layers, Wrench, Inbox
} from 'lucide-react';
import type { IssueStatus, IssuePriority, IssueType } from '@/lib/types';

// Status configuration
// Note: "duplicate" is NOT a status - it's determined by having a duplicate-of relation
export const STATUS_OPTIONS: { value: IssueStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'backlog', label: 'Backlog', icon: <Inbox className="h-4 w-4" />, color: 'text-zinc-400' },
  { value: 'open', label: 'Open', icon: <Circle className="h-4 w-4" strokeWidth={2} />, color: 'text-zinc-400' },
  { value: 'in_progress', label: 'In Progress', icon: <div className="h-4 w-4 rounded-full border-2 border-yellow-500 border-r-transparent" />, color: 'text-yellow-500' },
  { value: 'blocked', label: 'Blocked', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-red-500' },
  { value: 'closed', label: 'Closed', icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-blue-500' },
  { value: 'deferred', label: 'Deferred', icon: <Pause className="h-4 w-4" />, color: 'text-zinc-400' },
];

export const STATUS_CONFIG = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s])) as Record<IssueStatus, typeof STATUS_OPTIONS[number]>;
export const DEFAULT_STATUS = STATUS_OPTIONS[1]; // 'open'

// Priority configuration
export const PRIORITY_OPTIONS: { value: IssuePriority; label: string }[] = [
  { value: 0, label: 'No priority' },
  { value: 4, label: 'Urgent' },
  { value: 3, label: 'High' },
  { value: 2, label: 'Medium' },
  { value: 1, label: 'Low' },
];

// Type configuration
export const TYPE_OPTIONS: { value: IssueType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'task', label: 'Task', icon: <CheckSquare className="h-4 w-4" />, color: 'text-zinc-400' },
  { value: 'bug', label: 'Bug', icon: <Bug className="h-4 w-4" />, color: 'text-red-500' },
  { value: 'feature', label: 'Feature', icon: <Sparkles className="h-4 w-4" />, color: 'text-violet-500' },
  { value: 'epic', label: 'Epic', icon: <Layers className="h-4 w-4" />, color: 'text-indigo-500' },
  { value: 'chore', label: 'Chore', icon: <Wrench className="h-4 w-4" />, color: 'text-zinc-400' },
];

export const TYPE_CONFIG = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t])) as Record<IssueType, typeof TYPE_OPTIONS[number]>;

// Filter status options for issues list dropdown
export const ISSUE_FILTER_STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'closed', label: 'Closed' },
  { value: 'deferred', label: 'Deferred' },
] as const;

// Priority Icon component - horizontal bars
export function PriorityIcon({ priority, className = '' }: { priority: IssuePriority; className?: string }) {
  const isUrgent = priority === 4;
  const activeColor = isUrgent ? 'fill-orange-500' : 'fill-zinc-500 dark:fill-zinc-400';
  const inactiveColor = 'fill-zinc-200 dark:fill-zinc-700';

  return (
    <svg className={`h-4 w-4 ${className}`} viewBox="0 0 16 16" fill="none">
      <rect x="3" y="2" width="10" height="2" rx="0.5" className={priority >= 4 ? activeColor : inactiveColor} />
      <rect x="3" y="5.5" width="10" height="2" rx="0.5" className={priority >= 3 ? activeColor : inactiveColor} />
      <rect x="3" y="9" width="10" height="2" rx="0.5" className={priority >= 2 ? activeColor : inactiveColor} />
      <rect x="3" y="12.5" width="10" height="2" rx="0.5" className={priority >= 1 ? activeColor : inactiveColor} />
    </svg>
  );
}
