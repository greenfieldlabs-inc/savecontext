'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import type { IssueStatus, IssuePriority, IssueType, InlineIssueFormProps } from '@/lib/types';
import {
  STATUS_OPTIONS, STATUS_CONFIG, DEFAULT_STATUS,
  PRIORITY_OPTIONS, TYPE_OPTIONS, TYPE_CONFIG, PriorityIcon
} from '@/lib/constants/issue-config';
import { Dropdown } from '@/components/ui/dropdown';

// Status Dropdown
function StatusDropdown({ value, onChange }: { value: IssueStatus; onChange: (status: IssueStatus) => void }) {
  const current = STATUS_CONFIG[value] || DEFAULT_STATUS;

  return (
    <Dropdown
      trigger={
        <span className={`flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${current.color}`}>
          {current.icon}
          <span className="text-sm">{current.label}</span>
          <ChevronDown className="h-3 w-3 ml-1 text-zinc-400" />
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

// Priority Dropdown
function PriorityDropdown({ value, onChange }: { value: IssuePriority; onChange: (priority: IssuePriority) => void }) {
  const label = PRIORITY_OPTIONS.find(p => p.value === value)?.label || 'No priority';

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
          <PriorityIcon priority={value} />
          <span className="text-sm">{label}</span>
          <ChevronDown className="h-3 w-3 ml-1 text-zinc-400" />
        </span>
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

// Type Dropdown
function TypeDropdown({ value, onChange }: { value: IssueType; onChange: (type: IssueType) => void }) {
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

export function InlineIssueForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
  siblingIssues = [],
  placeholder = 'Issue title',
}: InlineIssueFormProps) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<IssueStatus>('open');
  const [priority, setPriority] = useState<IssuePriority>(0);
  const [issueType, setIssueType] = useState<IssueType>('task');
  const [selectedDependencies, setSelectedDependencies] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!title.trim() || isSubmitting) return;
    await onSubmit({
      title: title.trim(),
      status,
      priority,
      issueType,
      dependsOn: selectedDependencies.length > 0 ? selectedDependencies : undefined,
    });
  };

  const handleCancel = () => {
    setTitle('');
    setStatus('open');
    setPriority(0);
    setIssueType('task');
    setSelectedDependencies([]);
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && title.trim()) handleSubmit();
    if (e.key === 'Escape') handleCancel();
  };

  const statusConfig = STATUS_CONFIG[status] || DEFAULT_STATUS;

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-4">
      {/* Title row */}
      <div className="flex items-center gap-2.5">
        <span className={`${statusConfig.color}`}>
          {statusConfig.icon}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 text-sm bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
        />
      </div>

      {/* Description placeholder */}
      <div className="pl-6">
        <span className="text-sm text-zinc-400">Add description...</span>
      </div>

      {/* Property Pills - matches +New modal design */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusDropdown value={status} onChange={setStatus} />
        <PriorityDropdown value={priority} onChange={setPriority} />
        <TypeDropdown value={issueType} onChange={setIssueType} />
      </div>

      {/* Dependency selector - only show if there are siblings */}
      {siblingIssues.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <span className="text-xs text-zinc-500">Blocked by (optional):</span>
          <div className="flex flex-wrap gap-1.5">
            {siblingIssues.filter(s => s.status !== 'closed').map((sibling) => (
              <button
                key={sibling.id}
                type="button"
                onClick={() => {
                  setSelectedDependencies(prev =>
                    prev.includes(sibling.id)
                      ? prev.filter(id => id !== sibling.id)
                      : [...prev, sibling.id]
                  );
                }}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  selectedDependencies.includes(sibling.id)
                    ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                    : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                }`}
              >
                {sibling.short_id}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions - matches +New modal design */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-700">
        <button
          onClick={handleCancel}
          className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || isSubmitting}
          className="px-4 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Creating...' : 'Create issue'}
        </button>
      </div>
    </div>
  );
}
