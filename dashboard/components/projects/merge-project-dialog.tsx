'use client';

import { useState, useEffect } from 'react';
import { GitMerge, Loader2, AlertTriangle, Check } from 'lucide-react';
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
  project_path: string;
  session_count: number;
}

interface MergeProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  sessionCount: number;
  onSuccess: () => void;
}

export function MergeProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  sessionCount,
  onSuccess,
}: MergeProjectDialogProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');

  useEffect(() => {
    if (open) {
      setError(null);
      setSelectedTargetId('');
      fetchProjects();
    }
  }, [open, projectId]);

  const fetchProjects = async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        // Filter out the current project
        const otherProjects = (data.projects || []).filter(
          (p: Project) => p.id !== projectId
        );
        setProjects(otherProjects);
      }
    } catch {
      setError('Failed to load projects');
    } finally {
      setLoadingProjects(false);
    }
  };

  const selectedTarget = projects.find(p => p.id === selectedTargetId);

  const handleMerge = async () => {
    if (!selectedTargetId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectId: selectedTargetId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to merge projects');
      }

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge projects');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden bg-white dark:bg-zinc-900">
        <DialogHeader>
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <GitMerge className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Merge Project
              </DialogTitle>
              <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
                Move sessions to another project
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(90vh-14rem)] overflow-y-auto">
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            Merge <span className="font-medium text-zinc-900 dark:text-zinc-100">{projectName}</span> into:
          </p>

          {loadingProjects ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-950/30">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                No other projects available to merge into.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setSelectedTargetId(project.id)}
                  className={`flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors ${
                    selectedTargetId === project.id
                      ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800'
                      : 'border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {project.name}
                    </div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                      {project.session_count} sessions
                      {project.project_path && ` · ${project.project_path}`}
                    </div>
                  </div>
                  {selectedTargetId === project.id && (
                    <div className="ml-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100">
                      <Check className="h-4 w-4 text-white dark:text-zinc-900" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Warning Box */}
          {selectedTarget && (
            <div className="mt-4 rounded-lg bg-amber-50 p-4 dark:bg-amber-950/30">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'} will be moved
                  </p>
                  <p className="mt-1 text-amber-700 dark:text-amber-300">
                    "{projectName}" will be deleted after merge
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={loading || !selectedTargetId}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              selectedTargetId && !loading
                ? 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                : 'bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 cursor-not-allowed'
            }`}
          >
            {loading ? 'Merging...' : 'Merge Projects'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
