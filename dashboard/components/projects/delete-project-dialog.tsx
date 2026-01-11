'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  sessionCount: number;
  onDelete: () => void;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  sessionCount,
  onDelete,
}: DeleteProjectDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfirmValid = confirmText === 'DELETE';

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setError(null);
    }
  }, [open]);

  const handleDelete = async () => {
    if (!isConfirmValid) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete project');
      }

      onDelete();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md bg-white dark:bg-zinc-900">
        <DialogHeader>
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950/50">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Delete Project
              </DialogTitle>
              <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
                This action cannot be undone
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You are about to permanently delete{' '}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{projectName}</span>
          </p>

          <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
            <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
              This will permanently delete:
            </p>
            <ul className="list-inside list-disc space-y-1 text-sm text-red-700 dark:text-red-300">
              <li>{sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}</li>
              <li>All context items in those sessions</li>
              <li>All checkpoints for those sessions</li>
              <li>All tasks for this project</li>
              <li>All memory items for this project</li>
            </ul>
          </div>

          <div>
            <label
              htmlFor="confirm-delete"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
            >
              Type <span className="font-mono font-bold">DELETE</span> to confirm:
            </label>
            <input
              id="confirm-delete"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={loading}
              placeholder="DELETE"
              autoComplete="off"
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!isConfirmValid || loading}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              isConfirmValid && !loading
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 cursor-not-allowed'
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </span>
            ) : (
              'Delete Project'
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
