'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Plus, Search, Trash2, CheckSquare, CheckCircle2,
  ChevronDown, ChevronRight, X,
  Clock, MoreHorizontal, Tag, Hexagon,
  FileText, Brain, FolderKanban, Terminal, Settings, Lightbulb, Star,
  Copy, Link2
} from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ProjectSummary, Issue, IssueStats, IssueStatus, IssuePriority, IssueType, Plan, Memory, InlineIssueFormData } from '@/lib/types';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IssueProgress } from '@/components/ui/issue-progress';
import { Badge } from '@/components/ui/badge';
import { IssueActionMenu } from '@/components/dashboard/issues/shared/issue-action-menu';
import { InlineIssueForm } from '@/components/dashboard/issues/forms/inline-issue-form';
import { LabelSelect, LabelDisplay } from '@/components/dashboard/shared/label-select';
import { ProjectDropdown, AddProjectDropdown } from '@/components/dashboard/shared/project-dropdown';
import {
  STATUS_OPTIONS, STATUS_CONFIG, DEFAULT_STATUS,
  PRIORITY_OPTIONS, TYPE_OPTIONS, TYPE_CONFIG, PriorityIcon,
  ISSUE_FILTER_STATUS_OPTIONS
} from '@/lib/constants/issue-config';
import { StatusDropdown, PriorityDropdown, TypeDropdown, IssueDetailPanel } from './components';

// Re-export for backward compatibility
export { IssueDetailPanel } from './components';

import { DATE_FILTER_PRESETS, type DateFilterPreset } from '@/lib/constants/time';
import { toast } from 'sonner';
import { useIssueEvents, useRefreshCounter } from '@/lib/hooks/use-issue-events';

interface IssuesClientProps {
  projects: ProjectSummary[];
  initialProjectFilter?: string;
  initialStatusFilter: string;
  initialDateFilter?: DateFilterPreset;
  cloneIssueId?: string;
  duplicateIssueId?: string;
  reactivateIssueId?: string;
}

export function IssuesClient({ projects, initialProjectFilter, initialStatusFilter, initialDateFilter = 'all', cloneIssueId, duplicateIssueId, reactivateIssueId }: IssuesClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Subscribe to SSE for real-time updates
  useIssueEvents();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<IssueStats>({
    backlog: 0, open: 0, in_progress: 0, blocked: 0, closed: 0, deferred: 0,
    total: 0, by_priority: {}, by_type: {}
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [issueToDelete, setIssueToDelete] = useState<string | null>(null);
  const [isMarkDuplicateOpen, setIsMarkDuplicateOpen] = useState(false);
  const [issueToMarkDuplicate, setIssueToMarkDuplicate] = useState<Issue | null>(null);
  const [duplicateSearchTerm, setDuplicateSearchTerm] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloningFromIssue, setCloningFromIssue] = useState<Issue | null>(null);
  const [isReactivateOpen, setIsReactivateOpen] = useState(false);
  const [issueToReactivate, setIssueToReactivate] = useState<Issue | null>(null);
  const [reactivateSearchTerm, setReactivateSearchTerm] = useState('');
  const [reactivateParentOptions, setReactivateParentOptions] = useState<Issue[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target as Node)) {
        setIsStatusDropdownOpen(false);
      }
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(event.target as Node)) {
        setIsDateDropdownOpen(false);
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
    const newUrl = `${pathname}${queryString ? `?${queryString}` : ''}`;

    // Save filter state to sessionStorage for back navigation
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('issuesListUrl', newUrl);
    }

    router.push(newUrl);
  };

  // Save current filter state to sessionStorage on mount and when filters change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const queryString = searchParams.toString();
      const currentUrl = `${pathname}${queryString ? `?${queryString}` : ''}`;
      sessionStorage.setItem('issuesListUrl', currentUrl);
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    loadIssues();
  }, [currentProject, initialStatusFilter, initialDateFilter]);

  // Handle deep-link to specific issue from URL query param - redirect to detail page
  useEffect(() => {
    const issueId = searchParams.get('issue');
    if (issueId) {
      router.push(`/dashboard/issues/${issueId}`);
    }
  }, [searchParams, router]);

  // Handle issue actions from URL query params (from issue detail page)
  useEffect(() => {
    const actionId = cloneIssueId || duplicateIssueId || reactivateIssueId;
    if (!actionId) return;

    const action = cloneIssueId ? 'clone' : duplicateIssueId ? 'duplicate' : 'reactivate';

    const fetchAndAct = async () => {
      try {
        const response = await fetch(`/api/issues/${actionId}`);
        if (!response.ok) return;

        const data = await response.json();
        const issue = data.issue;
        if (!issue) return;

        if (action === 'clone') {
          setIsCloning(true);
          setCloningFromIssue(issue);
          setFormData({
            title: `${issue.title} (copy)`,
            description: issue.description || '',
            projectPath: issue.project_path,
            status: 'open',
            priority: issue.priority,
            issueType: issue.issue_type,
          });
          setIsAddDialogOpen(true);
        } else if (action === 'duplicate') {
          setIssueToMarkDuplicate(issue);
          setIsMarkDuplicateOpen(true);
        } else if (action === 'reactivate') {
          // Fetch parent options for reactivate modal
          setIssueToReactivate(issue);
          setReactivateSearchTerm('');
          setReactivateParentOptions([]);
          setIsReactivateOpen(true);

          const params = new URLSearchParams();
          if (issue.project_path) params.set('projectPath', issue.project_path);
          const parentsResponse = await fetch(`/api/issues/list?${params}`);
          if (parentsResponse.ok) {
            const parentsData = await parentsResponse.json();
            const potentialParents = (parentsData.data?.issues || []).filter((i: Issue) =>
              i.id !== issue.id &&
              i.status !== 'closed' &&
              (i.issue_type === 'epic' || i.issue_type === 'feature' || i.issue_type === 'task')
            );
            setReactivateParentOptions(potentialParents);
          }
        }

        router.replace('/dashboard/issues', { scroll: false });
      } catch (error) {
        console.error(`Failed to fetch issue for ${action}:`, error);
        toast.error(`Failed to load issue for ${action}`);
      }
    };

    fetchAndAct();
  }, [cloneIssueId, duplicateIssueId, reactivateIssueId, router]);

  const loadIssues = async () => {
    try {
      setLoading(true);

      // Get date filter params from preset
      const datePreset = DATE_FILTER_PRESETS.find(p => p.value === initialDateFilter);

      const params = new URLSearchParams();
      if (currentProject) params.set('projectPath', currentProject);
      if (initialStatusFilter !== 'all') {
        params.set('status', initialStatusFilter);
      }
      // Always show only root issues - subtasks are nested under their parents
      params.set('parentId', 'null');
      if (datePreset && 'createdInLastHours' in datePreset.params) {
        params.set('createdInLastHours', String(datePreset.params.createdInLastHours));
      }
      if (datePreset && 'createdInLastDays' in datePreset.params) {
        params.set('createdInLastDays', String(datePreset.params.createdInLastDays));
      }

      const response = await fetch(`/api/issues/list?${params}`);
      const data = await response.json();

      if (data.success) {
        setIssues(data.data.issues);
        setStats(data.data.stats);
      }
    } catch (error) {
      console.error('Failed to load issues:', error);
      toast.error('Failed to load issues');
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
      toast.error('Failed to create issue');
    }
  };

  // Extended update type to include project management operations
  type IssueUpdate = Partial<Issue> & {
    add_project_path?: string;
    remove_project_path?: string;
  };

  const handleUpdateIssue = useCallback(async (issueId: string, updates: IssueUpdate) => {
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
      toast.error('Failed to update issue');
      // Revert on error
      loadIssues();
    }
  }, []);

  const handleDelete = useCallback((issueId: string) => {
    setIssueToDelete(issueId);
    setIsConfirmDeleteOpen(true);
  }, []);

  const confirmDelete = async () => {
    if (!issueToDelete) return;

    try {
      const params = new URLSearchParams({ id: issueToDelete });
      const response = await fetch(`/api/issues/delete?${params}`, { method: 'DELETE' });

      if (response.ok) {
        setIsConfirmDeleteOpen(false);
        setIssueToDelete(null);
        loadIssues();
      }
    } catch (error) {
      console.error('Failed to delete issue:', error);
      toast.error('Failed to delete issue');
    }
  };

  const handleMarkDuplicate = useCallback((issue: Issue) => {
    setIssueToMarkDuplicate(issue);
    setDuplicateSearchTerm('');
    setIsMarkDuplicateOpen(true);
  }, []);

  const confirmMarkDuplicate = async (duplicateOfId: string) => {
    if (!issueToMarkDuplicate) return;

    try {
      const response = await fetch('/api/issues/mark-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: issueToMarkDuplicate.id,
          duplicate_of_id: duplicateOfId,
        }),
      });

      if (response.ok) {
        setIsMarkDuplicateOpen(false);
        setIssueToMarkDuplicate(null);
        setDuplicateSearchTerm('');
        loadIssues();
      }
    } catch (error) {
      console.error('Failed to mark issue as duplicate:', error);
      toast.error('Failed to mark as duplicate');
    }
  };

  const handleReactivateTo = useCallback(async (issue: Issue) => {
    setIssueToReactivate(issue);
    setReactivateSearchTerm('');
    setReactivateParentOptions([]);
    setIsReactivateOpen(true);

    // Fetch all potential parent issues (epics/features/tasks that aren't closed)
    try {
      const params = new URLSearchParams();
      if (issue.project_path) params.set('projectPath', issue.project_path);
      const response = await fetch(`/api/issues/list?${params}`);
      if (response.ok) {
        const data = await response.json();
        const potentialParents = (data.data?.issues || []).filter((i: Issue) =>
          i.id !== issue.id &&
          i.status !== 'closed' &&
          (i.issue_type === 'epic' || i.issue_type === 'feature' || i.issue_type === 'task')
        );
        setReactivateParentOptions(potentialParents);
      }
    } catch (error) {
      console.error('Failed to fetch parent options:', error);
      toast.error('Failed to load parent options');
    }
  }, []);

  const confirmReactivateTo = async (newParentId: string | null) => {
    if (!issueToReactivate) return;

    const issueId = issueToReactivate.id;
    try {
      const response = await fetch('/api/issues/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: issueId,
          status: 'open',
          parent_id: newParentId,
        }),
      });

      if (response.ok) {
        setIsReactivateOpen(false);
        setIssueToReactivate(null);
        setReactivateSearchTerm('');
        setReactivateParentOptions([]);
        toast.success('Issue reactivated');
        router.push(`/dashboard/issues/${issueId}`);
      } else {
        toast.error('Failed to reactivate issue');
      }
    } catch (error) {
      console.error('Failed to reactivate issue:', error);
      toast.error('Failed to reactivate issue');
    }
  };

  const handleClone = useCallback((issue: Issue) => {
    setIsCloning(true);
    setCloningFromIssue(issue);
    setFormData({
      title: `${issue.title} (copy)`,
      description: issue.description || '',
      projectPath: issue.project_path,
      status: 'open', // Always start clones fresh
      priority: issue.priority,
      issueType: issue.issue_type,
    });
    setIsAddDialogOpen(true);
  }, []);

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
    setIsCloning(false);
    setCloningFromIssue(null);
  };

  const filteredIssues = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    return issues.filter(i => {
      // Match search term
      return (
        i.title.toLowerCase().includes(searchLower) ||
        (i.description && i.description.toLowerCase().includes(searchLower)) ||
        (i.short_id && i.short_id.toLowerCase().includes(searchLower))
      );
    });
  }, [issues, searchTerm]);

  const selectedProject = useMemo(
    () => projects.find(p => p.project_path === currentProject),
    [projects, currentProject]
  );
  const projectName = selectedProject?.project_path.split('/').pop() || null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Issues
          </h1>
          <p className="mt-1 sm:mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Track tasks, bugs, and features across your projects
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setIsAddDialogOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[rgb(var(--sidebar-primary))] px-4 py-2.5 text-sm font-medium text-[rgb(var(--sidebar-primary-foreground))] shadow-sm transition-all hover:opacity-90 w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          New Issue
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

        {/* Status filter dropdown */}
        <div className="relative" ref={statusDropdownRef}>
          <button
            onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
            className="flex items-center gap-1 h-8 rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          >
            {initialStatusFilter !== 'all' && STATUS_CONFIG[initialStatusFilter as IssueStatus] ? (
              <span className={STATUS_CONFIG[initialStatusFilter as IssueStatus].color}>
                {STATUS_CONFIG[initialStatusFilter as IssueStatus].icon}
              </span>
            ) : (
              <CheckSquare className="h-3.5 w-3.5" />
            )}
            <span>{ISSUE_FILTER_STATUS_OPTIONS.find(o => o.value === initialStatusFilter)?.label || 'All'}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {isStatusDropdownOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              <div className="py-1">
                {ISSUE_FILTER_STATUS_OPTIONS.map((option) => {
                  const config = STATUS_CONFIG[option.value as IssueStatus];
                  return (
                    <button
                      key={option.value}
                      onClick={() => { updateFilters('status', option.value); setIsStatusDropdownOpen(false); }}
                      className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${initialStatusFilter === option.value ? 'bg-zinc-100 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}
                    >
                      {config ? (
                        <span className={config.color}>{config.icon}</span>
                      ) : (
                        <CheckSquare className="h-4 w-4 text-zinc-400" />
                      )}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Date filter dropdown */}
        <div className="relative" ref={dateDropdownRef}>
          <button
            onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
            className="flex items-center gap-1 h-8 rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          >
            <Clock className="h-3.5 w-3.5" />
            <span>{DATE_FILTER_PRESETS.find(p => p.value === initialDateFilter)?.label || 'All'}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {isDateDropdownOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-32 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              <div className="py-1">
                {DATE_FILTER_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => { updateFilters('date', preset.value); setIsDateDropdownOpen(false); }}
                    className={`w-full px-3 py-1.5 text-left text-sm ${initialDateFilter === preset.value ? 'bg-zinc-100 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {(initialProjectFilter || initialStatusFilter !== 'all' || initialDateFilter !== 'all' || searchTerm) && (
          <button
            onClick={() => { setSearchTerm(''); updateFilters('project', null); updateFilters('status', 'all'); updateFilters('date', 'all'); }}
            className="h-8 px-2 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Issues List */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
          </div>
        ) : filteredIssues.length === 0 ? (
          <EmptyState
            icon={<CheckSquare />}
            heading={searchTerm || initialStatusFilter !== 'all' || initialDateFilter !== 'all' ? 'No Issues Match Your Filters' : 'No Issues Yet'}
            description={searchTerm || initialStatusFilter !== 'all' || initialDateFilter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Create your first issue to get started tracking your work'}
          />
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredIssues.map((issue) => {
              const statusConfig = STATUS_CONFIG[issue.status] || DEFAULT_STATUS;

              return (
                <div
                  key={issue.id}
                  className={`group flex items-center h-10 px-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors ${issue.status === 'closed' ? 'opacity-50' : ''}`}
                  onClick={() => router.push(`/dashboard/issues/${issue.id}`)}
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
                  <span className="w-24 shrink-0 text-xs text-zinc-400 dark:text-zinc-500 font-mono mr-2 truncate" title={issue.short_id || issue.id}>
                    {issue.short_id || issue.id.slice(0, 8)}
                  </span>

                  {/* Title */}
                  <span className={`flex-1 text-sm truncate ${
                    issue.status === 'closed' ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-100'
                  }`}>
                    {issue.title}
                  </span>

                  {/* Labels */}
                  {issue.labels && issue.labels.length > 0 && (
                    <div className="shrink-0 mr-2">
                      <LabelDisplay labels={issue.labels.map(l => l.label)} maxVisible={2} />
                    </div>
                  )}

                  {/* Date */}
                  <span className="hidden sm:block w-20 text-xs text-zinc-400 text-right shrink-0">
                    {new Date(issue.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>

                  {/* Actions Menu */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <IssueActionMenu
                      issue={issue}
                      onClone={handleClone}
                      onMarkDuplicate={handleMarkDuplicate}
                      onReactivateTo={handleReactivateTo}
                      onDelete={handleDelete}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


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

      {/* Mark Duplicate Modal */}
      {isMarkDuplicateOpen && issueToMarkDuplicate && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-zinc-400" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Mark as Duplicate</span>
              </div>
              <button
                onClick={() => { setIsMarkDuplicateOpen(false); setIssueToMarkDuplicate(null); }}
                className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Issue being marked */}
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">This issue:</p>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{issueToMarkDuplicate.title}</p>
                {issueToMarkDuplicate.short_id && (
                  <p className="text-xs text-zinc-400 mt-1">{issueToMarkDuplicate.short_id}</p>
                )}
              </div>

              {/* Search for canonical issue */}
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Select the original issue this duplicates:</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input
                    type="text"
                    value={duplicateSearchTerm}
                    onChange={(e) => setDuplicateSearchTerm(e.target.value)}
                    placeholder="Search issues..."
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                  />
                </div>
              </div>

              {/* Issue list */}
              <div className="max-h-60 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                {issues
                  .filter(i =>
                    i.id !== issueToMarkDuplicate.id &&
                    i.status !== 'closed' &&
                    (duplicateSearchTerm === '' ||
                      i.title.toLowerCase().includes(duplicateSearchTerm.toLowerCase()) ||
                      i.short_id?.toLowerCase().includes(duplicateSearchTerm.toLowerCase()))
                  )
                  .slice(0, 20)
                  .map(issue => (
                    <button
                      key={issue.id}
                      onClick={() => confirmMarkDuplicate(issue.id)}
                      className="w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700 last:border-b-0 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {issue.short_id && (
                          <span className="text-xs text-zinc-400 font-mono whitespace-nowrap shrink-0">{issue.short_id}</span>
                        )}
                        <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{issue.title}</span>
                      </div>
                    </button>
                  ))}
                {issues.filter(i =>
                  i.id !== issueToMarkDuplicate.id &&
                  i.status !== 'closed' &&
                  (duplicateSearchTerm === '' ||
                    i.title.toLowerCase().includes(duplicateSearchTerm.toLowerCase()) ||
                    i.short_id?.toLowerCase().includes(duplicateSearchTerm.toLowerCase()))
                ).length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-zinc-400">
                    No matching issues found
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => { setIsMarkDuplicateOpen(false); setIssueToMarkDuplicate(null); }}
                className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivate To Modal */}
      {isReactivateOpen && issueToReactivate && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Reactivate To</span>
              </div>
              <button
                onClick={() => { setIsReactivateOpen(false); setIssueToReactivate(null); setReactivateParentOptions([]); }}
                className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Issue being reactivated */}
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Reactivating:</p>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{issueToReactivate.title}</p>
                {issueToReactivate.short_id && (
                  <p className="text-xs text-zinc-400 mt-1">{issueToReactivate.short_id}</p>
                )}
              </div>

              {/* Search for new parent */}
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Select new parent (epic/task) or no parent:</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input
                    type="text"
                    value={reactivateSearchTerm}
                    onChange={(e) => setReactivateSearchTerm(e.target.value)}
                    placeholder="Search epics and tasks..."
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                  />
                </div>
              </div>

              {/* Parent options list */}
              <div className="max-h-60 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                {/* No parent option */}
                <button
                  onClick={() => confirmReactivateTo(null)}
                  className="w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-500 dark:text-zinc-400 italic">No parent (standalone issue)</span>
                  </div>
                </button>
                {/* Epic/task list */}
                {reactivateParentOptions
                  .filter(i =>
                    reactivateSearchTerm === '' ||
                    i.title.toLowerCase().includes(reactivateSearchTerm.toLowerCase()) ||
                    i.short_id?.toLowerCase().includes(reactivateSearchTerm.toLowerCase())
                  )
                  .slice(0, 20)
                  .map(issue => {
                    const config = TYPE_CONFIG[issue.issue_type];
                    return (
                      <button
                        key={issue.id}
                        onClick={() => confirmReactivateTo(issue.id)}
                        className="w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700 last:border-b-0 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 ${config?.color || ''}`}>{config?.icon}</span>
                          {issue.short_id && (
                            <span className="text-xs text-zinc-400 font-mono whitespace-nowrap shrink-0">{issue.short_id}</span>
                          )}
                          <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{issue.title}</span>
                        </div>
                      </button>
                    );
                  })}
                {reactivateParentOptions.filter(i =>
                  reactivateSearchTerm === '' ||
                  i.title.toLowerCase().includes(reactivateSearchTerm.toLowerCase()) ||
                  i.short_id?.toLowerCase().includes(reactivateSearchTerm.toLowerCase())
                ).length === 0 && reactivateSearchTerm !== '' && (
                  <div className="px-3 py-4 text-center text-sm text-zinc-400">
                    No matching issues found
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => { setIsReactivateOpen(false); setIssueToReactivate(null); setReactivateParentOptions([]); }}
                className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
