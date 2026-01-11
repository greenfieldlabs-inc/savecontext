/**
 * Context item configuration constants
 * Colors and labels for context categories and priorities
 */

import type { ContextCategory, ContextPriority } from '@/lib/types';

export interface ContextCategoryConfig {
  bg: string;
  text: string;
  label: string;
}

export interface ContextPriorityConfig {
  bg: string;
  text: string;
  label: string;
}

export const CONTEXT_CATEGORY_CONFIG: Record<ContextCategory, ContextCategoryConfig> = {
  reminder: {
    bg: 'bg-blue-500/10 dark:bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    label: 'Reminder'
  },
  decision: {
    bg: 'bg-purple-500/10 dark:bg-purple-500/10',
    text: 'text-purple-600 dark:text-purple-400',
    label: 'Decision'
  },
  progress: {
    bg: 'bg-teal-500/10 dark:bg-teal-500/10',
    text: 'text-teal-600 dark:text-teal-400',
    label: 'Progress'
  },
  note: {
    bg: 'bg-zinc-500/10 dark:bg-zinc-500/10',
    text: 'text-zinc-600 dark:text-zinc-400',
    label: 'Note'
  }
};

export const CONTEXT_PRIORITY_CONFIG: Record<ContextPriority, ContextPriorityConfig> = {
  high: {
    bg: 'bg-red-500/10 dark:bg-red-500/10',
    text: 'text-red-600 dark:text-red-400',
    label: 'High'
  },
  normal: {
    bg: 'bg-yellow-500/10 dark:bg-yellow-500/10',
    text: 'text-yellow-600 dark:text-yellow-400',
    label: 'Normal'
  },
  low: {
    bg: 'bg-gray-500/10 dark:bg-gray-500/10',
    text: 'text-gray-600 dark:text-gray-400',
    label: 'Low'
  }
};

/**
 * Get category config with fallback to 'note'
 */
export function getCategoryConfig(category: string): ContextCategoryConfig {
  return CONTEXT_CATEGORY_CONFIG[category as ContextCategory] || CONTEXT_CATEGORY_CONFIG.note;
}

/**
 * Get priority config with fallback to 'normal'
 */
export function getPriorityConfig(priority: string): ContextPriorityConfig {
  return CONTEXT_PRIORITY_CONFIG[priority as ContextPriority] || CONTEXT_PRIORITY_CONFIG.normal;
}
