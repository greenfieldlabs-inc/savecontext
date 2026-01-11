'use client';

import { useState } from 'react';
import type { ContextItem } from '@/lib/types';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DeleteContextDialogProps {
  item: ContextItem;
  onConfirm: (item: ContextItem) => Promise<void>;
  onCancel: () => void;
}

export function DeleteContextDialog({ item, onConfirm, onCancel }: DeleteContextDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onConfirm(item);
    } catch (error) {
      console.error('Failed to delete context item:', error);
      toast.error('Failed to delete context item');
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md bg-white dark:bg-zinc-900">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Delete Context Item
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                This action cannot be undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="mb-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          {item.key && (
            <div className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {item.key}
            </div>
          )}
          <div className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
            {item.value}
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-700"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
