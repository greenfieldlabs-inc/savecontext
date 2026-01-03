// ====================
// Context Item Types
// ====================

export type ItemCategory = 'reminder' | 'decision' | 'progress' | 'note';
export type ItemPriority = 'high' | 'normal' | 'low';

export interface ContextItem {
  id: string;
  session_id: string;
  key: string;
  value: string;
  category: ItemCategory;
  priority: ItemPriority;
  channel: string;
  tags: string;  // JSON array of tag strings
  size: number;
  created_at: number;
  updated_at: number;

  // Cloud sync fields (optional for MVP)
  synced_at?: number;
  is_synced?: number;
}

export interface SaveContextArgs {
  key: string;
  value: string;
  category?: ItemCategory;
  priority?: ItemPriority;
  channel?: string;
}

export interface GetContextArgs {
  key?: string;
  category?: ItemCategory;
  priority?: ItemPriority;
  channel?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateContextArgs {
  key: string;
  value?: string;
  category?: ItemCategory;
  priority?: ItemPriority;
  channel?: string;
}

export interface DeleteContextArgs {
  key: string;
}

// ====================
// Memory Types
// ====================

export type MemoryCategory = 'command' | 'config' | 'note';

export interface SaveMemoryArgs {
  key: string;
  value: string;
  category?: MemoryCategory;
}

export interface GetMemoryArgs {
  key: string;
}

export interface ListMemoryArgs {
  category?: MemoryCategory;
}

export interface DeleteMemoryArgs {
  key: string;
}
