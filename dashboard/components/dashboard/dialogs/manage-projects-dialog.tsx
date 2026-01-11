'use client';

import { useState, useEffect } from 'react';
import { GitBranch, Plus, Star, Trash2, Loader2 } from 'lucide-react';
import type { SessionProjectInfo } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Project {
  id: string;
  name: string;
  sourcePath: string | null;
}

interface ManageProjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  sessionName: string;
  onSuccess?: () => void;
}

export function ManageProjectsDialog({
  open,
  onOpenChange,
  sessionId,
  sessionName,
  onSuccess,
}: ManageProjectsDialogProps) {
  const [sessionProjects, setSessionProjects] = useState<SessionProjectInfo[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      loadData();
    }
  }, [open, sessionId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sessionRes, projectsRes] = await Promise.all([
        fetch(`/api/sessions/${sessionId}/projects`),
        fetch('/api/projects'),
      ]);

      const sessionData = await sessionRes.json();
      const projectsData = await projectsRes.json();

      if (sessionRes.ok && sessionData.projects) {
        setSessionProjects(sessionData.projects);
      }

      if (projectsRes.ok && projectsData.projects) {
        setAllProjects(projectsData.projects);
      }
    } catch (err) {
      setError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const availableProjects = allProjects.filter(
    (p) => !sessionProjects.some((sp) => sp.id === p.id)
  );

  const handleAddProject = async (projectId: string) => {
    setActionLoading(projectId);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add project');
      }

      await loadData();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add project');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveProject = async (projectId: string) => {
    setActionLoading(projectId);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/projects`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove project');
      }

      await loadData();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove project');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetPrimary = async (projectId: string) => {
    setActionLoading(projectId);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/projects`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to set primary project');
      }

      await loadData();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set primary project');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden bg-white dark:bg-zinc-900">
        <DialogHeader>
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <GitBranch className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Connections
              </DialogTitle>
              <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
                {sessionName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(90vh-14rem)] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Current Projects */}
              <div>
                <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Associated Projects ({sessionProjects.length})
                </h3>
                {sessionProjects.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No projects associated with this session
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sessionProjects.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {project.name}
                            </span>
                            {project.isPrimary && (
                              <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                                <Star className="h-3 w-3" />
                                Primary
                              </span>
                            )}
                          </div>
                          {project.sourcePath && (
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {project.sourcePath}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {!project.isPrimary && (
                            <button
                              onClick={() => handleSetPrimary(project.id)}
                              disabled={actionLoading === project.id}
                              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-amber-600 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-amber-400"
                              title="Set as primary"
                            >
                              {actionLoading === project.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Star className="h-4 w-4" />
                              )}
                            </button>
                          )}
                          {sessionProjects.length > 1 && (
                            <button
                              onClick={() => handleRemoveProject(project.id)}
                              disabled={actionLoading === project.id}
                              className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                              title="Remove from session"
                            >
                              {actionLoading === project.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Project */}
              {availableProjects.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Add Project
                  </h3>
                  <div className="space-y-2">
                    {availableProjects.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {project.name}
                          </span>
                          {project.sourcePath && (
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {project.sourcePath}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleAddProject(project.id)}
                          disabled={actionLoading === project.id}
                          className="flex items-center gap-1 rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          {actionLoading === project.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
