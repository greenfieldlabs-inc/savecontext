/**
 * Plan configuration constants
 * Centralized options for plan status dropdown
 */

import { Circle, PlayCircle, CheckCircle2 } from 'lucide-react';
import type { PlanStatus } from '@/lib/types';

// Status configuration for plans
export const PLAN_STATUS_OPTIONS: { value: PlanStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'draft', label: 'Draft', icon: <Circle className="h-[14px] w-[14px]" strokeWidth={2} />, color: 'text-zinc-400' },
  { value: 'active', label: 'Active', icon: <PlayCircle className="h-[14px] w-[14px]" />, color: 'text-blue-500' },
  { value: 'completed', label: 'Completed', icon: <CheckCircle2 className="h-[14px] w-[14px]" />, color: 'text-green-500' },
];

export const PLAN_STATUS_CONFIG = Object.fromEntries(
  PLAN_STATUS_OPTIONS.map(s => [s.value, s])
) as Record<PlanStatus, typeof PLAN_STATUS_OPTIONS[number]>;

export const DEFAULT_PLAN_STATUS = PLAN_STATUS_OPTIONS[0]; // 'draft'

// Filter status options for plans list dropdown
export const PLAN_FILTER_STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
] as const;
