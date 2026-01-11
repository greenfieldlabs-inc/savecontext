'use client';

import { ChevronDown } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import { PLAN_STATUS_OPTIONS, PLAN_STATUS_CONFIG, DEFAULT_PLAN_STATUS } from '@/lib/constants/plan-config';
import type { PlanStatus } from '@/lib/types';

interface PlanStatusDropdownProps {
  value: PlanStatus;
  onChange: (status: PlanStatus) => void;
  size?: 'sm' | 'md';
}

export function PlanStatusDropdown({ value, onChange, size = 'sm' }: PlanStatusDropdownProps) {
  const current = PLAN_STATUS_CONFIG[value] || DEFAULT_PLAN_STATUS;

  return (
    <Dropdown
      trigger={
        <span className={`${current.color} hover:opacity-70 transition-opacity`}>
          {size === 'sm' ? (
            <span className="h-[14px] w-[14px]">{current.icon}</span>
          ) : (
            <span className={`flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${current.color}`}>
              {current.icon}
              <span className="text-sm">{current.label}</span>
              <ChevronDown className="h-3 w-3 ml-1 text-zinc-400" />
            </span>
          )}
        </span>
      }
      options={PLAN_STATUS_OPTIONS}
      value={value}
      onChange={onChange}
      renderOption={(option) => {
        const config = PLAN_STATUS_CONFIG[option.value] || DEFAULT_PLAN_STATUS;
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
