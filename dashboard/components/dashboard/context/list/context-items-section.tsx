'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContextItem } from '@/lib/types';
import { ContextItemCard } from '../shared/context-item-card';
import { DeleteContextDialog } from '@/components/dialogs/delete-context-dialog';
import { EditContextDialog } from '@/components/dialogs/edit-context-dialog';
import { AlertCircle } from 'lucide-react';

interface ContextItemsSectionProps {
  items: ContextItem[];
  sessionId: string;
}

export function ContextItemsSection({ items, sessionId }: ContextItemsSectionProps) {
  const router = useRouter();
  const [deleteItem, setDeleteItem] = useState<ContextItem | null>(null);
  const [editItem, setEditItem] = useState<ContextItem | null>(null);

  const handleDelete = async (item: ContextItem) => {
    try {
      const response = await fetch('/api/context/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: item.key, sessionId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete');
      }

      setDeleteItem(null);
      router.refresh();
    } catch (error) {
      console.error('Delete error:', error);
      throw error; // Re-throw to let dialog handle the error state
    }
  };

  const handleEdit = async (item: ContextItem, updates: Partial<ContextItem>) => {
    try {
      const response = await fetch('/api/context/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: item.key,
          sessionId,
          ...updates,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update');
      }

      setEditItem(null);
      router.refresh();
    } catch (error) {
      console.error('Update error:', error);
      throw error; // Re-throw to let dialog handle the error state
    }
  };

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-12 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
        <AlertCircle className="mx-auto h-12 w-12 text-zinc-400 dark:text-zinc-600" />
        <h3 className="mt-4 font-semibold text-zinc-900 dark:text-zinc-50">No context items yet</h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Context items will appear here as you work with SaveContext
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {items.map((item) => (
          <ContextItemCard
            key={item.id}
            item={item}
            onDelete={setDeleteItem}
            onEdit={setEditItem}
          />
        ))}
      </div>

      {/* Delete Dialog */}
      {deleteItem && (
        <DeleteContextDialog
          item={deleteItem}
          onConfirm={handleDelete}
          onCancel={() => setDeleteItem(null)}
        />
      )}

      {/* Edit Dialog */}
      {editItem && (
        <EditContextDialog
          item={editItem}
          onSave={handleEdit}
          onCancel={() => setEditItem(null)}
        />
      )}
    </>
  );
}
