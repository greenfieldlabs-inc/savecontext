// ====================
// Project CRUD Types
// ====================

/**
 * Project entity representing a codebase/repository
 */
export interface Project {
  id: string;
  project_path: string;
  name: string;
  description: string | null;
  issue_prefix: string | null;
  next_issue_number: number;
  plan_prefix: string | null;
  next_plan_number: number;
  created_at: number;
  updated_at: number;
}

/**
 * Arguments for creating a new project
 */
export interface CreateProjectArgs {
  project_path: string;
  name?: string;
  description?: string;
  issue_prefix?: string;
}

/**
 * Arguments for updating a project
 */
export interface UpdateProjectArgs {
  project_path: string;
  name?: string;
  description?: string;
  issue_prefix?: string;
}

/**
 * Arguments for listing projects
 */
export interface ListProjectsArgs {
  limit?: number;
  include_session_count?: boolean;
}

/**
 * Arguments for deleting a project
 */
export interface DeleteProjectArgs {
  project_path: string;
  confirm: boolean;
}
