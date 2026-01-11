'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

// Generic dropdown component with portal for proper z-index stacking
export function Dropdown<T extends string | number>({
  trigger,
  options,
  value,
  onChange,
  renderOption,
  className = '',
}: {
  trigger: React.ReactNode;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  renderOption: (option: { value: T; label: string }, isSelected: boolean) => React.ReactNode;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Update position when opening (with viewport boundary detection)
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuHeight = 200; // Approximate menu height
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      // If not enough space below and more space above, flip upward
      const shouldFlipUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;

      setPosition({
        top: shouldFlipUp
          ? rect.top + window.scrollY - menuHeight - 4
          : rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menu = isOpen && mounted && (
    <div
      ref={menuRef}
      className="fixed z-99999 min-w-[200px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
      style={{ top: position.top, left: position.left }}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          onClick={(e) => {
            e.stopPropagation();
            onChange(option.value);
            setIsOpen(false);
          }}
          className="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between"
        >
          {renderOption(option, option.value === value)}
          {option.value === value && <Check className="h-4 w-4 text-zinc-500" />}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="flex items-center"
      >
        {trigger}
      </button>
      {mounted && createPortal(menu, document.body)}
    </div>
  );
}
