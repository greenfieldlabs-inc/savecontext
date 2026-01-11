'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Loader2, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLabelColor } from '@/lib/constants/labels';
import { useClickOutside } from '@/lib/hooks/use-click-outside';
import type { LabelInfo, LabelSelectProps, LabelDisplayProps } from '@/lib/types';
import { toast } from 'sonner';

export function LabelSelect({
  issueId,
  initialLabels,
  onLabelsChange,
  projectPath,
  disabled = false,
  className,
  compact = false,
}: LabelSelectProps) {
  const [labels, setLabels] = useState<string[]>(initialLabels);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<LabelInfo[]>([]);
  const [allLabels, setAllLabels] = useState<LabelInfo[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLabels = async () => {
      try {
        const params = new URLSearchParams();
        if (projectPath) params.set('projectPath', projectPath);
        const res = await fetch(`/api/labels/list?${params}`);
        if (res.ok) {
          const data = await res.json();
          setAllLabels(data.labels || []);
        }
      } catch (err) {
        console.error('Failed to fetch labels:', err);
        toast.error('Failed to load labels');
      }
    };
    fetchLabels();
  }, [projectPath]);

  useEffect(() => {
    if (!inputValue.trim()) {
      const unused = allLabels.filter(l => !labels.includes(l.label));
      setSuggestions(unused.slice(0, 8));
    } else {
      const search = inputValue.toLowerCase();
      const filtered = allLabels
        .filter(l => l.label.toLowerCase().includes(search) && !labels.includes(l.label))
        .slice(0, 8);
      setSuggestions(filtered);
    }
    setHighlightedIndex(-1);
  }, [inputValue, allLabels, labels]);

  useClickOutside(containerRef, () => {
    setShowDropdown(false);
    setInputValue('');
  });

  const saveLabels = useCallback(async (newLabels: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/issues/labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, labels: newLabels }),
      });
      if (!res.ok) {
        console.error('Failed to save labels');
        toast.error('Failed to save labels');
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to save labels:', err);
      toast.error('Failed to save labels');
      return false;
    } finally {
      setSaving(false);
    }
  }, [issueId]);

  const addLabel = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || labels.includes(trimmed)) return;

    const newLabels = [...labels, trimmed];
    setLabels(newLabels);
    setInputValue('');
    onLabelsChange?.(newLabels);

    await saveLabels(newLabels);
  };

  const removeLabel = async (label: string) => {
    const newLabels = labels.filter(l => l !== label);
    setLabels(newLabels);
    onLabelsChange?.(newLabels);

    await saveLabels(newLabels);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        addLabel(suggestions[highlightedIndex].label);
      } else if (inputValue.trim()) {
        addLabel(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && labels.length > 0) {
      removeLabel(labels[labels.length - 1]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev =>
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setInputValue('');
      setHighlightedIndex(-1);
    }
  };

  const handleAddClick = () => {
    setShowDropdown(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (compact) {
    return (
      <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
        {labels.map(label => {
          const color = getLabelColor(label);
          return (
            <span
              key={label}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                color.bg, color.text
              )}
            >
              {label}
              {!disabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLabel(label);
                  }}
                  className="hover:opacity-70 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        })}
        {labels.length === 0 && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">No labels</span>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Label pills + Add button (Linear style) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map(label => {
          const color = getLabelColor(label);
          return (
            <span
              key={label}
              className={cn(
                'inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full text-xs font-medium',
                color.bg, color.text
              )}
            >
              <span className="w-2 h-2 rounded-full bg-current opacity-80" />
              {label}
              {!disabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLabel(label);
                  }}
                  className="hover:opacity-70 transition-opacity ml-0.5"
                  disabled={saving}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        })}

        {/* Add button */}
        {!disabled && (
          <button
            onClick={handleAddClick}
            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && !disabled && (
        <div className="absolute z-50 left-0 top-full mt-2 w-64 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add labels..."
              className="w-full px-2 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md outline-none focus:ring-2 focus:ring-zinc-500 placeholder:text-zinc-400"
            />
          </div>

          {/* Suggestions list */}
          <div className="max-h-[200px] overflow-y-auto">
            {suggestions.length > 0 ? (
              suggestions.map((suggestion, index) => {
                const color = getLabelColor(suggestion.label);
                return (
                  <button
                    key={suggestion.label}
                    onClick={() => addLabel(suggestion.label)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                      index === highlightedIndex && 'bg-zinc-50 dark:bg-zinc-800'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Tag className="h-3.5 w-3.5 text-zinc-400" />
                      <span className="text-zinc-700 dark:text-zinc-300">{suggestion.label}</span>
                    </span>
                    <span className="text-xs text-zinc-400">
                      {suggestion.count} issue{suggestion.count !== 1 ? 's' : ''}
                    </span>
                  </button>
                );
              })
            ) : inputValue.trim() ? (
              // Check if the typed label already exists on this issue
              labels.some(l => l.toLowerCase() === inputValue.trim().toLowerCase()) ? (
                <div className="px-3 py-3 text-sm text-zinc-400 text-center">
                  Label already added
                </div>
              ) : (
                <button
                  onClick={() => addLabel(inputValue)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                    highlightedIndex === 0 && 'bg-zinc-50 dark:bg-zinc-800'
                  )}
                >
                  <Plus className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-zinc-700 dark:text-zinc-300">Create &quot;{inputValue.trim()}&quot;</span>
                </button>
              )
            ) : (
              <div className="px-3 py-3 text-sm text-zinc-400 text-center">
                Type to search or create a label
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function LabelDisplay({ labels, maxVisible = 3, className }: LabelDisplayProps) {
  if (!labels || labels.length === 0) return null;

  const visible = labels.slice(0, maxVisible);
  const hidden = labels.length - maxVisible;

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {visible.map(label => {
        const color = getLabelColor(label);
        return (
          <span
            key={label}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium',
              color.bg, color.text
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {label}
          </span>
        );
      })}
      {hidden > 0 && (
        <span className="text-xs text-zinc-400">
          +{hidden}
        </span>
      )}
    </div>
  );
}
