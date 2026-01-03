'use client';

import type { IssueProgressProps } from '@/lib/types';

export function IssueProgress({
  completed,
  total,
  size = 16,
  strokeWidth = 2,
  className = ''
}: IssueProgressProps) {
  // Hide when no children
  if (total === 0) return null;

  const percentage = total > 0 ? (completed / total) * 100 : 0;
  const isComplete = completed === total;

  // SVG circle math
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  // Colors based on state
  const progressColor = isComplete
    ? 'stroke-emerald-500'
    : completed > 0
      ? 'stroke-blue-500'
      : 'stroke-zinc-300 dark:stroke-zinc-600';

  const bgColor = 'stroke-zinc-200 dark:stroke-zinc-700';

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={bgColor}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={`${progressColor} transition-all duration-300`}
        />
      </svg>
      <span className={`text-xs tabular-nums ${isComplete ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}`}>
        {completed}/{total}
      </span>
    </div>
  );
}
