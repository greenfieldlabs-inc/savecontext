// Dashboard statistics types

export interface Stats {
  total_sessions: number;
  active_sessions: number;
  paused_sessions: number;
  completed_sessions: number;
  total_context_items: number;
  total_checkpoints: number;
  total_projects: number;
  total_memory_items: number;
  total_tasks: number;
  tasks_todo: number;
  tasks_done: number;
}
