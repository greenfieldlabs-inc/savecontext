// ====================
// Issue Types
// ====================

export type IssueStatus = 'open' | 'in_progress' | 'blocked' | 'closed' | 'deferred';
export type IssueType = 'task' | 'bug' | 'feature' | 'epic' | 'chore';
export type DependencyType = 'blocks' | 'related' | 'parent-child' | 'discovered-from';

export interface Issue {
  id: string;
  shortId?: string;
  projectPath: string;
  planId?: string;
  title: string;
  description?: string;
  details?: string;
  status: IssueStatus;
  priority: number;  // 0-4: lowest, low, medium, high, critical
  issueType: IssueType;
  createdByAgent?: string;
  closedByAgent?: string;
  createdInSession?: string;
  closedInSession?: string;
  assignedToAgent?: string;
  assignedAt?: number;
  assignedInSession?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  deferredAt?: number;
  labels?: string[];
  dependencyCount?: number;
  dependentCount?: number;
  subtaskCount?: number;
  parentId?: string;  // Populated from issue_dependencies with type='parent-child'
}

export interface CreateIssueArgs {
  title: string;
  description?: string;
  details?: string;
  priority?: number;  // 0-4, default 2
  issueType?: IssueType;
  parentId?: string;
  planId?: string;    // Link to a Plan (PRD/spec)
  labels?: string[];
  status?: IssueStatus;
}

export interface UpdateIssueArgs {
  id: string;
  issue_title: string;
  title?: string;
  description?: string;
  details?: string;
  status?: IssueStatus;
  priority?: number;
  issueType?: IssueType;
  parentId?: string | null;
  planId?: string | null;
  projectPath?: string;
}

export interface ListIssuesArgs {
  project_path?: string;
  status?: IssueStatus;
  priority?: number;
  priorityMin?: number;
  priorityMax?: number;
  issueType?: IssueType;
  labels?: string[];
  labelsAny?: string[];
  parentId?: string;
  planId?: string;
  hasSubtasks?: boolean;
  hasDependencies?: boolean;
  sortBy?: 'priority' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

export interface CompleteIssueArgs {
  id: string;
  issue_title: string;
}

// Dependency management
export interface AddDependencyArgs {
  issueId: string;
  dependsOnId: string;
  dependencyType?: DependencyType;
}

export interface RemoveDependencyArgs {
  issueId: string;
  dependsOnId: string;
}

// Label management
export interface AddLabelsArgs {
  id: string;
  labels: string[];
}

export interface RemoveLabelsArgs {
  id: string;
  labels: string[];
}

// Agent assignment
export interface ClaimIssuesArgs {
  issue_ids: string[];
}

export interface GetNextBlockArgs {
  count?: number;
  priority_min?: number;
  labels?: string[];
}

export interface ReleaseIssuesArgs {
  issue_ids: string[];
}

export interface GetReadyIssuesArgs {
  limit?: number;
  sortBy?: 'priority' | 'createdAt';
}

// Batch creation
export interface CreateBatchArgs {
  planId?: string;    // Link all issues in batch to a Plan (individual issues can override)
  issues: Array<{
    title: string;
    description?: string;
    details?: string;
    priority?: number;
    issueType?: IssueType;
    parentId?: string;  // Can use '$0', '$1' to reference earlier issues in batch
    planId?: string;    // Override batch-level planId for this issue
    labels?: string[];
  }>;
  dependencies?: Array<{
    issueIndex: number;
    dependsOnIndex: number;
    dependencyType?: DependencyType;
  }>;
}

// ====================
// Issue Operation Results
// ====================

export interface AddDependencyResult {
  created: boolean;
  issueId: string;
  issueShortId: string;
  dependsOnId: string;
  dependsOnShortId: string;
  dependencyType: DependencyType;
  issueBlocked: boolean;
}

export interface RemoveDependencyResult {
  removed: boolean;
  issueId: string;
  dependsOnId: string;
  issueUnblocked: boolean;
}

export interface AddLabelsResult {
  issueId: string;
  shortId: string;
  labels: string[];
  addedCount: number;
}

export interface RemoveLabelsResult {
  issueId: string;
  shortId: string;
  labels: string[];
  removedCount: number;
}

export interface ClaimIssuesResult {
  claimedIssues: Array<{
    id: string;
    shortId: string;
    title: string;
  }>;
  alreadyClaimed: string[];
  notFound: string[];
}

export interface ReleaseIssuesResult {
  releasedIssues: Array<{
    id: string;
    shortId: string;
    title: string;
  }>;
  notOwned: string[];
  notFound: string[];
}

export interface GetNextBlockResult {
  issues: Issue[];
  claimedCount: number;
  agentId: string;
}

export interface CreateBatchResult {
  issues: Array<{
    id: string;
    shortId: string;
    title: string;
    index: number;
  }>;
  dependencies: Array<{
    issueShortId: string;
    dependsOnShortId: string;
    dependencyType: DependencyType;
  }>;
  count: number;
  dependencyCount: number;
}

export interface ListIssuesResult {
  issues: Issue[];
  count: number;
  total?: number;
  filters_applied?: Record<string, unknown>;
}

export interface IssueDependencyInfo {
  id: string;
  shortId: string;
  title: string;
  status: IssueStatus;
  dependencyType: DependencyType;
}

export interface GetReadyIssuesResult {
  issues: Issue[];
  count: number;
}
