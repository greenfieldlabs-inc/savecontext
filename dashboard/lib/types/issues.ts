// Issue types - matching cloud schema
import type { Plan } from './plans';

// Issue status: backlog, open, in_progress, blocked, closed, deferred
// Note: "duplicate" is NOT a status - it's a relation type (duplicate-of dependency)
export type IssueStatus = 'backlog' | 'open' | 'in_progress' | 'blocked' | 'closed' | 'deferred';
export const VALID_STATUSES: IssueStatus[] = ['backlog', 'open', 'in_progress', 'blocked', 'closed', 'deferred'];

// Issue priority: 0=lowest, 1=low, 2=medium, 3=high, 4=critical
export type IssuePriority = 0 | 1 | 2 | 3 | 4;

// Issue type classification
export type IssueType = 'task' | 'bug' | 'feature' | 'epic' | 'chore';

// Dependency type
export type DependencyType = 'blocks' | 'related' | 'parent-child' | 'discovered-from' | 'duplicate-of';

export interface IssueLabel {
  id: string;
  label: string;
}

// Label with usage count (for autocomplete/suggestions)
export interface LabelInfo {
  label: string;
  count: number;
}

export interface LabelSelectProps {
  issueId: string;
  initialLabels: string[];
  onLabelsChange?: (labels: string[]) => void;
  projectPath?: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
}

export interface LabelDisplayProps {
  labels: string[];
  maxVisible?: number;
  className?: string;
}

export interface IssueDependency {
  id: string;
  dependsOnId: string;
  dependsOnShortId: string | null;
  dependsOnTitle: string;
  dependencyType: DependencyType;
}

export interface IssueDependent {
  id: string;
  issueId: string;
  issueShortId: string | null;
  issueTitle: string;
  dependencyType: DependencyType;
}

// Parent info extracted from parent-child dependency
export interface ParentInfo {
  id: string;
  short_id: string | null;
  title: string;
}

export interface Issue {
  id: string;
  short_id: string | null;
  project_path: string;
  additional_project_paths?: string[];  // Multi-project support (from issue_projects table)
  project_id: string | null;
  plan_id: string | null;
  title: string;
  description: string | null;
  details: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  issue_type: IssueType;

  // Hierarchy: via IssueDependency with type='parent-child' (beads model)
  // No parent_id column - query dependencies for parent relationship

  // Session attribution
  created_in_session: string | null;
  completed_in_session: string | null;

  // Timestamps
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  deferred_at: number | null;

  // Relations (populated on request)
  labels?: IssueLabel[];
  dependencies?: IssueDependency[];
  dependents?: IssueDependent[];
  children?: Issue[];           // Issues with parent-child dependency pointing to this
  child_count?: number;         // Count of children
  completed_count?: number;     // Count of closed children (for progress)
  parent?: ParentInfo | null;   // Parent issue info (from parent-child dependency)
  plan?: Plan;
}

export interface IssueStats {
  backlog: number;
  open: number;
  in_progress: number;
  blocked: number;
  closed: number;
  deferred: number;
  total: number;
  by_priority: Record<number, number>;
  by_type: Record<string, number>;
}

export interface IssueProgressProps {
  completed: number;
  total: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export interface CloneIssueRequest {
  id: string;
  title?: string;
  description?: string;
  details?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  issue_type?: IssueType;
  parent_id?: string;
  plan_id?: string;
  labels?: string[];
  include_labels?: boolean;
}

export interface CloneIssueResult {
  cloned: boolean;
  original_id: string;
  original_short_id: string | null;
  original_title: string;
  new_issue: {
    id: string;
    short_id: string;
    title: string;
    status: IssueStatus;
    priority: IssuePriority;
    issue_type: IssueType;
    labels: string[];
    parent_id: string | null;
    plan_id: string | null;
  };
}

export interface IssueActionMenuProps {
  issue: Issue;
  onClone: (issue: Issue) => void;
  onMarkDuplicate?: (issue: Issue) => void;
  onReactivateTo?: (issue: Issue) => void;
  onDelete?: (issueId: string) => void;
  showMarkDuplicate?: boolean;
  showCopyActions?: boolean;
  size?: 'sm' | 'md';
}

export interface InlineIssueFormData {
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  issueType: IssueType;
  dependsOn?: string[];
}

export interface InlineIssueFormProps {
  onSubmit: (data: InlineIssueFormData) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  siblingIssues?: Issue[];
  placeholder?: string;
}
