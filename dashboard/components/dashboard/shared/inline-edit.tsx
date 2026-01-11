'use client';

import { useState, useRef } from 'react';
import { Pencil } from 'lucide-react';

export interface InlineEditProps {
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
  className?: string;
  multiline?: boolean;
  /** Size variant - affects icon size, gaps, and padding */
  size?: 'sm' | 'md';
  /** Whether to stop event propagation (useful when inside clickable containers) */
  stopPropagation?: boolean;
}

export function InlineEdit({
  value,
  placeholder,
  onSave,
  className,
  multiline,
  size = 'md',
  stopPropagation = false,
}: InlineEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const stopProp = (e: React.MouseEvent | React.FocusEvent) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const startEdit = (e: React.MouseEvent) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setEditValue(value);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setEditValue(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (stopPropagation) {
      e.stopPropagation();
    }
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditValue(value);
      setIsEditing(false);
    }
  };

  const sizeConfig = {
    sm: {
      gap: 'gap-1',
      iconSize: 'h-3 w-3',
      buttonPadding: 'p-0.5',
      inputMargin: '-mx-1 px-1',
    },
    md: {
      gap: 'gap-2',
      iconSize: 'h-4 w-4',
      buttonPadding: 'p-1',
      inputMargin: '-mx-2 px-2',
    },
  }[size];

  if (isEditing) {
    const inputClass = `bg-zinc-100 dark:bg-zinc-800 rounded ${sizeConfig.inputMargin} outline-none focus:ring-2 focus:ring-zinc-400 w-full ${className}`;

    const inputProps = {
      value: editValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEditValue(e.target.value),
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
      onClick: stopProp,
      onMouseDown: stopProp,
      className: inputClass,
    };

    if (stopPropagation) {
      return (
        <div ref={containerRef} onClick={stopProp} onMouseDown={stopProp}>
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              {...inputProps}
              rows={2}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              {...inputProps}
            />
          )}
        </div>
      );
    }

    return multiline ? (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        {...inputProps}
        rows={2}
      />
    ) : (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        {...inputProps}
      />
    );
  }

  return (
    <div
      className={`group flex items-center ${sizeConfig.gap}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={stopProp}
      onMouseDown={stopProp}
    >
      <span className={`${className} ${multiline ? 'line-clamp-2' : 'truncate'}`}>
        {value || placeholder}
      </span>
      <button
        onClick={startEdit}
        onMouseDown={stopProp}
        className={`shrink-0 ${sizeConfig.buttonPadding} rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}
      >
        <Pencil className={sizeConfig.iconSize} />
      </button>
    </div>
  );
}
