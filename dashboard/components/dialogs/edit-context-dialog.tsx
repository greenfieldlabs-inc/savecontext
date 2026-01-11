'use client';

import { useState } from 'react';
import type { ContextItem, ContextCategory, ContextPriority } from '@/lib/types';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface EditContextDialogProps {
  item: ContextItem;
  onSave: (item: ContextItem, updates: Partial<ContextItem>) => Promise<void>;
  onCancel: () => void;
}

export function EditContextDialog({ item, onSave, onCancel }: EditContextDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    value: item.value,
    category: item.category,
    priority: item.priority,
    channel: item.channel || '',
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(item, formData);
      // Parent handles closing dialog on success
    } catch (error) {
      console.error('Failed to save context item:', error);
      toast.error('Failed to save context item');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden bg-white dark:bg-zinc-900">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
              <Save className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Edit Context Item
              </DialogTitle>
              <DialogDescription className="text-sm text-zinc-600 dark:text-zinc-400">
                {item.key || 'Modify context item properties'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Form */}
        <div className="max-h-[calc(90vh-16rem)] overflow-y-auto">
          <div className="space-y-4">
            {/* Value */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Value
              </label>
              <textarea
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                rows={8}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                placeholder="Enter context value..."
              />
            </div>

            {/* Category */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Category
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value as ContextCategory })}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              >
                <option value="task">Task</option>
                <option value="decision">Decision</option>
                <option value="progress">Progress</option>
                <option value="note">Note</option>
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Priority
              </label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as ContextPriority })}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>

            {/* Channel */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Channel
              </label>
              <input
                type="text"
                value={formData.channel}
                onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                placeholder="Enter channel name..."
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-700"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
