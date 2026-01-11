/**
 * Zod validation schemas for API routes
 * Derives enums from existing constants for single source of truth
 */

import { z } from 'zod';
import { STATUS_OPTIONS, PRIORITY_OPTIONS, TYPE_OPTIONS } from '@/lib/constants/issue-config';
import { PLAN_STATUS_OPTIONS } from '@/lib/constants/plan-config';

// ============================================================================
// Issue Schemas
// ============================================================================

// Derive valid values from constants
const issueStatuses = STATUS_OPTIONS.map(s => s.value) as [string, ...string[]];
const issueTypes = TYPE_OPTIONS.map(t => t.value) as [string, ...string[]];
const validPriorities: number[] = PRIORITY_OPTIONS.map(p => p.value);

export const IssueStatusSchema = z.enum(issueStatuses);
export const IssueTypeSchema = z.enum(issueTypes);
export const IssuePrioritySchema = z.number().int().refine(
  (val) => validPriorities.includes(val),
  { message: `Priority must be one of: ${validPriorities.join(', ')}` }
);

export const CreateIssueSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(10000).optional(),
  details: z.string().max(50000).optional(),
  status: IssueStatusSchema.optional().default('open'),
  priority: IssuePrioritySchema.optional().default(2),
  issueType: IssueTypeSchema.optional().default('task'),
  parentId: z.string().optional().nullable(),
  planId: z.string().optional().nullable(),
  labels: z.array(z.string()).optional(),
  projectPath: z.string().optional(),
});

export const UpdateIssueSchema = z.object({
  id: z.string().min(1, 'Issue ID is required'),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional().nullable(),
  details: z.string().max(50000).optional().nullable(),
  status: IssueStatusSchema.optional(),
  priority: IssuePrioritySchema.optional(),
  issueType: IssueTypeSchema.optional(),
  parentId: z.string().optional().nullable(),
  planId: z.string().optional().nullable(),
});

// ============================================================================
// Plan Schemas
// ============================================================================

const planStatuses = PLAN_STATUS_OPTIONS.map(s => s.value) as [string, ...string[]];

export const PlanStatusSchema = z.enum(planStatuses);

export const CreatePlanSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  content: z.string().max(100000).optional().default(''),
  successCriteria: z.string().max(10000).optional(),
  status: PlanStatusSchema.optional().default('draft'),
  projectPath: z.string().min(1, 'Project path is required'),
});

export const UpdatePlanSchema = z.object({
  id: z.string().min(1, 'Plan ID is required'),
  title: z.string().min(1).max(500).optional(),
  content: z.string().max(100000).optional(),
  successCriteria: z.string().max(10000).optional().nullable(),
  status: PlanStatusSchema.optional(),
  project_path: z.string().optional(),
});

// ============================================================================
// Context Schemas
// ============================================================================

export const ContextCategorySchema = z.enum(['reminder', 'decision', 'progress', 'note']);
export const ContextPrioritySchema = z.enum(['high', 'normal', 'low']);

export const UpdateContextSchema = z.object({
  id: z.string().min(1, 'Context item ID is required'),
  value: z.string().max(100000).optional(),
  category: ContextCategorySchema.optional(),
  priority: ContextPrioritySchema.optional(),
  channel: z.string().optional(),
});

// ============================================================================
// Memory Schemas
// ============================================================================

export const MemoryCategorySchema = z.enum(['command', 'config', 'note']);

export const SaveMemorySchema = z.object({
  key: z.string().min(1, 'Key is required').max(200),
  value: z.string().min(1, 'Value is required').max(100000),
  category: MemoryCategorySchema.optional().default('note'),
  projectPath: z.string().min(1, 'Project path is required'),
});

// ============================================================================
// Validation Helper
// ============================================================================

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Format errors nicely (Zod v4 uses 'issues' instead of 'errors')
  const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`);
  return { success: false, error: errors.join('; ') };
}
