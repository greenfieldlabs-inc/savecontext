// ====================
// Server Config Types
// ====================

import type { ItemCategory, ItemPriority } from './context';

export interface CompactionConfig {
  threshold: number;
  mode: 'auto' | 'remind' | 'manual';
}

export interface ClientInfo {
  name: string;
  version: string;
  provider: string;  // Normalized provider name
  connectedAt: number;
}

export interface ConnectionState {
  clientInfo: ClientInfo;
  sessionId: string | null;
}

// ====================
// Update Types
// ====================

export interface ContextItemUpdate {
  value?: string;
  category?: ItemCategory;
  priority?: ItemPriority;
  channel?: string;
}

export interface IssueUpdate {
  title?: string;
  description?: string;
  status?: 'open' | 'closed';
}
