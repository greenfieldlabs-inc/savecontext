'use client';

import { ChevronDown } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import { PRIORITY_OPTIONS, PriorityIcon } from '@/lib/constants/issue-config';
import type { IssuePriority } from '@/lib/types';

interface PriorityDropdownProps {
  value: IssuePriority;
  onChange: (priority: IssuePriority) => void;
  size?: 'sm' | 'md';
}

export function PriorityDropdown({ value, onChange, size = 'sm' }: PriorityDropdownProps) {
  const label = PRIORITY_OPTIONS.find(p => p.value === value)?.label || 'No priority';

  return (
    <Dropdown
      trigger={
        size === 'sm' ? (
          <span className="hover:opacity-70 transition-opacity">
            <PriorityIcon priority={value} />
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            <PriorityIcon priority={value} />
            <span className="text-sm">{label}</span>
            <ChevronDown className="h-3 w-3 ml-1 text-zinc-400" />
          </span>
        )
      }
      options={PRIORITY_OPTIONS}
      value={value}
      onChange={onChange}
      renderOption={(option) => (
        <span className="flex items-center gap-2">
          <PriorityIcon priority={option.value} />
          <span className={option.value === 4 ? 'text-orange-500' : ''}>{option.label}</span>
        </span>
      )}
    />
  );
}
