// ====================
// Database Config Types
// ====================

export interface DatabaseConfig {
  filename?: string;
  dataDir?: string;
}

// ====================
// SQLite Row Types
// ====================

export interface CheckpointItemRow {
  checkpoint_id: string;
  context_item_id: string;
  group_name: string | null;
  group_order: number | null;
}

export interface CheckpointRow {
  id: string;
  session_id: string;
  name: string;
  description: string | null;
  git_status: string | null;
  git_branch: string | null;
  item_count: number;
  total_size: number;
  created_at: number;
}

// ====================
// Database Param Types
// ====================

/**
 * SQLite binding parameter - the types that better-sqlite3 accepts.
 * Note: booleans are NOT supported - convert to 0/1 before binding.
 * @see https://github.com/WiseLibs/better-sqlite3/issues/209
 */
export type SqliteBindValue = string | number | bigint | Buffer | null;
