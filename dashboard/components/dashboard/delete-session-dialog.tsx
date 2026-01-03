'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Loader2 } from 'lucide-react';

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

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [open]);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      <div
        className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-zinc-200 p-6 dark:border-zinc-800">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950/50">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Delete Session
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                This action cannot be undone
              </p>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Are you sure you want to delete{' '}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {sessionName}
            </span>
            ?
          </p>

          {loadingStats ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading session data...
            </div>
          ) : stats && (stats.contextItems > 0 || stats.checkpoints > 0 || stats.tasks > 0 || stats.memory > 0) ? (
            <div className="mt-4 rounded-lg bg-amber-50 p-4 dark:bg-amber-950/30">
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

          <div className="mt-4">
            <label className="block text-sm text-zinc-600 dark:text-zinc-400 mb-2">
              Type <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{sessionName}</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Enter session name"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              autoComplete="off"
              autoFocus
            />
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="mt-6 flex justify-end gap-3">
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
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
