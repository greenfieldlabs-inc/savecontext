'use client';

import { ChevronDown, Terminal, Settings, FileText } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';

type MemoryCategory = 'command' | 'config' | 'note';

const CATEGORY_OPTIONS: { value: MemoryCategory; label: string }[] = [
  { value: 'command', label: 'Command' },
  { value: 'config', label: 'Config' },
  { value: 'note', label: 'Note' },
];

const CATEGORY_CONFIG: Record<MemoryCategory, { icon: React.ReactNode; color: string }> = {
  command: { icon: <Terminal className="h-4 w-4" />, color: 'text-blue-600 dark:text-blue-400' },
  config: { icon: <Settings className="h-4 w-4" />, color: 'text-purple-600 dark:text-purple-400' },
  note: { icon: <FileText className="h-4 w-4" />, color: 'text-green-600 dark:text-green-400' },
};

export function MemoryCategoryDropdown({
  value,
  onChange
}: {
  value: MemoryCategory;
  onChange: (category: MemoryCategory) => void;
}) {
  const current = CATEGORY_CONFIG[value];

  return (
    <Dropdown
      trigger={
        <span className={`flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${current.color}`}>
          {current.icon}
          <span className="text-sm">{CATEGORY_OPTIONS.find(o => o.value === value)?.label}</span>
          <ChevronDown className="h-3 w-3 ml-1 text-zinc-400" />
        </span>
      }
      options={CATEGORY_OPTIONS}
      value={value}
      onChange={onChange}
      renderOption={(option) => {
        const config = CATEGORY_CONFIG[option.value];
        return (
          <span className={`flex items-center gap-2 ${config.color}`}>
            {config.icon}
            <span>{option.label}</span>
          </span>
        );
      }}
    />
  );
}
