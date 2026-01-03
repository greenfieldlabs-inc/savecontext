// Memory types

export type MemoryCategory = 'command' | 'config' | 'note';

export interface Memory {
  id: string;
  project_path: string;
  key: string;
  value: string;
  category: MemoryCategory;
  created_at: number;
  updated_at: number;
}
