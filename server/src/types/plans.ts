// ====================
// Plan Types
// ====================

export type PlanStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface Plan {
  id: string;
  short_id: string | null;
  project_path: string;
  project_id: string;
  title: string;
  status: PlanStatus;
  success_criteria: string | null;
  epic_count: number;
  linked_issue_count: number;
  linked_issue_completed_count: number;
  created_in_session: string | null;
  completed_in_session: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface ListPlansArgs {
  project_path?: string;
  status?: PlanStatus | 'all';
  limit?: number;
}

export interface GetPlanArgs {
  plan_id: string;
}

export interface CreatePlanArgs {
  title: string;
  content: string;
  status?: PlanStatus;
  successCriteria?: string;
  project_path?: string;
}

export interface UpdatePlanArgs {
  id: string;
  title?: string;
  content?: string;
  status?: PlanStatus;
  successCriteria?: string;
  project_path?: string;  // Changing this cascades to all linked issues
}
