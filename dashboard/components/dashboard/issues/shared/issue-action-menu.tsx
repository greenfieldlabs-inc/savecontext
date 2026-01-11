'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Copy, Link2, Trash2, PlayCircle, GitMerge } from 'lucide-react';
import { useClickOutside } from '@/lib/hooks/use-click-outside';
import type { IssueActionMenuProps } from '@/lib/types';

export function IssueActionMenu({
  issue,
  onClone,
  onMarkDuplicate,
  onReactivateTo,
  onDelete,
  showMarkDuplicate = true,
  showCopyActions = false,
  size = 'md',
}: IssueActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [copied, setCopied] = useState<'link' | 'id' | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle click outside
  useClickOutside([menuRef, triggerRef], () => setIsOpen(false), isOpen);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Update position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.right - 192,
      });
    }
  }, [isOpen]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied('link');
    setTimeout(() => setCopied(null), 1500);
  };

  const copyId = async () => {
    await navigator.clipboard.writeText(issue.short_id || issue.id);
    setCopied('id');
    setTimeout(() => setCopied(null), 1500);
  };

  const canMarkDuplicate = showMarkDuplicate && issue.status !== 'closed' && issue.issue_type !== 'epic' && onMarkDuplicate;
  const canReactivate = issue.status === 'deferred' && onReactivateTo;
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const buttonPadding = size === 'sm' ? 'p-1' : 'p-1.5';

  const menuItemClass = 'w-full px-3 py-1.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2.5 rounded-sm mx-auto transition-colors';

  const menu = !isOpen ? null : (
    <div
      ref={menuRef}
      className="fixed z-50 w-48 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1.5"
      style={{ top: position.top, left: position.left }}
    >
      {/* Copy actions */}
      {showCopyActions && (
        <>
          <button onClick={copyLink} className={menuItemClass}>
            <Link2 className={`${iconSize} text-zinc-400`} />
            {copied === 'link' ? 'Copied!' : 'Copy link'}
          </button>
          <button onClick={copyId} className={menuItemClass}>
            <Copy className={`${iconSize} text-zinc-400`} />
            {copied === 'id' ? 'Copied!' : 'Copy ID'}
          </button>
          <div className="border-t border-zinc-200 dark:border-zinc-700 my-1.5" />
        </>
      )}

      {/* Clone */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(false);
          onClone(issue);
        }}
        className={menuItemClass}
      >
        <Copy className={iconSize} />
        Make a copy...
      </button>

      {/* Mark as duplicate */}
      {canMarkDuplicate && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(false);
            onMarkDuplicate(issue);
          }}
          className={menuItemClass}
        >
          <GitMerge className={iconSize} />
          Mark as duplicate
        </button>
      )}

      {/* Reactivate */}
      {canReactivate && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(false);
            onReactivateTo(issue);
          }}
          className={menuItemClass}
        >
          <PlayCircle className={iconSize} />
          Reactivate to...
        </button>
      )}

      {/* Delete */}
      {onDelete && (
        <>
          <div className="border-t border-zinc-200 dark:border-zinc-700 my-1.5" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              onDelete(issue.id);
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 flex items-center gap-2.5 rounded-sm mx-auto transition-colors"
          >
            <Trash2 className={iconSize} />
            Delete
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="relative ml-2">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`${buttonPadding} rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-700`}
      >
        <MoreHorizontal className={iconSize} />
      </button>
      {mounted && createPortal(menu, document.body)}
    </div>
  );
}
