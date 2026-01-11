'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FileText, Plus, Search, Trash2, ChevronDown, X } from 'lucide-react';
import type { ProjectSummary, Plan, PlanStatus, PlanStats } from '@/lib/types';
import { useQueryFilters } from '@/lib/hooks/use-query-filters';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { usePlanEvents, useRefreshCounter } from '@/lib/hooks/use-issue-events';
import { useModal } from '@/lib/hooks/use-modal';
import { toast } from 'sonner';
import { PLAN_STATUS_CONFIG, DEFAULT_PLAN_STATUS, PLAN_FILTER_STATUS_OPTIONS } from '@/lib/constants/plan-config';
import {
  PlanStatusDropdown,
  PlanDetailPanel,
  CreatePlanModal,
  type CreatePlanFormData,
} from './components';

interface PlansClientProps {
  projects: ProjectSummary[];
  initialProjectFilter?: string;
  initialStatusFilter: string;
}

interface DeleteModalData {
  planId: string;
  tasks: { id: string; short_id: string; title: string }[];
}

export function PlansClient({ projects, initialProjectFilter, initialStatusFilter }: PlansClientProps) {
  const { updateFilter, clearFilters } = useQueryFilters();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stats, setStats] = useState<PlanStats>({ draft: 0, active: 0, completed: 0, total: 0 });

  // Subscribe to SSE for real-time updates
  usePlanEvents();
  const refreshCounter = useRefreshCounter();
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Modal state
  const addModal = useModal();
  const deleteModal = useModal<DeleteModalData>();

  const [formData, setFormData] = useState<CreatePlanFormData>({
    title: '',
    content: '',
    successCriteria: '',
    projectPath: '',
    status: 'draft',
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


  useEffect(() => {
    loadPlans();
  }, [currentProject, initialStatusFilter, refreshCounter]);

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
        setPlans(data.data.plans);
        setStats(data.data.stats);
      }
    } catch (error) {
      console.error('Failed to load plans:', error);
      toast.error('Failed to load plans');
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
        addModal.close();
        loadPlans();
      }
    } catch (error) {
      console.error('Failed to create plan:', error);
      toast.error('Failed to create plan');
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
      toast.error('Failed to read file');
    }

    // Reset file input
    event.target.value = '';
  };

  const handleUpdatePlan = useCallback(async (planId: string, updates: Partial<Plan>) => {
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
      toast.error('Failed to update plan');
      loadPlans();
    }
  }, []);

  const handleDelete = async (planId: string) => {
    // Fetch tasks that will be deleted
    let tasks: DeleteModalData['tasks'] = [];
    try {
      const response = await fetch(`/api/plans/delete?id=${planId}`);
      const data = await response.json();
      tasks = data.tasks || [];
    } catch {
      // Use empty array on error
    }
    deleteModal.open({ planId, tasks });
  };

  const confirmDelete = async () => {
    const planId = deleteModal.data?.planId;
    if (!planId) return;

    try {
      const response = await fetch('/api/plans/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: planId }),
      });

      if (response.ok) {
        deleteModal.close();
        if (expandedPlanId === planId) setExpandedPlanId(null);
        loadPlans();
      }
    } catch (error) {
      console.error('Failed to delete plan:', error);
      toast.error('Failed to delete plan');
    }
  };

  const getDeleteMessage = () => {
    const tasks = deleteModal.data?.tasks || [];
    if (tasks.length === 0) {
      return 'Are you sure you want to delete this plan? This action cannot be undone.';
    }
    return `Are you sure you want to delete this plan? The following ${tasks.length} task${tasks.length !== 1 ? 's' : ''} will also be deleted:\n\n${tasks.map(t => `• ${t.short_id || t.id.slice(0, 8)}: ${t.title}`).join('\n')}\n\nThis action cannot be undone.`;
  };

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      successCriteria: '',
      projectPath: currentProject || (projects[0]?.project_path || ''),
      status: 'draft',
    });
  };

  const filteredPlans = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    return plans.filter(plan =>
      plan.title.toLowerCase().includes(searchLower) ||
      plan.content.toLowerCase().includes(searchLower)
    );
  }, [plans, searchTerm]);

  const selectedProject = useMemo(
    () => projects.find(p => p.project_path === currentProject),
    [projects, currentProject]
  );
  const projectName = selectedProject?.project_path?.split('/').pop() || null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Plans
          </h1>
          <p className="mt-1 sm:mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            PRDs and specifications for your projects
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            addModal.open();
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[rgb(var(--sidebar-primary))] px-4 py-2.5 text-sm font-medium text-[rgb(var(--sidebar-primary-foreground))] shadow-sm transition-all hover:opacity-90 w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          New Plan
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
                  onClick={() => { updateFilter('project', null); setIsProjectDropdownOpen(false); }}
                  className={`w-full px-3 py-1.5 text-left text-sm ${!initialProjectFilter ? 'bg-zinc-100 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}
                >
                  All Projects
                </button>
                {projects.filter(p => p.project_path).map((project) => (
                  <button
                    key={project.project_path}
                    onClick={() => { updateFilter('project', project.project_path); setIsProjectDropdownOpen(false); }}
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
          {PLAN_FILTER_STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => updateFilter('status', option.value)}
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
            onClick={() => { setSearchTerm(''); clearFilters(['project', 'status']); }}
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
              const statusConfig = PLAN_STATUS_CONFIG[plan.status] || DEFAULT_PLAN_STATUS;
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
                    <PlanStatusDropdown
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
      <CreatePlanModal
        isOpen={addModal.isOpen}
        formData={formData}
        projects={projects}
        onFormChange={(updates) => setFormData(prev => ({ ...prev, ...updates }))}
        onCreate={handleCreate}
        onClose={() => { addModal.close(); resetForm(); }}
        onFileImport={handleFileImport}
      />

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={deleteModal.isOpen}
        onClose={deleteModal.close}
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
