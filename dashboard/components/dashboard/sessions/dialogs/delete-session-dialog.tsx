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

interface SessionStats {
  contextItems: number;
  checkpoints: number;
  tasks: number;
  memory: number;
}

interface DeleteSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  sessionName: string;
  onSuccess?: () => void;
}

export function DeleteSessionDialog({
  open,
  onOpenChange,
  sessionId,
  sessionName,
  onSuccess,
}: DeleteSessionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const canDelete = confirmText === sessionName;

  useEffect(() => {
    if (open) {
      setError(null);
      setConfirmText('');
      fetchStats();
    } else {
      setStats(null);
      setConfirmText('');
    }
  }, [open, sessionId]);

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // Silently fail - we'll just not show stats
    } finally {
      setLoadingStats(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete session');
      }

      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white dark:bg-zinc-900">
        <DialogHeader>
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950/50">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Delete Session
              </DialogTitle>
              <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
                This action cannot be undone
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Are you sure you want to delete{' '}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {sessionName}
            </span>
            ?
          </p>

          {loadingStats ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading session data...
            </div>
          ) : stats && (stats.contextItems > 0 || stats.checkpoints > 0 || stats.tasks > 0 || stats.memory > 0) ? (
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-950/30">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                The following will be permanently deleted:
              </p>
              <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                {stats.contextItems > 0 && (
                  <li>• {stats.contextItems} context {stats.contextItems === 1 ? 'item' : 'items'}</li>
                )}
                {stats.checkpoints > 0 && (
                  <li>• {stats.checkpoints} {stats.checkpoints === 1 ? 'checkpoint' : 'checkpoints'}</li>
                )}
                {stats.tasks > 0 && (
                  <li>• {stats.tasks} {stats.tasks === 1 ? 'task' : 'tasks'}</li>
                )}
                {stats.memory > 0 && (
                  <li>• {stats.memory} memory {stats.memory === 1 ? 'item' : 'items'}</li>
                )}
              </ul>
            </div>
          ) : null}

          <div>
            <label className="block text-sm text-zinc-600 dark:text-zinc-400 mb-2">
              Type <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{sessionName}</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Enter session name"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              autoComplete="off"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
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
            onClick={handleDelete}
            disabled={loading || !canDelete}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              canDelete && !loading
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-zinc-400 dark:bg-zinc-600 cursor-not-allowed'
            }`}
          >
            {loading ? 'Deleting...' : 'Delete Session'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
