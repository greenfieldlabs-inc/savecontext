'use client';

import { ChevronDown } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import { TYPE_OPTIONS, TYPE_CONFIG } from '@/lib/constants/issue-config';
import type { IssueType } from '@/lib/types';

interface TypeDropdownProps {
  value: IssueType;
  onChange: (type: IssueType) => void;
}

export function TypeDropdown({ value, onChange }: TypeDropdownProps) {
  const current = TYPE_CONFIG[value] || TYPE_OPTIONS[0];

  return (
    <Dropdown
      trigger={
        <span className={`flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${current.color}`}>
          {current.icon}
          <span className="text-sm">{current.label}</span>
          <ChevronDown className="h-3 w-3 ml-1 text-zinc-400" />
        </span>
      }
      options={TYPE_OPTIONS}
      value={value}
      onChange={onChange}
      renderOption={(option) => {
        const config = TYPE_CONFIG[option.value];
        return (
          <span className={`flex items-center gap-2 ${config?.color}`}>
            {config?.icon}
            <span>{option.label}</span>
          </span>
        );
      }}
    />
  );
}
