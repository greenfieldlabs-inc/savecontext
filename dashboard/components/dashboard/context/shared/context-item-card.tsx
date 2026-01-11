'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ContextItem } from '@/lib/types';
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import { getCategoryConfig, getPriorityConfig } from '@/lib/constants/context-config';

interface ContextItemCardProps {
  item: ContextItem;
  onDelete?: (item: ContextItem) => void;
  onEdit?: (item: ContextItem) => void;
}

const TRUNCATE_LENGTH = 200;

export function ContextItemCard({ item, onDelete, onEdit }: ContextItemCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const category = getCategoryConfig(item.category);
  const priority = getPriorityConfig(item.priority);
  const needsTruncation = item.value.length > TRUNCATE_LENGTH;
  const displayValue = !needsTruncation || isExpanded
    ? item.value
    : item.value.slice(0, TRUNCATE_LENGTH) + '...';

  return (
    <div className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header: Badges + Timestamp + Actions */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${category.bg} ${category.text}`}>
          {category.label}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${priority.bg} ${priority.text}`}>
          {priority.label}
        </span>
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-500">
          {new Date(item.created_at).toLocaleString()}
        </span>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onEdit && (
            <button
              onClick={() => onEdit(item)}
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              title="Edit context item"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(item)}
              className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              title="Delete context item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Key (if present) */}
      {item.key && (
        <div className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {item.key}
        </div>
      )}

      {/* Value */}
      <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none text-sm text-zinc-700 dark:text-zinc-300 break-words [&_pre]:overflow-x-auto [&_pre]:bg-zinc-100 [&_pre]:dark:bg-zinc-800 [&_pre]:text-zinc-800 [&_pre]:dark:text-zinc-200 [&_pre]:p-3 [&_pre]:rounded-lg [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_table]:w-full [&_th]:bg-zinc-100 [&_th]:dark:bg-zinc-800 [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_td]:border-t [&_td]:border-zinc-200 [&_td]:dark:border-zinc-700">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {displayValue}
        </ReactMarkdown>
      </div>

      {/* Expand/Collapse Button */}
      {needsTruncation && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Show more
            </>
          )}
        </button>
      )}

      {/* Updated At (if different from created) */}
      {item.updated_at !== item.created_at && (
        <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
          Updated: {new Date(item.updated_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}
