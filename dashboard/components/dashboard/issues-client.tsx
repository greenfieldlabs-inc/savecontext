'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckSquare, Plus, Search, Trash2, Circle, CheckCircle2,
  ChevronDown, ChevronRight, X, AlertTriangle, Pause, Bug, Sparkles,
  Layers, Wrench, Clock, MoreHorizontal, Tag, Hexagon, Check,
  FileText, Brain, FolderKanban, Terminal, Settings, Lightbulb, Star
} from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ProjectSummary, Issue, IssueStats, IssueStatus, IssuePriority, IssueType, Plan, Memory } from '@/lib/types';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IssueProgress } from '@/components/ui/issue-progress';
import { Badge } from '@/components/ui/badge';

interface IssuesClientProps {
  projects: ProjectSummary[];
  initialProjectFilter?: string;
  initialStatusFilter: string;
}

// Priority Icon - horizontal bars
function PriorityIcon({ priority, className = '' }: { priority: IssuePriority; className?: string }) {
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

// Status configuration
const STATUS_OPTIONS: { value: IssueStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'open', label: 'Open', icon: <Circle className="h-4 w-4" strokeWidth={2} />, color: 'text-zinc-400' },
  { value: 'in_progress', label: 'In Progress', icon: <div className="h-4 w-4 rounded-full border-2 border-yellow-500 border-r-transparent" />, color: 'text-yellow-500' },
  { value: 'blocked', label: 'Blocked', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-red-500' },
  { value: 'closed', label: 'Closed', icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-blue-500' },
  { value: 'deferred', label: 'Deferred', icon: <Pause className="h-4 w-4" />, color: 'text-zinc-400' },
];

const STATUS_CONFIG = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]));
const DEFAULT_STATUS = STATUS_OPTIONS[0];

// Priority configuration
const PRIORITY_OPTIONS: { value: IssuePriority; label: string }[] = [
  { value: 0, label: 'No priority' },
  { value: 4, label: 'Urgent' },
  { value: 3, label: 'High' },
  { value: 2, label: 'Medium' },
  { value: 1, label: 'Low' },
];

// Type configuration
const TYPE_OPTIONS: { value: IssueType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'task', label: 'Task', icon: <CheckSquare className="h-4 w-4" />, color: 'text-zinc-400' },
  { value: 'bug', label: 'Bug', icon: <Bug className="h-4 w-4" />, color: 'text-red-500' },
  { value: 'feature', label: 'Feature', icon: <Sparkles className="h-4 w-4" />, color: 'text-violet-500' },
  { value: 'epic', label: 'Epic', icon: <Layers className="h-4 w-4" />, color: 'text-indigo-500' },
  { value: 'chore', label: 'Chore', icon: <Wrench className="h-4 w-4" />, color: 'text-zinc-400' },
];

const TYPE_CONFIG = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t]));

// Generic dropdown component with portal for proper z-index stacking
function Dropdown<T extends string | number>({
  trigger,
  options,
  value,
  onChange,
  renderOption,
  className = '',
}: {
  trigger: React.ReactNode;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  renderOption: (option: { value: T; label: string }, isSelected: boolean) => React.ReactNode;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Update position when opening (with viewport boundary detection)
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuHeight = 200; // Approximate menu height
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      // If not enough space below and more space above, flip upward
      const shouldFlipUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;

      setPosition({
        top: shouldFlipUp
          ? rect.top + window.scrollY - menuHeight - 4
          : rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menu = isOpen && mounted && (
    <div
      ref={menuRef}
      className="fixed z-99999 min-w-[200px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
      style={{ top: position.top, left: position.left }}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          onClick={(e) => {
            e.stopPropagation();
            onChange(option.value);
            setIsOpen(false);
          }}
          className="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between"
        >
          {renderOption(option, option.value === value)}
          {option.value === value && <Check className="h-4 w-4 text-zinc-500" />}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="flex items-center"
      >
        {trigger}
      </button>
      {mounted && createPortal(menu, document.body)}
    </div>
  );
}

// Status Dropdown
function StatusDropdown({ value, onChange, size = 'sm' }: { value: IssueStatus; onChange: (status: IssueStatus) => void; size?: 'sm' | 'md' }) {
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

// Priority Dropdown
function PriorityDropdown({ value, onChange, size = 'sm' }: { value: IssuePriority; onChange: (priority: IssuePriority) => void; size?: 'sm' | 'md' }) {
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

// Type Dropdown (for create modal)
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

// Project Dropdown (for create modal)
function ProjectDropdown({ value, onChange, projects }: { value: string; onChange: (path: string) => void; projects: ProjectSummary[] }) {
  const projectOptions = projects.map(p => ({ value: p.project_path, label: p.name || p.project_path.split('/').pop() || p.project_path }));
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

// Add Project Dropdown - shows available projects not yet associated
function AddProjectDropdown({
  projects,
  currentProjectPath,
  additionalPaths,
  onAdd
}: {
  projects: ProjectSummary[];
  currentProjectPath: string;
  additionalPaths: string[];
  onAdd: (path: string) => void;
}) {
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

// Issue Detail Panel with editable fields
function IssueDetailPanel({
  issue,
  typeConfig,
  onClose,
  onUpdate,
  onSubtaskCreated,
  projects,
}: {
  issue: Issue;
  typeConfig: { label: string; icon: React.ReactNode; color: string };
  onClose: () => void;
  onUpdate: (updates: Partial<Issue> & { add_project_path?: string; remove_project_path?: string }) => void;
  onSubtaskCreated: () => void;
  projects: ProjectSummary[];
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [titleValue, setTitleValue] = useState(issue.title);
  const [descriptionValue, setDescriptionValue] = useState(issue.description || '');
  const [detailsValue, setDetailsValue] = useState(issue.details || '');

  // Subtask state
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtasks, setSubtasks] = useState<Issue[]>([]);
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);
  const [creatingSubtask, setCreatingSubtask] = useState(false);
  const [selectedDependencies, setSelectedDependencies] = useState<string[]>([]);
  const [expandedSubtaskId, setExpandedSubtaskId] = useState<string | null>(null);
  const [editingSubtaskField, setEditingSubtaskField] = useState<{ id: string; field: 'title' | 'description' | 'details' } | null>(null);
  const [subtaskEditValue, setSubtaskEditValue] = useState('');
  const [subtaskToDelete, setSubtaskToDelete] = useState<string | null>(null);
  const [isConfirmDeleteSubtaskOpen, setIsConfirmDeleteSubtaskOpen] = useState(false);

  // Nested subtask state (for 3-level hierarchy)
  const [subSubtasks, setSubSubtasks] = useState<Record<string, Issue[]>>({});
  const [loadingSubSubtasks, setLoadingSubSubtasks] = useState<Record<string, boolean>>({});
  const [addingChildTo, setAddingChildTo] = useState<string | null>(null);
  const [childTitle, setChildTitle] = useState('');
  const [creatingChild, setCreatingChild] = useState(false);
  const [childToDelete, setChildToDelete] = useState<{ id: string; parentId: string } | null>(null);
  const [isConfirmDeleteChildOpen, setIsConfirmDeleteChildOpen] = useState(false);
  const [selectedChildDependencies, setSelectedChildDependencies] = useState<string[]>([]);

  // Context Chain state (Plan)
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);

  // Memory state
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [showMemories, setShowMemories] = useState(false);

  // Details collapsed state (collapsed by default for epics)
  const [showDetails, setShowDetails] = useState(false);

  // Sync with issue changes
  useEffect(() => {
    setTitleValue(issue.title);
    setDescriptionValue(issue.description || '');
    setDetailsValue(issue.details || '');
  }, [issue.title, issue.description, issue.details]);

  // Update subtask (optimistic)
  const handleUpdateSubtask = async (subtaskId: string, updates: Partial<Issue>) => {
    // Optimistic update
    setSubtasks(prev => prev.map(s =>
      s.id === subtaskId ? { ...s, ...updates } : s
    ));

    try {
      const response = await fetch('/api/issues/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: subtaskId, ...updates })
      });

      if (!response.ok) {
        // Reload on failure
        const res = await fetch(`/api/issues/subtasks?parentId=${issue.id}`);
        const data = await res.json();
        if (data.success) setSubtasks(data.issues || []);
      }
    } catch (err) {
      console.error('Failed to update subtask:', err);
    }
  };

  // Start editing a subtask field
  const startEditingSubtask = (subtaskId: string, field: 'title' | 'description' | 'details', currentValue: string) => {
    setEditingSubtaskField({ id: subtaskId, field });
    setSubtaskEditValue(currentValue || '');
  };

  // Save subtask field edit
  const saveSubtaskEdit = () => {
    if (!editingSubtaskField) return;
    const { id, field } = editingSubtaskField;
    handleUpdateSubtask(id, { [field]: subtaskEditValue });
    setEditingSubtaskField(null);
    setSubtaskEditValue('');
  };

  // Delete subtask
  const handleDeleteSubtask = async () => {
    if (!subtaskToDelete) return;
    try {
      const params = new URLSearchParams({ id: subtaskToDelete });
      const response = await fetch(`/api/issues/delete?${params}`, { method: 'DELETE' });
      if (response.ok) {
        setSubtasks(prev => prev.filter(s => s.id !== subtaskToDelete));
        setIsConfirmDeleteSubtaskOpen(false);
        setSubtaskToDelete(null);
        onSubtaskCreated(); // Refresh parent issue list
      }
    } catch (err) {
      console.error('Failed to delete subtask:', err);
    }
  };

  // Delete 3rd level child
  const handleDeleteChild = async () => {
    if (!childToDelete) return;
    try {
      const params = new URLSearchParams({ id: childToDelete.id });
      const response = await fetch(`/api/issues/delete?${params}`, { method: 'DELETE' });
      if (response.ok) {
        setSubSubtasks(prev => ({
          ...prev,
          [childToDelete.parentId]: prev[childToDelete.parentId].filter(s => s.id !== childToDelete.id)
        }));
        setIsConfirmDeleteChildOpen(false);
        setChildToDelete(null);
        onSubtaskCreated(); // Refresh parent issue list
      }
    } catch (err) {
      console.error('Failed to delete child:', err);
    }
  };

  // Load subtasks
  useEffect(() => {
    async function loadSubtasks() {
      setLoadingSubtasks(true);
      try {
        const res = await fetch(`/api/issues/subtasks?parentId=${issue.id}`);
        const data = await res.json();
        if (data.success) {
          setSubtasks(data.issues || []);
        }
      } catch (err) {
        console.error('Failed to load subtasks:', err);
      } finally {
        setLoadingSubtasks(false);
      }
    }
    loadSubtasks();
  }, [issue.id]);

  // Load sub-subtasks when a subtask is expanded and has children
  useEffect(() => {
    async function loadSubSubtasks() {
      if (!expandedSubtaskId) return;
      const subtask = subtasks.find(s => s.id === expandedSubtaskId);
      if (!subtask || (subtask.child_count || 0) === 0) return;
      if (subSubtasks[expandedSubtaskId]) return; // Already loaded

      setLoadingSubSubtasks(prev => ({ ...prev, [expandedSubtaskId]: true }));
      try {
        const res = await fetch(`/api/issues/subtasks?parentId=${expandedSubtaskId}`);
        const data = await res.json();
        if (data.success) {
          setSubSubtasks(prev => ({ ...prev, [expandedSubtaskId]: data.issues || [] }));
        }
      } catch (err) {
        console.error('Failed to load sub-subtasks:', err);
      } finally {
        setLoadingSubSubtasks(prev => ({ ...prev, [expandedSubtaskId]: false }));
      }
    }
    loadSubSubtasks();
  }, [expandedSubtaskId, subtasks]);

  // Load plan if issue has plan_id
  useEffect(() => {
    async function loadPlan() {
      if (!issue.plan_id) {
        setPlan(null);
        return;
      }
      setLoadingPlan(true);
      try {
        const res = await fetch(`/api/plans/${issue.plan_id}`);
        const data = await res.json();
        if (data.success) {
          setPlan(data.plan);
        }
      } catch (err) {
        console.error('Failed to load plan:', err);
      } finally {
        setLoadingPlan(false);
      }
    }
    loadPlan();
  }, [issue.plan_id]);

  // Load project memory when expanded
  useEffect(() => {
    async function loadMemory() {
      if (!showMemories || !issue.project_path) return;
      setLoadingMemories(true);
      try {
        const res = await fetch(`/api/memory/list?projectPath=${encodeURIComponent(issue.project_path)}`);
        const data = await res.json();
        if (data.success) {
          setMemories(data.memories || []);
        }
      } catch (err) {
        console.error('Failed to load memories:', err);
      } finally {
        setLoadingMemories(false);
      }
    }
    loadMemory();
  }, [showMemories, issue.project_path]);

  const handleCreateSubtask = async () => {
    if (!subtaskTitle.trim()) return;
    setCreatingSubtask(true);
    try {
      const res = await fetch('/api/issues/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: issue.project_path,
          title: subtaskTitle.trim(),
          parentId: issue.id,
          status: 'open',
          priority: 0,
          issueType: 'task',
          dependsOn: selectedDependencies.length > 0 ? selectedDependencies : undefined,
        }),
      });
      if (res.ok) {
        setSubtaskTitle('');
        setShowSubtaskForm(false);
        setSelectedDependencies([]);
        // Reload subtasks
        const subtasksRes = await fetch(`/api/issues/subtasks?parentId=${issue.id}`);
        const data = await subtasksRes.json();
        if (data.success) {
          setSubtasks(data.issues || []);
        }
        onSubtaskCreated();
      }
    } catch (err) {
      console.error('Failed to create subtask:', err);
    } finally {
      setCreatingSubtask(false);
    }
  };

  // Create a child issue under an expanded subtask (3rd level)
  const handleCreateChildIssue = async (parentSubtaskId: string) => {
    if (!childTitle.trim()) return;
    setCreatingChild(true);
    try {
      const res = await fetch('/api/issues/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: issue.project_path,
          title: childTitle.trim(),
          parentId: parentSubtaskId,
          status: 'open',
          priority: 0,
          issueType: 'task',
          dependsOn: selectedChildDependencies.length > 0 ? selectedChildDependencies : undefined,
        }),
      });
      if (res.ok) {
        setChildTitle('');
        setAddingChildTo(null);
        setSelectedChildDependencies([]);
        // Reload children for this subtask
        const childRes = await fetch(`/api/issues/subtasks?parentId=${parentSubtaskId}`);
        const data = await childRes.json();
        if (data.success) {
          setSubSubtasks(prev => ({ ...prev, [parentSubtaskId]: data.issues || [] }));
        }
        onSubtaskCreated();
      }
    } catch (err) {
      console.error('Failed to create subtask:', err);
    } finally {
      setCreatingChild(false);
    }
  };

  const handleTitleSave = () => {
    if (titleValue.trim() && titleValue !== issue.title) {
      onUpdate({ title: titleValue.trim() });
    }
    setEditingTitle(false);
  };

  const handleDescriptionSave = () => {
    if (descriptionValue !== (issue.description || '')) {
      onUpdate({ description: descriptionValue });
    }
    setEditingDescription(false);
  };

  const handleDetailsSave = () => {
    if (detailsValue !== (issue.details || '')) {
      onUpdate({ details: detailsValue });
    }
    setEditingDetails(false);
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="font-mono">{issue.short_id || issue.id.slice(0, 6)}</span>
            <span>·</span>
            <span className={typeConfig.color}>{typeConfig.label}</span>
          </div>
          {/* Editable Title */}
          {editingTitle ? (
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSave();
                if (e.key === 'Escape') {
                  setTitleValue(issue.title);
                  setEditingTitle(false);
                }
              }}
              autoFocus
              className="w-full text-lg font-semibold text-zinc-900 dark:text-zinc-100 bg-transparent border-b border-zinc-300 dark:border-zinc-600 outline-none focus:border-zinc-500"
            />
          ) : (
            <h2
              onClick={() => setEditingTitle(true)}
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded px-1 -mx-1"
            >
              {issue.title}
            </h2>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Context Chain - shows hierarchy */}
      {(plan || issue.parent) && (
        <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2">
          <FolderKanban className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-zinc-400">{issue.project_path?.split('/').pop()}</span>
          {plan && (
            <>
              <ChevronRight className="h-3 w-3 text-zinc-300" />
              <Link
                href={`/dashboard/plans?id=${plan.id}`}
                className="flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <FileText className="h-3.5 w-3.5" />
                {plan.title}
              </Link>
            </>
          )}
          {issue.parent && (
            <>
              <ChevronRight className="h-3 w-3 text-zinc-300" />
              <span className="text-zinc-500 dark:text-zinc-400">Subtask of {issue.parent.title}</span>
            </>
          )}
        </div>
      )}

      {/* Editable Properties */}
      <div className="flex flex-wrap gap-2">
        <StatusDropdown
          value={issue.status}
          onChange={(status) => onUpdate({ status })}
          size="md"
        />
        <PriorityDropdown
          value={issue.priority}
          onChange={(priority) => onUpdate({ priority })}
          size="md"
        />
      </div>

      {/* Projects Section (Multi-Project Support) */}
      <div>
        <span className="text-xs text-zinc-400 mb-2 block">Projects</span>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Primary Project - editable dropdown */}
          <ProjectDropdown
            value={issue.project_path}
            onChange={(project_path) => onUpdate({ project_path })}
            projects={projects}
          />

          {/* Additional Projects - removable */}
          {issue.additional_project_paths && issue.additional_project_paths.length > 0 && (
            issue.additional_project_paths.map((path) => (
              <span
                key={path}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm"
              >
                <Hexagon className="h-4 w-4 text-zinc-400 shrink-0" />
                <span className="truncate max-w-[150px]">{path.split('/').pop()}</span>
                <button
                  onClick={() => onUpdate({ remove_project_path: path })}
                  className="text-zinc-400 hover:text-red-500"
                  title="Remove from issue"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))
          )}

          {/* Add Project */}
          <AddProjectDropdown
            projects={projects}
            currentProjectPath={issue.project_path}
            additionalPaths={issue.additional_project_paths || []}
            onAdd={(path) => onUpdate({ add_project_path: path })}
          />
        </div>
      </div>

      {/* Editable Description */}
      <div>
        <span className="text-xs text-zinc-400">Description</span>
        {editingDescription ? (
          <textarea
            value={descriptionValue}
            onChange={(e) => setDescriptionValue(e.target.value)}
            onBlur={handleDescriptionSave}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDescriptionValue(issue.description || '');
                setEditingDescription(false);
              }
            }}
            autoFocus
            rows={4}
            className="w-full mt-1 text-sm text-zinc-600 dark:text-zinc-400 bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md p-2 outline-none focus:border-zinc-400 resize-none"
            placeholder="Add a description..."
          />
        ) : (
          <div
            onClick={() => setEditingDescription(true)}
            className="mt-1 text-sm cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded px-2 py-1 -mx-2 min-h-8"
          >
            {issue.description ? (
              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none text-zinc-600 dark:text-zinc-400 [&_pre]:overflow-x-auto [&_pre]:bg-zinc-100 [&_pre]:dark:bg-zinc-800 [&_pre]:text-zinc-800 [&_pre]:dark:text-zinc-200 [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.description}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-zinc-400 italic">Add a description...</p>
            )}
          </div>
        )}
      </div>

      {/* Editable Details - Collapsible */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 w-full"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Implementation Details</span>
          {issue.details && <span className="text-zinc-400">({issue.details.length} chars)</span>}
          <ChevronDown className={`h-3 w-3 ml-auto transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        </button>

        {showDetails && (
          <div className="mt-3">
            {editingDetails ? (
              <textarea
                value={detailsValue}
                onChange={(e) => setDetailsValue(e.target.value)}
                onBlur={handleDetailsSave}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setDetailsValue(issue.details || '');
                    setEditingDetails(false);
                  }
                }}
                autoFocus
                rows={6}
                className="w-full text-sm text-zinc-600 dark:text-zinc-400 bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md p-2 outline-none focus:border-zinc-400 resize-none font-mono"
                placeholder="Add implementation details..."
              />
            ) : (
              <div
                onClick={() => setEditingDetails(true)}
                className="text-sm cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded px-2 py-1 -mx-2 min-h-8"
              >
                {issue.details ? (
                  <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none text-zinc-600 dark:text-zinc-400 [&_pre]:overflow-x-auto [&_pre]:bg-zinc-100 [&_pre]:dark:bg-zinc-800 [&_pre]:text-zinc-800 [&_pre]:dark:text-zinc-200 [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.details}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-zinc-400 italic">Add implementation details...</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subtasks Section */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
        {/* Existing Subtasks */}
        {subtasks.length > 0 && (
          <div className="mb-3 space-y-1">
            {subtasks.map((subtask) => {
              const isExpanded = expandedSubtaskId === subtask.id;
              return (
                <div key={subtask.id} className="group/subtask border border-zinc-100 dark:border-zinc-800 rounded-lg overflow-hidden">
                  {/* Subtask Header Row */}
                  <div
                    className="flex items-center gap-2 py-2 px-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                    onClick={() => setExpandedSubtaskId(isExpanded ? null : subtask.id)}
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <StatusDropdown
                        value={subtask.status}
                        onChange={(status) => handleUpdateSubtask(subtask.id, { status })}
                        size="sm"
                      />
                    </div>
                    <span className="font-mono text-xs text-zinc-400">{subtask.short_id}</span>
                    <span className={`text-sm flex-1 ${subtask.status === 'closed' ? 'text-zinc-400 line-through' : 'text-zinc-700 dark:text-zinc-300'}`}>
                      {subtask.title}
                    </span>
                    <IssueProgress
                      completed={subtask.completed_count || 0}
                      total={subtask.child_count || 0}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSubtaskToDelete(subtask.id);
                        setIsConfirmDeleteSubtaskOpen(true);
                      }}
                      className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover/subtask:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Expanded Subtask Details */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 space-y-3 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
                      {/* Editable Title */}
                      <div>
                        <span className="text-xs text-zinc-400">Title</span>
                        {editingSubtaskField?.id === subtask.id && editingSubtaskField.field === 'title' ? (
                          <input
                            type="text"
                            value={subtaskEditValue}
                            onChange={(e) => setSubtaskEditValue(e.target.value)}
                            onBlur={saveSubtaskEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveSubtaskEdit();
                              if (e.key === 'Escape') { setEditingSubtaskField(null); setSubtaskEditValue(''); }
                            }}
                            autoFocus
                            className="w-full mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 outline-none focus:border-zinc-400"
                          />
                        ) : (
                          <p
                            onClick={() => startEditingSubtask(subtask.id, 'title', subtask.title)}
                            className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100 cursor-text hover:bg-white dark:hover:bg-zinc-800 rounded px-2 py-1 -mx-2"
                          >
                            {subtask.title}
                          </p>
                        )}
                      </div>

                      {/* Priority */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">Priority</span>
                        <PriorityDropdown
                          value={subtask.priority}
                          onChange={(priority) => handleUpdateSubtask(subtask.id, { priority })}
                          size="sm"
                        />
                      </div>

                      {/* Editable Description */}
                      <div>
                        <span className="text-xs text-zinc-400">Description</span>
                        {editingSubtaskField?.id === subtask.id && editingSubtaskField.field === 'description' ? (
                          <textarea
                            value={subtaskEditValue}
                            onChange={(e) => setSubtaskEditValue(e.target.value)}
                            onBlur={saveSubtaskEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') { setEditingSubtaskField(null); setSubtaskEditValue(''); }
                            }}
                            autoFocus
                            rows={2}
                            className="w-full mt-1 text-sm text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 outline-none focus:border-zinc-400 resize-none"
                            placeholder="Add description..."
                          />
                        ) : (
                          <div
                            onClick={() => startEditingSubtask(subtask.id, 'description', subtask.description || '')}
                            className="mt-1 text-sm cursor-text hover:bg-white dark:hover:bg-zinc-800 rounded px-2 py-1 -mx-2 min-h-6"
                          >
                            {subtask.description ? (
                              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none text-zinc-600 dark:text-zinc-400 [&_pre]:overflow-x-auto [&_pre]:bg-zinc-100 [&_pre]:dark:bg-zinc-800 [&_pre]:text-zinc-800 [&_pre]:dark:text-zinc-200 [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{subtask.description}</ReactMarkdown>
                              </div>
                            ) : (
                              <span className="italic text-zinc-400">Add description...</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Editable Details */}
                      <div>
                        <span className="text-xs text-zinc-400">Details</span>
                        {editingSubtaskField?.id === subtask.id && editingSubtaskField.field === 'details' ? (
                          <textarea
                            value={subtaskEditValue}
                            onChange={(e) => setSubtaskEditValue(e.target.value)}
                            onBlur={saveSubtaskEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') { setEditingSubtaskField(null); setSubtaskEditValue(''); }
                            }}
                            autoFocus
                            rows={3}
                            className="w-full mt-1 text-sm text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 outline-none focus:border-zinc-400 resize-none font-mono"
                            placeholder="Add implementation details..."
                          />
                        ) : (
                          <div
                            onClick={() => startEditingSubtask(subtask.id, 'details', subtask.details || '')}
                            className="mt-1 text-sm cursor-text hover:bg-white dark:hover:bg-zinc-800 rounded px-2 py-1 -mx-2 min-h-6"
                          >
                            {subtask.details ? (
                              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none text-zinc-600 dark:text-zinc-400 [&_pre]:overflow-x-auto [&_pre]:bg-zinc-100 [&_pre]:dark:bg-zinc-800 [&_pre]:text-zinc-800 [&_pre]:dark:text-zinc-200 [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{subtask.details}</ReactMarkdown>
                              </div>
                            ) : (
                              <span className="italic text-zinc-400">Add implementation details...</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Subtasks under this task (3rd level) */}
                      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-3">
                        {(subtask.child_count || 0) > 0 && (
                          <span className="text-xs text-zinc-400 font-medium">Subtasks ({subtask.child_count})</span>
                        )}
                        {loadingSubSubtasks[subtask.id] ? (
                          <p className="text-xs text-zinc-400 mt-2">Loading...</p>
                        ) : subSubtasks[subtask.id]?.length > 0 ? (
                          <div className="mt-2 space-y-1">
                            {subSubtasks[subtask.id].map((child) => (
                              <div
                                key={child.id}
                                className="group/child flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white dark:hover:bg-zinc-800"
                              >
                                <StatusDropdown
                                  value={child.status}
                                  onChange={(status) => {
                                    setSubSubtasks(prev => ({
                                      ...prev,
                                      [subtask.id]: prev[subtask.id].map(s =>
                                        s.id === child.id ? { ...s, status } : s
                                      )
                                    }));
                                    handleUpdateSubtask(child.id, { status });
                                  }}
                                  size="sm"
                                />
                                <span className="font-mono text-xs text-zinc-400">{child.short_id}</span>
                                <span className={`text-xs flex-1 ${child.status === 'closed' ? 'text-zinc-400 line-through' : 'text-zinc-600 dark:text-zinc-300'}`}>
                                  {child.title}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setChildToDelete({ id: child.id, parentId: subtask.id });
                                    setIsConfirmDeleteChildOpen(true);
                                  }}
                                  className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover/child:opacity-100 transition-opacity"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {/* Add subtask form/button */}
                        {addingChildTo === subtask.id ? (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <Circle className="h-3.5 w-3.5 text-zinc-300 shrink-0" />
                              <input
                                type="text"
                                value={childTitle}
                                onChange={(e) => setChildTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && childTitle.trim()) handleCreateChildIssue(subtask.id);
                                  if (e.key === 'Escape') { setChildTitle(''); setAddingChildTo(null); setSelectedChildDependencies([]); }
                                }}
                                placeholder="Subtask title"
                                autoFocus
                                className="flex-1 text-xs bg-transparent border-b border-zinc-300 dark:border-zinc-600 outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 py-1"
                              />
                            </div>
                            {/* Dependency selector for 3rd level */}
                            {subSubtasks[subtask.id]?.length > 0 && (
                              <div className="pl-5 space-y-1">
                                <span className="text-xs text-zinc-500">Blocked by:</span>
                                <div className="flex flex-wrap gap-1">
                                  {subSubtasks[subtask.id].filter(s => s.status !== 'closed').map((sibling) => (
                                    <button
                                      key={sibling.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedChildDependencies(prev =>
                                          prev.includes(sibling.id)
                                            ? prev.filter(id => id !== sibling.id)
                                            : [...prev, sibling.id]
                                        );
                                      }}
                                      className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                                        selectedChildDependencies.includes(sibling.id)
                                          ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                                          : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                                      }`}
                                    >
                                      {sibling.short_id}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-2 pl-5">
                              <button
                                onClick={() => handleCreateChildIssue(subtask.id)}
                                disabled={!childTitle.trim() || creatingChild}
                                className="px-2 py-0.5 text-xs rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-50"
                              >
                                {creatingChild ? '...' : 'Add'}
                              </button>
                              <button
                                onClick={() => { setChildTitle(''); setAddingChildTo(null); setSelectedChildDependencies([]); }}
                                className="text-xs text-zinc-400 hover:text-zinc-600"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAddingChildTo(subtask.id)}
                            className="mt-2 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add subtask
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add Subtask Button / Form */}
        {showSubtaskForm ? (
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-3">
            <div className="flex items-start gap-2">
              <Circle className="h-4 w-4 text-zinc-300 mt-0.5 shrink-0" />
              <input
                type="text"
                value={subtaskTitle}
                onChange={(e) => setSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && subtaskTitle.trim()) handleCreateSubtask();
                  if (e.key === 'Escape') {
                    setSubtaskTitle('');
                    setShowSubtaskForm(false);
                    setSelectedDependencies([]);
                  }
                }}
                placeholder={issue.issue_type === 'epic' || issue.issue_type === 'feature' ? 'Task title' : 'Subtask title'}
                autoFocus
                className="flex-1 text-sm bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
              />
            </div>
            {/* Dependency selector - show sibling issues */}
            {subtasks.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs text-zinc-500">Blocked by (optional):</span>
                <div className="flex flex-wrap gap-1.5">
                  {subtasks.filter(s => s.status !== 'closed').map((sibling) => (
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
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setSubtaskTitle('');
                  setShowSubtaskForm(false);
                  setSelectedDependencies([]);
                }}
                className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSubtask}
                disabled={!subtaskTitle.trim() || creatingSubtask}
                className="px-3 py-1 text-xs rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
              >
                {creatingSubtask ? 'Adding...' : (issue.issue_type === 'epic' || issue.issue_type === 'feature' ? 'Add task' : 'Add subtask')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowSubtaskForm(true)}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            <Plus className="h-4 w-4" />
            {issue.issue_type === 'epic' || issue.issue_type === 'feature' ? 'Add task' : 'Add subtask'}
          </button>
        )}
      </div>

      {/* Labels */}
      {issue.labels && issue.labels.length > 0 && (
        <div>
          <span className="text-xs text-zinc-400">Labels</span>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {issue.labels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
              >
                {label.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {issue.dependencies && issue.dependencies.length > 0 && (
        <div>
          <span className="text-xs text-zinc-400">Blocked by</span>
          <div className="mt-2 space-y-1">
            {issue.dependencies.map((dep) => (
              <div key={dep.id} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="font-mono text-xs text-zinc-400">{dep.dependsOnShortId || dep.dependsOnId.slice(0, 6)}</span>
                <span>{dep.dependsOnTitle}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project Memory */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
        <button
          onClick={() => setShowMemories(!showMemories)}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 w-full"
        >
          <Brain className="h-3.5 w-3.5" />
          <span>Project Memory</span>
          {memories.length > 0 && <span className="text-zinc-400">({memories.length})</span>}
          <ChevronDown className={`h-3 w-3 ml-auto transition-transform ${showMemories ? 'rotate-180' : ''}`} />
        </button>

        {showMemories && (
          <div className="mt-3 space-y-2">
            {loadingMemories ? (
              <p className="text-xs text-zinc-400">Loading...</p>
            ) : memories.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">No memory items for this project</p>
            ) : (
              memories.map((mem) => (
                <div key={mem.id} className="flex items-start gap-2 text-xs">
                  {mem.category === 'command' && <Terminal className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />}
                  {mem.category === 'config' && <Settings className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />}
                  {mem.category === 'note' && <Lightbulb className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-zinc-500 dark:text-zinc-400">{mem.key}</span>
                    <p className="text-zinc-600 dark:text-zinc-400 wrap-break-word">{mem.value}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Session info */}
      {(issue.created_in_session || issue.completed_in_session) && (
        <div className="flex items-center gap-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-400">
          {issue.created_in_session && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Created in session
            </span>
          )}
          {issue.completed_in_session && (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              Completed in session
            </span>
          )}
        </div>
      )}

      {/* Confirm Delete Subtask Dialog */}
      <ConfirmDialog
        isOpen={isConfirmDeleteSubtaskOpen}
        onClose={() => { setIsConfirmDeleteSubtaskOpen(false); setSubtaskToDelete(null); }}
        onConfirm={handleDeleteSubtask}
        title="Delete Subtask"
        message="Are you sure you want to delete this subtask? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Confirm Delete Child Dialog */}
      <ConfirmDialog
        isOpen={isConfirmDeleteChildOpen}
        onClose={() => { setIsConfirmDeleteChildOpen(false); setChildToDelete(null); }}
        onConfirm={handleDeleteChild}
        title="Delete Subtask"
        message="Are you sure you want to delete this subtask? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}

export function IssuesClient({ projects, initialProjectFilter, initialStatusFilter }: IssuesClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<IssueStats>({
    open: 0, in_progress: 0, blocked: 0, closed: 0, deferred: 0,
    total: 0, by_priority: {}, by_type: {}
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [issueToDelete, setIssueToDelete] = useState<string | null>(null);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Form state for create/edit
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    projectPath: '',
    status: 'open' as IssueStatus,
    priority: 0 as IssuePriority,
    issueType: 'task' as IssueType,
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const currentProject = initialProjectFilter || null;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateFilters = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === 'all') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const queryString = params.toString();
    router.push(`${pathname}${queryString ? `?${queryString}` : ''}`);
  };

  useEffect(() => {
    loadIssues();
  }, [currentProject, initialStatusFilter]);

  // Handle deep-link to specific issue from URL query param
  useEffect(() => {
    const issueId = searchParams.get('issue');
    if (issueId) {
      setExpandedIssueId(issueId);
    }
  }, [searchParams]);

  const loadIssues = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        ...(currentProject && { projectPath: currentProject }),
        ...(initialStatusFilter !== 'all' && { status: initialStatusFilter })
      });

      const response = await fetch(`/api/issues/list?${params}`);
      const data = await response.json();

      if (data.success) {
        setIssues(data.issues);
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Failed to load issues:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.projectPath || !formData.title) return;

    try {
      const response = await fetch('/api/issues/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: formData.projectPath,
          title: formData.title,
          description: formData.description,
          status: formData.status,
          priority: formData.priority,
          issueType: formData.issueType,
        })
      });

      if (response.ok) {
        resetForm();
        setIsAddDialogOpen(false);
        loadIssues();
      }
    } catch (error) {
      console.error('Failed to create issue:', error);
    }
  };

  // Extended update type to include project management operations
  type IssueUpdate = Partial<Issue> & {
    add_project_path?: string;
    remove_project_path?: string;
  };

  const handleUpdateIssue = async (issueId: string, updates: IssueUpdate) => {
    // For project path changes, reload after API call (no optimistic update)
    const isProjectChange = updates.add_project_path || updates.remove_project_path;

    if (!isProjectChange) {
      // Optimistic update - update UI immediately for non-project changes
      setIssues(prev => prev.map(i =>
        i.id === issueId ? { ...i, ...updates, updated_at: Date.now() } : i
      ));
    }

    try {
      const response = await fetch('/api/issues/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: issueId, ...updates })
      });

      if (!response.ok) {
        // Revert on failure
        loadIssues();
      } else if (isProjectChange) {
        // Reload to get fresh additional_project_paths
        loadIssues();
      }
    } catch (error) {
      console.error('Failed to update issue:', error);
      // Revert on error
      loadIssues();
    }
  };

  const handleDelete = (issueId: string) => {
    setIssueToDelete(issueId);
    setIsConfirmDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!issueToDelete) return;

    try {
      const params = new URLSearchParams({ id: issueToDelete });
      const response = await fetch(`/api/issues/delete?${params}`, { method: 'DELETE' });

      if (response.ok) {
        setIsConfirmDeleteOpen(false);
        setIssueToDelete(null);
        if (expandedIssueId === issueToDelete) setExpandedIssueId(null);
        loadIssues();
      }
    } catch (error) {
      console.error('Failed to delete issue:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      projectPath: currentProject || (projects[0]?.project_path || ''),
      status: 'open',
      priority: 0,
      issueType: 'task',
    });
    setEditingId(null);
  };

  const filteredIssues = issues.filter(i =>
    // Exclude subtasks from main list (they show under their parent)
    !i.parent && (
      i.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (i.description && i.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (i.short_id && i.short_id.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  );

  const selectedProject = projects.find(p => p.project_path === currentProject);
  const projectName = selectedProject?.project_path.split('/').pop() || null;

  const filterStatusOptions = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'closed', label: 'Closed' },
    { value: 'deferred', label: 'Deferred' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Issues</h1>
        <button
          onClick={() => {
            resetForm();
            setIsAddDialogOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-8 rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-sm focus:border-zinc-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
            className="flex items-center gap-1 h-8 rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          >
            <span>{projectName || 'All'}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {isProjectDropdownOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              <div className="max-h-64 overflow-y-auto py-1">
                <button
                  onClick={() => { updateFilters('project', null); setIsProjectDropdownOpen(false); }}
                  className={`w-full px-3 py-1.5 text-left text-sm ${!initialProjectFilter ? 'bg-zinc-100 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}
                >
                  All Projects
                </button>
                {projects.map((project) => (
                  <button
                    key={project.project_path}
                    onClick={() => { updateFilters('project', project.project_path); setIsProjectDropdownOpen(false); }}
                    className={`w-full px-3 py-1.5 text-left text-sm truncate ${initialProjectFilter === project.project_path ? 'bg-zinc-100 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}
                  >
                    {project.project_path.split('/').pop()}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {filterStatusOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => updateFilters('status', option.value)}
              className={`h-8 px-2.5 rounded-md text-sm transition-colors ${
                initialStatusFilter === option.value
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {(initialProjectFilter || initialStatusFilter !== 'all' || searchTerm) && (
          <button
            onClick={() => { setSearchTerm(''); updateFilters('project', null); updateFilters('status', 'all'); }}
            className="h-8 px-2 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Issues List */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
          </div>
        ) : filteredIssues.length === 0 ? (
          <EmptyState
            icon={<CheckSquare />}
            heading={searchTerm || initialStatusFilter !== 'all' ? 'No Issues Match Your Filters' : 'No Issues Yet'}
            description={searchTerm || initialStatusFilter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Create your first issue to get started tracking your work'}
          />
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredIssues.map((issue) => {
              const statusConfig = STATUS_CONFIG[issue.status] || DEFAULT_STATUS;
              const isSelected = expandedIssueId === issue.id;

              return (
                <div
                  key={issue.id}
                  className={`group flex items-center h-10 px-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors ${
                    isSelected ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''
                  } ${issue.status === 'closed' ? 'opacity-50' : ''}`}
                  onClick={() => setExpandedIssueId(isSelected ? null : issue.id)}
                >
                  {/* Priority - clickable */}
                  <div className="w-6 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <PriorityDropdown
                      value={issue.priority}
                      onChange={(priority) => handleUpdateIssue(issue.id, { priority })}
                    />
                  </div>

                  {/* Status - clickable */}
                  <div className="w-6 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <StatusDropdown
                      value={issue.status}
                      onChange={(status) => handleUpdateIssue(issue.id, { status })}
                    />
                  </div>

                  {/* ID */}
                  <span className="w-20 shrink-0 text-xs text-zinc-400 dark:text-zinc-500 font-mono mr-2">
                    {issue.short_id || issue.id.slice(0, 8)}
                  </span>

                  {/* Title */}
                  <span className={`flex-1 text-sm truncate ${
                    issue.status === 'closed' ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-100'
                  }`}>
                    {issue.title}
                  </span>

                  {/* Date */}
                  <span className="hidden sm:block w-20 text-xs text-zinc-400 text-right shrink-0">
                    {new Date(issue.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>

                  {/* Actions */}
                  <div className="w-8 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(issue.id); }}
                      className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Issue Detail Panel */}
      {expandedIssueId && (() => {
        const issue = filteredIssues.find(i => i.id === expandedIssueId);
        if (!issue) return null;
        const typeConfig = TYPE_CONFIG[issue.issue_type] || TYPE_OPTIONS[0];

        return (
          <IssueDetailPanel
            issue={issue}
            typeConfig={typeConfig}
            onClose={() => setExpandedIssueId(null)}
            onUpdate={(updates) => handleUpdateIssue(issue.id, updates)}
            onSubtaskCreated={loadIssues}
            projects={projects}
          />
        );
      })()}

      {/* Create Issue Modal */}
      {isAddDialogOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-xs font-medium">
                  {formData.projectPath ? formData.projectPath.split('/').pop() : 'SAV'}
                </span>
                <span className="text-zinc-400">›</span>
                <span className="text-zinc-700 dark:text-zinc-300">New issue</span>
              </div>
              <button
                onClick={() => { setIsAddDialogOpen(false); resetForm(); }}
                className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Title */}
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Issue title"
                autoFocus
                className="w-full text-lg font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 bg-transparent border-none outline-none"
              />

              {/* Description */}
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Add description..."
                rows={4}
                className="w-full text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 bg-transparent border-none outline-none resize-none"
              />
            </div>

            {/* Property Pills */}
            <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDropdown
                  value={formData.status}
                  onChange={(status) => setFormData({ ...formData, status })}
                  size="md"
                />
                <PriorityDropdown
                  value={formData.priority}
                  onChange={(priority) => setFormData({ ...formData, priority })}
                  size="md"
                />
                <TypeDropdown
                  value={formData.issueType}
                  onChange={(issueType) => setFormData({ ...formData, issueType })}
                />
                <ProjectDropdown
                  value={formData.projectPath}
                  onChange={(projectPath) => setFormData({ ...formData, projectPath })}
                  projects={projects}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => { setIsAddDialogOpen(false); resetForm(); }}
                className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!formData.title || !formData.projectPath}
                className="px-4 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create issue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={isConfirmDeleteOpen}
        onClose={() => setIsConfirmDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Issue"
        message="Are you sure you want to delete this issue? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
