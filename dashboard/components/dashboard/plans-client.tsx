'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  FileText, Plus, Search, Trash2, Circle, PlayCircle, CheckCircle2,
  ChevronDown, X, Clock, MoreHorizontal, Check, Hexagon, Upload,
  CheckSquare, Bug, Sparkles, Wrench
} from 'lucide-react';
import type { ProjectSummary, Plan, PlanStatus, PlanStats, Issue } from '@/lib/types';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Helper to extract text from React children
function getTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(getTextContent).join('');
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode };
    return getTextContent(props.children);
  }
  return '';
}

// Strip {#id} syntax and return clean text + id
function parseHeading(children: React.ReactNode): { text: string; id?: string } {
  const text = getTextContent(children);
  const match = text.match(/^(.+?)\s*\{#([\w.-]+)\}$/);
  if (match) {
    return { text: match[1], id: match[2] };
  }
  return { text };
}

// Custom markdown components to handle anchor syntax {#id} and anchor links
const markdownComponents: Components = {
  h1: ({ children, ...props }) => {
    const { text, id } = parseHeading(children);
    return <h1 id={id} {...props}>{text}</h1>;
  },
  h2: ({ children, ...props }) => {
    const { text, id } = parseHeading(children);
    return <h2 id={id} {...props}>{text}</h2>;
  },
  h3: ({ children, ...props }) => {
    const { text, id } = parseHeading(children);
    return <h3 id={id} {...props}>{text}</h3>;
  },
  h4: ({ children, ...props }) => {
    const { text, id } = parseHeading(children);
    return <h4 id={id} {...props}>{text}</h4>;
  },
  // Handle anchor links - scroll within container
  a: ({ href, children, ...props }) => {
    if (href?.startsWith('#')) {
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            const id = href.slice(1);
            const element = document.getElementById(id);
            element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          {...props}
        >
          {children}
        </a>
      );
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
};

interface PlansClientProps {
  projects: ProjectSummary[];
  initialProjectFilter?: string;
  initialStatusFilter: string;
}

// Status configuration
const STATUS_OPTIONS: { value: PlanStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'draft', label: 'Draft', icon: <Circle className="h-[14px] w-[14px]" strokeWidth={2} />, color: 'text-zinc-400' },
  { value: 'active', label: 'Active', icon: <PlayCircle className="h-[14px] w-[14px]" />, color: 'text-blue-500' },
  { value: 'completed', label: 'Completed', icon: <CheckCircle2 className="h-[14px] w-[14px]" />, color: 'text-green-500' },
];

const STATUS_CONFIG = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]));
const DEFAULT_STATUS = STATUS_OPTIONS[0];

// Issue type configuration for linked issues display
const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  task: { icon: <CheckSquare className="h-4 w-4" />, color: 'text-blue-500' },
  bug: { icon: <Bug className="h-4 w-4" />, color: 'text-red-500' },
  feature: { icon: <Sparkles className="h-4 w-4" />, color: 'text-purple-500' },
  chore: { icon: <Wrench className="h-4 w-4" />, color: 'text-zinc-500' },
};

// Generic dropdown component
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="flex items-center"
      >
        {trigger}
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
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
      )}
    </div>
  );
}

// Status Dropdown
function StatusDropdown({ value, onChange, size = 'sm' }: { value: PlanStatus; onChange: (status: PlanStatus) => void; size?: 'sm' | 'md' }) {
  const current = STATUS_CONFIG[value] || DEFAULT_STATUS;

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

// Project Dropdown
function ProjectDropdown({ value, onChange, projects }: { value: string; onChange: (path: string) => void; projects: ProjectSummary[] }) {
  const projectOptions = projects
    .filter(p => p.source_path)
    .map(p => ({ value: p.source_path!, label: p.name || p.source_path!.split('/').pop() || p.source_path! }));
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

// Plan Detail Panel
function PlanDetailPanel({
  plan,
  projects,
  onClose,
  onUpdate,
}: {
  plan: Plan;
  projects: ProjectSummary[];
  onClose: () => void;
  onUpdate: (updates: Partial<Plan>) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [editingCriteria, setEditingCriteria] = useState(false);
  const [titleValue, setTitleValue] = useState(plan.title);
  const [contentValue, setContentValue] = useState(plan.content);
  const [criteriaValue, setCriteriaValue] = useState(plan.success_criteria || '');

  // Use epics directly from plan - already fetched by getPlans
  const linkedEpics = plan.epics || [];
  const linkedIssues = plan.linked_issues || [];

  useEffect(() => {
    setTitleValue(plan.title);
    setContentValue(plan.content);
    setCriteriaValue(plan.success_criteria || '');
  }, [plan.title, plan.content, plan.success_criteria]);

  const handleTitleSave = () => {
    if (titleValue.trim() && titleValue !== plan.title) {
      onUpdate({ title: titleValue.trim() });
    }
    setEditingTitle(false);
  };

  const handleContentSave = () => {
    if (contentValue !== plan.content) {
      onUpdate({ content: contentValue });
    }
    setEditingContent(false);
  };

  const handleCriteriaSave = () => {
    if (criteriaValue !== (plan.success_criteria || '')) {
      onUpdate({ success_criteria: criteriaValue || null });
    }
    setEditingCriteria(false);
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <FileText className="h-3.5 w-3.5" />
            <span className="font-mono">{plan.short_id || plan.id.slice(0, 8)}</span>
            <span>·</span>
            <span>Plan</span>
          </div>
          {editingTitle ? (
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSave();
                if (e.key === 'Escape') {
                  setTitleValue(plan.title);
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
              {plan.title}
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

      {/* Properties */}
      <div className="flex flex-wrap gap-2">
        <StatusDropdown
          value={plan.status}
          onChange={(status) => onUpdate({ status })}
          size="md"
        />
        <ProjectDropdown
          value={plan.project_path}
          onChange={(project_path) => onUpdate({ project_path })}
          projects={projects}
        />
      </div>

      {/* Content */}
      <div>
        <span className="text-xs text-zinc-400">Content</span>
        {editingContent ? (
          <textarea
            value={contentValue}
            onChange={(e) => setContentValue(e.target.value)}
            onBlur={handleContentSave}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setContentValue(plan.content);
                setEditingContent(false);
              }
            }}
            autoFocus
            rows={12}
            className="w-full mt-1 text-sm text-zinc-600 dark:text-zinc-400 bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md p-3 outline-none focus:border-zinc-400 resize-none font-mono"
            placeholder="Write your plan..."
          />
        ) : (
          <div
            onClick={() => setEditingContent(true)}
            className="mt-1 text-sm cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded px-3 py-2 -mx-3 min-h-[8rem] border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700"
          >
            {plan.content ? (
              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none
                prose-headings:font-semibold prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100
                prose-h1:text-lg prose-h1:border-b prose-h1:border-zinc-200 dark:prose-h1:border-zinc-700 prose-h1:pb-2 prose-h1:mb-4
                prose-h2:text-base prose-h2:mt-6 prose-h2:mb-3
                prose-h3:text-sm prose-h3:mt-4 prose-h3:mb-2
                prose-p:text-zinc-600 dark:prose-p:text-zinc-400 prose-p:my-2
                prose-li:text-zinc-600 dark:prose-li:text-zinc-400 prose-li:my-0.5
                prose-ul:my-2 prose-ol:my-2
                prose-code:text-xs prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-zinc-800 dark:prose-code:text-zinc-200
                prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-800 prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-3
                prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100
                prose-blockquote:border-l-zinc-300 dark:prose-blockquote:border-l-zinc-600 prose-blockquote:text-zinc-500 dark:prose-blockquote:text-zinc-400 prose-blockquote:not-italic
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{plan.content}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-zinc-400 italic">Write your plan...</p>
            )}
          </div>
        )}
      </div>

      {/* Success Criteria */}
      <div>
        <span className="text-xs text-zinc-400">Success Criteria</span>
        {editingCriteria ? (
          <input
            type="text"
            value={criteriaValue}
            onChange={(e) => setCriteriaValue(e.target.value)}
            onBlur={handleCriteriaSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCriteriaSave();
              if (e.key === 'Escape') {
                setCriteriaValue(plan.success_criteria || '');
                setEditingCriteria(false);
              }
            }}
            autoFocus
            className="w-full mt-1 text-sm text-zinc-600 dark:text-zinc-400 bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md p-2 outline-none focus:border-zinc-400"
            placeholder="Define success criteria..."
          />
        ) : (
          <div
            onClick={() => setEditingCriteria(true)}
            className="mt-1 text-sm cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded px-2 py-1 -mx-2 min-h-[2rem]"
          >
            {plan.success_criteria ? (
              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none
                prose-p:text-zinc-600 dark:prose-p:text-zinc-400 prose-p:my-1
                prose-li:text-zinc-600 dark:prose-li:text-zinc-400 prose-li:my-0.5
                prose-ul:my-1 prose-ol:my-1 prose-ul:list-disc prose-ul:pl-5
                prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100
              ">
                <ReactMarkdown>
                  {plan.success_criteria.replace(/([^\n])\n-/g, '$1\n\n-')}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-zinc-400 italic">Define success criteria...</p>
            )}
          </div>
        )}
      </div>

      {/* Linked Epics */}
      {linkedEpics.length > 0 && (
        <div>
          <span className="text-xs text-zinc-400">Linked Epics</span>
          <div className="mt-2 space-y-1.5">
            {linkedEpics.map((epic) => (
              <a
                key={epic.id}
                href={`/dashboard/issues?issue=${epic.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors cursor-pointer"
              >
                {epic.status === 'closed' ? (
                  <CheckCircle2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
                ) : epic.status === 'in_progress' ? (
                  <PlayCircle className="h-4 w-4 text-blue-500 flex-shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-zinc-400 flex-shrink-0" strokeWidth={2} />
                )}
                <span className="text-xs font-mono text-zinc-400">{epic.short_id}</span>
                <span className={`flex-1 text-sm truncate ${epic.status === 'closed' ? 'text-zinc-400 line-through' : 'text-zinc-700 dark:text-zinc-300'}`}>
                  {epic.title}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Linked Issues (non-epic: tasks, bugs, features, chores) */}
      {linkedIssues.length > 0 && (
        <div>
          <span className="text-xs text-zinc-400">Linked Issues</span>
          <div className="mt-2 space-y-1.5">
            {linkedIssues.map((issue) => {
              const typeConfig = TYPE_CONFIG[issue.issue_type] || TYPE_CONFIG.task;
              return (
                <a
                  key={issue.id}
                  href={`/dashboard/issues?issue=${issue.id}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors cursor-pointer"
                >
                  {issue.status === 'closed' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <span className={`flex-shrink-0 ${typeConfig.color}`}>{typeConfig.icon}</span>
                  )}
                  <span className="text-xs font-mono text-zinc-400">{issue.short_id}</span>
                  <span className={`flex-1 text-sm truncate ${issue.status === 'closed' ? 'text-zinc-400 line-through' : 'text-zinc-700 dark:text-zinc-300'}`}>
                    {issue.title}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Updated {new Date(plan.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        {linkedEpics.length > 0 && (
          <span>
            {linkedEpics.filter(e => e.status === 'closed').length}/{linkedEpics.length} epics
          </span>
        )}
        {linkedIssues.length > 0 && (
          <span>
            {linkedIssues.filter(i => i.status === 'closed').length}/{linkedIssues.length} issues
          </span>
        )}
      </div>
    </div>
  );
}

export function PlansClient({ projects, initialProjectFilter, initialStatusFilter }: PlansClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stats, setStats] = useState<PlanStats>({ draft: 0, active: 0, completed: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<string | null>(null);
  const [tasksToDelete, setTasksToDelete] = useState<{ id: string; short_id: string; title: string }[]>([]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    successCriteria: '',
    projectPath: '',
    status: 'draft' as PlanStatus,
  });

  const currentProject = initialProjectFilter || null;

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
    loadPlans();
  }, [currentProject, initialStatusFilter]);

  const loadPlans = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        ...(currentProject && { projectPath: currentProject }),
        ...(initialStatusFilter !== 'all' && { status: initialStatusFilter })
      });

      const response = await fetch(`/api/plans/list?${params}`);
      const data = await response.json();

      if (data.success) {
        setPlans(data.plans);
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Failed to load plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.projectPath || !formData.title) return;

    try {
      const response = await fetch('/api/plans/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: formData.projectPath,
          title: formData.title.trim(),
          content: formData.content.trim() || '# Overview\n\n',
          successCriteria: formData.successCriteria.trim() || null,
          status: formData.status,
        }),
      });

      if (response.ok) {
        resetForm();
        setIsAddDialogOpen(false);
        loadPlans();
      }
    } catch (error) {
      console.error('Failed to create plan:', error);
    }
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Only accept markdown files
    if (!file.name.endsWith('.md')) {
      alert('Please select a markdown (.md) file');
      return;
    }

    try {
      const content = await file.text();

      // Extract title from first # heading or use filename
      const headingMatch = content.match(/^#\s+(.+)$/m);
      const title = headingMatch
        ? headingMatch[1].trim()
        : file.name.replace(/\.md$/, '');

      // Pre-fill the form with imported content
      setFormData(prev => ({
        ...prev,
        title,
        content,
      }));
    } catch (error) {
      console.error('Failed to read file:', error);
      alert('Failed to read file');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUpdatePlan = async (planId: string, updates: Partial<Plan>) => {
    setPlans(prev => prev.map(p =>
      p.id === planId ? { ...p, ...updates, updated_at: Date.now() } : p
    ));

    try {
      const response = await fetch('/api/plans/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: planId, ...updates }),
      });

      if (!response.ok) {
        loadPlans();
      }
    } catch (error) {
      console.error('Failed to update plan:', error);
      loadPlans();
    }
  };

  const handleDelete = async (planId: string) => {
    setPlanToDelete(planId);
    // Fetch tasks that will be deleted
    try {
      const response = await fetch(`/api/plans/delete?id=${planId}`);
      const data = await response.json();
      setTasksToDelete(data.tasks || []);
    } catch {
      setTasksToDelete([]);
    }
    setIsConfirmDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!planToDelete) return;

    try {
      const response = await fetch('/api/plans/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: planToDelete }),
      });

      if (response.ok) {
        setIsConfirmDeleteOpen(false);
        setPlanToDelete(null);
        setTasksToDelete([]);
        if (expandedPlanId === planToDelete) setExpandedPlanId(null);
        loadPlans();
      }
    } catch (error) {
      console.error('Failed to delete plan:', error);
    }
  };

  const getDeleteMessage = () => {
    if (tasksToDelete.length === 0) {
      return 'Are you sure you want to delete this plan? This action cannot be undone.';
    }
    return `Are you sure you want to delete this plan? The following ${tasksToDelete.length} task${tasksToDelete.length !== 1 ? 's' : ''} will also be deleted:\n\n${tasksToDelete.map(t => `• ${t.short_id || t.id.slice(0, 8)}: ${t.title}`).join('\n')}\n\nThis action cannot be undone.`;
  };

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      successCriteria: '',
      projectPath: currentProject || (projects[0]?.source_path || ''),
      status: 'draft',
    });
  };

  const filteredPlans = plans.filter(plan =>
    plan.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    plan.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedProject = projects.find(p => p.source_path === currentProject);
  const projectName = selectedProject?.source_path?.split('/').pop() || null;

  const filterStatusOptions = [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
  ];

  return (
    <div className="space-y-4">
      {/* Hidden file input for import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileImport}
        accept=".md"
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Plans</h1>
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
                {projects.filter(p => p.source_path).map((project) => (
                  <button
                    key={project.source_path!}
                    onClick={() => { updateFilters('project', project.source_path!); setIsProjectDropdownOpen(false); }}
                    className={`w-full px-3 py-1.5 text-left text-sm truncate ${initialProjectFilter === project.source_path ? 'bg-zinc-100 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}
                  >
                    {project.source_path!.split('/').pop()}
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

      {/* Plans List */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
          </div>
        ) : filteredPlans.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            heading={searchTerm || initialStatusFilter !== 'all' ? 'No Plans Match Your Filters' : 'No Plans Yet'}
            description={searchTerm || initialStatusFilter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Create a plan to organize and track your work'}
          />
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredPlans.map((plan) => {
              const statusConfig = STATUS_CONFIG[plan.status] || DEFAULT_STATUS;
              const isSelected = expandedPlanId === plan.id;

              return (
                <div
                  key={plan.id}
                  className={`group flex items-center h-10 px-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors ${
                    isSelected ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''
                  } ${plan.status === 'completed' ? 'opacity-50' : ''}`}
                  onClick={() => setExpandedPlanId(isSelected ? null : plan.id)}
                >
                  {/* Status - clickable */}
                  <div className="w-6 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <StatusDropdown
                      value={plan.status}
                      onChange={(status) => handleUpdatePlan(plan.id, { status })}
                    />
                  </div>

                  {/* ID */}
                  <span className="w-20 flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
                    {plan.short_id || plan.id.slice(0, 8)}
                  </span>

                  {/* Title */}
                  <span className={`flex-1 text-sm truncate ${
                    plan.status === 'completed' ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-100'
                  }`}>
                    {plan.title}
                  </span>

                  {/* Epic and Issue counts */}
                  {((plan.epic_count ?? 0) > 0 || (plan.linked_issue_count ?? 0) > 0) && (
                    <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 mr-4">
                      {[
                        (plan.epic_count ?? 0) > 0 && `${plan.epic_count} epic${plan.epic_count !== 1 ? 's' : ''}`,
                        (plan.linked_issue_count ?? 0) > 0 && `${plan.linked_issue_count} issue${plan.linked_issue_count !== 1 ? 's' : ''}`
                      ].filter(Boolean).join(' · ')}
                    </span>
                  )}

                  {/* Date */}
                  <span className="hidden sm:block w-20 text-xs text-zinc-400 text-right flex-shrink-0">
                    {new Date(plan.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>

                  {/* Actions */}
                  <div className="w-8 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(plan.id); }}
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

      {/* Plan Detail Panel */}
      {expandedPlanId && (() => {
        const plan = filteredPlans.find(p => p.id === expandedPlanId);
        if (!plan) return null;

        return (
          <PlanDetailPanel
            plan={plan}
            projects={projects}
            onClose={() => setExpandedPlanId(null)}
            onUpdate={(updates) => handleUpdatePlan(plan.id, updates)}
          />
        );
      })()}

      {/* Create Plan Modal */}
      {isAddDialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-zinc-400" />
                <span className="text-zinc-700 dark:text-zinc-300">New plan</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import
                </button>
                <button
                  onClick={() => { setIsAddDialogOpen(false); resetForm(); }}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 overflow-y-auto flex-1">
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Untitled"
                autoFocus
                className="w-full text-2xl font-semibold text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 bg-transparent border-none outline-none mb-4"
              />

              {/* Content - rendered markdown or textarea */}
              {formData.content ? (
                <div className="min-h-[300px] prose prose-sm prose-zinc dark:prose-invert max-w-none
                  prose-headings:font-semibold prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100
                  prose-h1:text-xl prose-h1:mt-0 prose-h1:mb-4
                  prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
                  prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2
                  prose-p:text-zinc-600 dark:prose-p:text-zinc-400 prose-p:my-2 prose-p:leading-relaxed
                  prose-li:text-zinc-600 dark:prose-li:text-zinc-400 prose-li:my-0.5
                  prose-ul:my-2 prose-ol:my-2
                  prose-code:text-xs prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-zinc-700 dark:prose-code:text-zinc-300
                  prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-800 prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-3
                  prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100 prose-strong:font-semibold
                  prose-blockquote:border-l-zinc-300 dark:prose-blockquote:border-l-zinc-600 prose-blockquote:text-zinc-500 dark:prose-blockquote:text-zinc-400 prose-blockquote:not-italic
                  prose-hr:border-zinc-200 dark:prose-hr:border-zinc-700
                ">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{formData.content}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Start writing your plan or import a markdown file..."
                  rows={14}
                  className="w-full text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 bg-transparent border-none outline-none resize-none"
                />
              )}

              <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <input
                  type="text"
                  value={formData.successCriteria}
                  onChange={(e) => setFormData({ ...formData, successCriteria: e.target.value })}
                  placeholder="Success criteria (optional)"
                  className="w-full text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 bg-transparent border-none outline-none"
                />
              </div>
            </div>

            {/* Properties */}
            <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDropdown
                  value={formData.status}
                  onChange={(status) => setFormData({ ...formData, status })}
                  size="md"
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
                Create plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={isConfirmDeleteOpen}
        onClose={() => { setIsConfirmDeleteOpen(false); setTasksToDelete([]); }}
        onConfirm={confirmDelete}
        title="Delete Plan"
        message={getDeleteMessage()}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
