'use client';

import { ChevronDown, Hexagon, Plus } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import type { ProjectSummary } from '@/lib/types';

export interface ProjectDropdownProps {
  value: string;
  onChange: (path: string) => void;
  projects: ProjectSummary[];
}

export function ProjectDropdown({ value, onChange, projects }: ProjectDropdownProps) {
  const projectOptions = projects.map(p => ({
    value: p.project_path,
    label: p.name || p.project_path.split('/').pop() || p.project_path
  }));
  const currentLabel = projectOptions.find(p => p.value === value)?.label || 'Project';

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
          <Hexagon className="h-4 w-4 shrink-0" />
          <span className="text-sm truncate max-w-[150px]">{currentLabel}</span>
          <ChevronDown className="h-3 w-3 ml-1 text-zinc-400 shrink-0" />
        </span>
      }
      options={projectOptions}
      value={value}
      onChange={onChange}
      renderOption={(option) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Hexagon className="h-4 w-4 text-zinc-400 shrink-0" />
          <span className="truncate">{option.label}</span>
        </span>
      )}
    />
  );
}

export interface AddProjectDropdownProps {
  projects: ProjectSummary[];
  currentProjectPath: string;
  additionalPaths: string[];
  onAdd: (path: string) => void;
}

export function AddProjectDropdown({
  projects,
  currentProjectPath,
  additionalPaths,
  onAdd
}: AddProjectDropdownProps) {
  // Filter out already-associated projects (primary + additional)
  const associatedPaths = new Set([currentProjectPath, ...additionalPaths]);
  const availableProjects = projects.filter(p => !associatedPaths.has(p.project_path));

  // Don't show if no projects available to add
  if (availableProjects.length === 0) {
    return null;
  }

  const options = availableProjects.map(p => ({
    value: p.project_path,
    label: p.name || p.project_path.split('/').pop() || p.project_path
  }));

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-sm">
          <Plus className="h-3.5 w-3.5" />
          <span>Add</span>
        </span>
      }
      options={options}
      value=""
      onChange={onAdd}
      renderOption={(option) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Hexagon className="h-4 w-4 text-zinc-400 shrink-0" />
          <span className="truncate">{option.label}</span>
        </span>
      )}
    />
  );
}
