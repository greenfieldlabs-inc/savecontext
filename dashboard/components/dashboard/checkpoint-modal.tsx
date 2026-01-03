'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Checkpoint, ContextItem } from '@/lib/types';
import { X, Bookmark, Calendar, Package } from 'lucide-react';

interface CheckpointModalProps {
  checkpoint: Checkpoint;
  onClose: () => void;
}

export function CheckpointModal({ checkpoint, onClose }: CheckpointModalProps) {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch checkpoint items
    fetch(`/api/checkpoints/${checkpoint.id}/items`)
      .then(res => res.json())
      .then(data => {
        setItems(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load checkpoint items:', err);
        setLoading(false);
      });
  }, [checkpoint.id]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const categoryConfig = {
    reminder: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', label: 'Reminder' },
    decision: { bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', label: 'Decision' },
    progress: { bg: 'bg-teal-500/10', text: 'text-teal-600 dark:text-teal-400', label: 'Progress' },
    note: { bg: 'bg-zinc-500/10', text: 'text-zinc-600 dark:text-zinc-400', label: 'Note' }
  } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 mx-4 w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-200 p-6 dark:border-zinc-800">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--checkpoint-bg))]">
              <Bookmark className="h-6 w-6 text-[rgb(var(--checkpoint-foreground))]" />
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                {checkpoint.name}
              </h2>
              {checkpoint.description && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {checkpoint.description}
                </p>
              )}
              <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-500">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(checkpoint.created_at).toLocaleString()}
                </div>
                {checkpoint.git_branch && (
                  <div className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    {checkpoint.git_branch}
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-12rem)] overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-400 border-t-transparent dark:border-zinc-500" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No context items in this checkpoint
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Snapshot ({items.length} items)
                </h3>
              </div>
              {items.map((item) => {
                const category = categoryConfig[item.category] || categoryConfig.note;
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${category.bg} ${category.text}`}>
                        {category.label}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-500">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {item.key && (
                      <div className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {item.key}
                      </div>
                    )}
                    <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none text-sm text-zinc-700 dark:text-zinc-300 break-words [&_pre]:overflow-x-auto [&_pre]:bg-zinc-100 [&_pre]:dark:bg-zinc-800 [&_pre]:text-zinc-800 [&_pre]:dark:text-zinc-200 [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {item.value}
                      </ReactMarkdown>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
