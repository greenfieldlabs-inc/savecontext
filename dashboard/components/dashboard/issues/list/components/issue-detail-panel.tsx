'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, CheckCircle2,
  ChevronDown, ChevronRight, X,
  Clock, Hexagon,
  FileText, Brain, FolderKanban, Terminal, Settings, Lightbulb,
  Link2
} from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ProjectSummary, Issue, Plan, Memory, InlineIssueFormData } from '@/lib/types';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IssueProgress } from '@/components/ui/issue-progress';
import { IssueActionMenu } from '@/components/dashboard/issues/shared/issue-action-menu';
import { InlineIssueForm } from '@/components/dashboard/issues/forms/inline-issue-form';
import { LabelSelect } from '@/components/dashboard/shared/label-select';
import { ProjectDropdown, AddProjectDropdown } from '@/components/dashboard/shared/project-dropdown';
import { toast } from 'sonner';
import { useRefreshCounter } from '@/lib/hooks/use-issue-events';
import { StatusDropdown } from './status-dropdown';
import { PriorityDropdown } from './priority-dropdown';

interface IssueDetailPanelProps {
  issue: Issue;
  typeConfig: { label: string; icon: React.ReactNode; color: string };
  onClose: () => void;
  onUpdate: (updates: Partial<Issue> & { add_project_path?: string; remove_project_path?: string }) => void;
  onSubtaskCreated: () => void;
  onClone: (issue: Issue) => void;
  onMarkDuplicate: (issue: Issue) => void;
  projects: ProjectSummary[];
}

export function IssueDetailPanel({
  issue,
  typeConfig,
  onClose,
  onUpdate,
  onSubtaskCreated,
  onClone,
  onMarkDuplicate,
  projects,
}: IssueDetailPanelProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [titleValue, setTitleValue] = useState(issue.title);
  const [descriptionValue, setDescriptionValue] = useState(issue.description || '');
  const [detailsValue, setDetailsValue] = useState(issue.details || '');

  // Subtask state
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [subtasks, setSubtasks] = useState<Issue[]>([]);
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);
  const [creatingSubtask, setCreatingSubtask] = useState(false);
  const [expandedSubtaskId, setExpandedSubtaskId] = useState<string | null>(null);
  const [editingSubtaskField, setEditingSubtaskField] = useState<{ id: string; field: 'title' | 'description' | 'details' } | null>(null);
  const [subtaskEditValue, setSubtaskEditValue] = useState('');
  const [subtaskToDelete, setSubtaskToDelete] = useState<string | null>(null);
  const [isConfirmDeleteSubtaskOpen, setIsConfirmDeleteSubtaskOpen] = useState(false);

  // Nested subtask state (for 3-level hierarchy)
  const [subSubtasks, setSubSubtasks] = useState<Record<string, Issue[]>>({});
  const [loadingSubSubtasks, setLoadingSubSubtasks] = useState<Record<string, boolean>>({});
  const [addingChildTo, setAddingChildTo] = useState<string | null>(null);
  const [creatingChild, setCreatingChild] = useState(false);
  const [childToDelete, setChildToDelete] = useState<{ id: string; parentId: string } | null>(null);
  const [isConfirmDeleteChildOpen, setIsConfirmDeleteChildOpen] = useState(false);

  // Context Chain state (Plan)
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);

  // Memory state
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [showMemories, setShowMemories] = useState(false);

  // Details collapsed state (collapsed by default for epics)
  const [showDetails, setShowDetails] = useState(false);

  // SSE refresh counter for real-time updates
  const refreshCounter = useRefreshCounter();

  // Sync with issue changes
  useEffect(() => {
    setTitleValue(issue.title);
    setDescriptionValue(issue.description || '');
    setDetailsValue(issue.details || '');
  }, [issue.title, issue.description, issue.details]);

  // Update subtask (optimistic)
  const handleUpdateSubtask = useCallback(async (subtaskId: string, updates: Partial<Issue>) => {
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
      toast.error('Failed to update subtask');
    }
  }, [issue.id]);

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

  // Trigger subtask delete confirmation
  const handleSubtaskDeleteClick = useCallback((issueId: string) => {
    setSubtaskToDelete(issueId);
    setIsConfirmDeleteSubtaskOpen(true);
  }, []);

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
      toast.error('Failed to delete subtask');
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
      toast.error('Failed to delete child issue');
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
        toast.error('Failed to load subtasks');
      } finally {
        setLoadingSubtasks(false);
      }
    }
    loadSubtasks();
  }, [issue.id, refreshCounter]);

  // Clear sub-subtasks cache when SSE refresh occurs
  useEffect(() => {
    // Clear cache so sub-subtasks will refetch when expanded
    setSubSubtasks({});
  }, [refreshCounter]);

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
        toast.error('Failed to load child issues');
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
        toast.error('Failed to load plan');
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
        toast.error('Failed to load project memory');
      } finally {
        setLoadingMemories(false);
      }
    }
    loadMemory();
  }, [showMemories, issue.project_path]);

  const handleCreateSubtask = useCallback(async (formData: InlineIssueFormData) => {
    setCreatingSubtask(true);
    try {
      const res = await fetch('/api/issues/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: issue.project_path,
          title: formData.title,
          parentId: issue.id,
          status: formData.status,
          priority: formData.priority,
          issueType: formData.issueType,
          dependsOn: formData.dependsOn,
        }),
      });
      if (res.ok) {
        setShowSubtaskForm(false);
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
      toast.error('Failed to create subtask');
    } finally {
      setCreatingSubtask(false);
    }
  }, [issue.project_path, issue.id, onSubtaskCreated]);

  // Create a child issue under an expanded subtask (3rd level)
  const handleCreateChildIssue = useCallback(async (parentSubtaskId: string, formData: InlineIssueFormData) => {
    setCreatingChild(true);
    try {
      const res = await fetch('/api/issues/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: issue.project_path,
          title: formData.title,
          parentId: parentSubtaskId,
          status: formData.status,
          priority: formData.priority,
          issueType: formData.issueType,
          dependsOn: formData.dependsOn,
        }),
      });
      if (res.ok) {
        setAddingChildTo(null);
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
      toast.error('Failed to create child issue');
    } finally {
      setCreatingChild(false);
    }
  }, [issue.project_path, onSubtaskCreated]);

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

      {/* Duplicate Banner - shows when issue is marked as duplicate */}
      {issue.dependencies?.find(d => d.dependencyType === 'duplicate-of') && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <Link2 className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Duplicate of{' '}
            <Link
              href={`/dashboard/issues/${issue.dependencies.find(d => d.dependencyType === 'duplicate-of')?.dependsOnId}`}
              className="font-mono font-medium text-zinc-700 dark:text-zinc-300 hover:underline"
            >
              {issue.dependencies.find(d => d.dependencyType === 'duplicate-of')?.dependsOnShortId ||
               issue.dependencies.find(d => d.dependencyType === 'duplicate-of')?.dependsOnId.slice(0, 8)}
            </Link>
            {' - '}
            {issue.dependencies.find(d => d.dependencyType === 'duplicate-of')?.dependsOnTitle}
          </span>
        </div>
      )}

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
                    <div className="opacity-0 group-hover/subtask:opacity-100 transition-opacity">
                      <IssueActionMenu
                        issue={subtask}
                        onClone={onClone}
                        onMarkDuplicate={onMarkDuplicate}
                        onDelete={handleSubtaskDeleteClick}
                        size="sm"
                      />
                    </div>
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
                          <div className="mt-2">
                            <InlineIssueForm
                              onSubmit={(formData) => handleCreateChildIssue(subtask.id, formData)}
                              onCancel={() => setAddingChildTo(null)}
                              isSubmitting={creatingChild}
                              siblingIssues={subSubtasks[subtask.id] || []}
                              placeholder="Issue title"
                            />
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
          <InlineIssueForm
            onSubmit={handleCreateSubtask}
            onCancel={() => setShowSubtaskForm(false)}
            isSubmitting={creatingSubtask}
            siblingIssues={subtasks}
            placeholder="Issue title"
          />
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
      <div>
        <span className="text-xs text-zinc-400 mb-2 block">Labels</span>
        <LabelSelect
          issueId={issue.id}
          initialLabels={issue.labels?.map(l => l.label) || []}
          projectPath={issue.project_path}
        />
      </div>

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
