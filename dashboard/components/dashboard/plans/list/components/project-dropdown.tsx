'use client';

import { Hexagon, ChevronDown } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import type { ProjectSummary } from '@/lib/types';

interface ProjectDropdownProps {
  value: string;
  onChange: (path: string) => void;
  projects: ProjectSummary[];
}

export function ProjectDropdown({ value, onChange, projects }: ProjectDropdownProps) {
  const projectOptions = projects
    .filter(p => p.project_path)
    .map(p => ({ value: p.project_path, label: p.name || p.project_path.split('/').pop() || p.project_path }));
  const currentLabel = projectOptions.find(p => p.value === value)?.label || 'Project';

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
          <Hexagon className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm truncate max-w-[150px]">{currentLabel}</span>
          <ChevronDown className="h-3 w-3 ml-1 text-zinc-400 flex-shrink-0" />
        </span>
      }
      options={projectOptions}
      value={value}
      onChange={onChange}
      renderOption={(option) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Hexagon className="h-4 w-4 text-zinc-400 flex-shrink-0" />
          <span className="truncate">{option.label}</span>
        </span>
      )}
    />
  );
}
