// Barrel file - re-exports all types
// Import from '@/lib/types' or from specific files like '@/lib/types/issues'

// Sessions
export type {
  Session,
  SessionStatus,
  SessionWithProjects,
  SessionWithAgents,
  SessionSummary,
  SessionProject,
  AgentInfo,
  AgentSession,
  SessionOperationResult,
  DeleteSessionResult,
  SessionProjectInfo,
  GetSessionProjectsResult,
} from './sessions';

// Context
export type {
  ContextItem,
  ContextCategory,
  ContextPriority,
  Checkpoint,
  CheckpointItem,
  FileCache,
} from './context';

// Projects
export type {
  ProjectSummary,
  AffectedSessionRow,
  SessionPathUpdate,
  ProjectDeletionResult,
  ProjectOperationResult,
} from './projects';

// Issues
export type {
  Issue,
  IssueStatus,
  IssuePriority,
  IssueType,
  IssueLabel,
  LabelInfo,
  LabelSelectProps,
  LabelDisplayProps,
  IssueDependency,
  IssueDependent,
  IssueStats,
  IssueProgressProps,
  DependencyType,
  ParentInfo,
  IssueActionMenuProps,
  InlineIssueFormData,
  InlineIssueFormProps,
} from './issues';

// Plans
export type {
  Plan,
  PlanStatus,
  PlanStats,
  PlanIssue,
} from './plans';

// Memory
export type {
  Memory,
  MemoryCategory,
} from './memory';

// Stats
export type { Stats } from './stats';

// UI
export type { LocalDateProps } from './ui';
