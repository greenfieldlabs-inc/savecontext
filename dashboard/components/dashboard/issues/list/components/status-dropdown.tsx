'use client';

import { ChevronDown } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import { STATUS_OPTIONS, STATUS_CONFIG, DEFAULT_STATUS } from '@/lib/constants/issue-config';
import type { IssueStatus } from '@/lib/types';

interface StatusDropdownProps {
  value: IssueStatus;
  onChange: (status: IssueStatus) => void;
  size?: 'sm' | 'md';
}

export function StatusDropdown({ value, onChange, size = 'sm' }: StatusDropdownProps) {
  const current = STATUS_CONFIG[value] || DEFAULT_STATUS;
  const iconSize = size === 'sm' ? 'h-[14px] w-[14px]' : 'h-4 w-4';

  return (
    <Dropdown
      trigger={
        <span className={`${current.color} hover:opacity-70 transition-opacity`}>
          {size === 'sm' ? (
            <span className={iconSize}>{current.icon}</span>
          ) : (
            <span className={`flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${current.color}`}>
              {current.icon}
              <span className="text-sm">{current.label}</span>
              <ChevronDown className="h-3 w-3 ml-1 text-zinc-400" />
            </span>
          )}
        </span>
      }
      options={STATUS_OPTIONS}
      value={value}
      onChange={onChange}
      renderOption={(option) => {
        const config = STATUS_CONFIG[option.value] || DEFAULT_STATUS;
        return (
          <span className={`flex items-center gap-2 ${config.color}`}>
            {config.icon}
            <span>{option.label}</span>
          </span>
        );
      }}
    />
  );
}
