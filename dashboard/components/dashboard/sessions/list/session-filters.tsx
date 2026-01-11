'use client';

import { ChevronDown, X, Search } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useQueryFilters } from '@/lib/hooks/use-query-filters';
import type { ProjectSummary } from '@/lib/types';

interface SessionFiltersProps {
  projects: ProjectSummary[];
  currentProjectId?: string;
  currentStatus: string;
  currentSearch?: string;
  hideStatusFilter?: boolean;
}

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
];

export function SessionFilters({ projects, currentProjectId, currentStatus, currentSearch, hideStatusFilter }: SessionFiltersProps) {
  const { updateFilter, clearFilters } = useQueryFilters();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(currentSearch || '');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync searchValue with URL changes
  useEffect(() => {
    setSearchValue(currentSearch || '');
  }, [currentSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchValue(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      updateFilter('search', value || null);
    }, 300);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Find selected project by ID
  const selectedProject = projects.find(p => p.id === currentProjectId);
  const projectName = selectedProject ? selectedProject.name : null;

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search sessions..."
          className="h-8 sm:h-9 w-48 sm:w-64 rounded-lg border border-zinc-200 bg-white pl-8 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600"
        />
        {searchValue && (
          <button
            onClick={() => handleSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Project Dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-1.5 sm:gap-2 rounded-lg border border-zinc-200 bg-white px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/50"
        >
          <span>{projectName || 'All Projects'}</span>
          <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-zinc-500" />
        </button>

        {isDropdownOpen && (
          <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <div className="max-h-80 overflow-y-auto p-1">
              <button
                onClick={() => {
                  updateFilter('projectId', null);
                  setIsDropdownOpen(false);
                }}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  !currentProjectId
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/50'
                }`}
              >
                All Projects
              </button>
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    updateFilter('projectId', project.id);
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    currentProjectId === project.id
                      ? 'bg-primary font-medium text-primary-foreground'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/50'
                  }`}
                >
                  <div className="truncate">{project.name}</div>
                  {project.project_path && (
                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-500">
                      {project.project_path}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Status Pills */}
      {!hideStatusFilter && (
        <div className="flex items-center gap-1.5 sm:gap-2">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => updateFilter('status', option.value)}
              className={`rounded-full px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-all ${
                currentStatus === option.value
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {/* Clear Filters */}
      {(currentProjectId || currentStatus !== 'all' || currentSearch) && (
        <button
          onClick={() => {
            setSearchValue('');
            updateFilter('search', null);
            updateFilter('projectId', null);
            updateFilter('status', 'all');
          }}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
