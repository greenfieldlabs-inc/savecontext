'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Pencil } from 'lucide-react';
import { InlineStatusSelect } from './inline-status-select';
import { SessionActions } from './session-actions';
import type { SessionStatus } from '@/lib/types';

interface SessionDetailHeaderProps {
  sessionId: string;
  sessionName: string;
  sessionDescription?: string | null;
  sessionStatus: SessionStatus;
}

export function SessionDetailHeader({
  sessionId,
  sessionName,
  sessionDescription,
  sessionStatus,
}: SessionDetailHeaderProps) {
  const router = useRouter();

  const handleSave = async (field: 'name' | 'description', value: string) => {
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex gap-3 sm:gap-4 flex-1 min-w-0">
        <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Layers className="h-5 w-5 sm:h-6 sm:w-6 text-accent-foreground" />
        </div>
        <div className="space-y-1 min-w-0 flex-1">
          <InlineEdit
            value={sessionName}
            onSave={(v) => handleSave('name', v)}
            className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
          />
          {sessionDescription ? (
            <InlineEdit
              value={sessionDescription}
              onSave={(v) => handleSave('description', v)}
              className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400"
              multiline
            />
          ) : (
            <InlineEdit
              value=""
              placeholder="Add description..."
              onSave={(v) => handleSave('description', v)}
              className="text-sm sm:text-base text-zinc-400 dark:text-zinc-500"
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 self-start">
        <InlineStatusSelect
          sessionId={sessionId}
          currentStatus={sessionStatus}
        />
        <SessionActions
          sessionId={sessionId}
          sessionName={sessionName}
          currentStatus={sessionStatus}
          redirectOnDelete="/dashboard/sessions"
        />
      </div>
    </div>
  );
}

// Simple inline edit - looks like text, shows pencil on hover, click to edit
function InlineEdit({
  value,
  placeholder,
  onSave,
  className,
  multiline,
}: {
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
  className?: string;
  multiline?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const startEdit = () => {
    setEditValue(value);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setEditValue(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    const inputClass = `bg-zinc-100 dark:bg-zinc-800 rounded px-2 -mx-2 outline-none focus:ring-2 focus:ring-zinc-400 w-full ${className}`;

    return multiline ? (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        rows={2}
        className={inputClass}
      />
    ) : (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={inputClass}
      />
    );
  }

  return (
    <div
      className="group flex items-center gap-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className={className}>
        {value || placeholder}
      </span>
      <button
        onClick={startEdit}
        className={`shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}
      >
        <Pencil className="h-4 w-4" />
      </button>
    </div>
  );
}
