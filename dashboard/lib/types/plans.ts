// Plan-related types
// Note: Issue import would be circular, so we use a forward reference pattern

export type PlanStatus = 'draft' | 'active' | 'completed';

// Forward reference for Issue to avoid circular dependency
export interface PlanIssue {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
}

export interface Plan {
  id: string;
  short_id: string | null;
  project_path: string;
  project_id: string | null;
  title: string;
  content: string;  // Markdown PRD/specification
  status: PlanStatus;
  success_criteria: string | null;

  // Session attribution
  created_in_session: string | null;
  completed_in_session: string | null;

  // Timestamps
  created_at: number;
  updated_at: number;
  completed_at: number | null;

  // Relations (populated on request)
  epics?: PlanIssue[];
  epic_count?: number;
  linked_issues?: PlanIssue[];
  linked_issue_count?: number;
  linked_issue_completed_count?: number;
}

export interface PlanStats {
  draft: number;
  active: number;
  completed: number;
  total: number;
}
