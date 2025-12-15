/**
 * Status Cache for Claude Code Status Line
 *
 * Writes session info to a cache file keyed by terminal TTY.
 * This allows Claude Code's status line to display the current session.
 *
 * TTY Resolution Strategy (in order):
 * 1. SAVECONTEXT_STATUS_KEY env var (explicit override)
 * 2. Parent process TTY via `ps -o tty= -p $PPID`
 * 3. TERM_SESSION_ID env var (macOS Terminal.app)
 * 4. ITERM_SESSION_ID env var (iTerm2)
 * 5. Skip caching if no key available
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync, renameSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import type { StatusCacheEntry } from '../types/index.js';

// Cache directory
const STATUS_CACHE_DIR = join(homedir(), '.savecontext', 'status-cache');

// TTL for cache entries (2 hours)
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
  if (!existsSync(STATUS_CACHE_DIR)) {
    mkdirSync(STATUS_CACHE_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get the status key for this terminal
 * Uses PPID TTY resolution with env var fallbacks
 */
export function getStatusKey(): string | null {
  // 1. Explicit override
  if (process.env.SAVECONTEXT_STATUS_KEY) {
    return sanitizeKey(process.env.SAVECONTEXT_STATUS_KEY);
  }

  // 2. Try to get parent process TTY
  try {
    const ppid = process.ppid;
    if (ppid) {
      const tty = execSync(`ps -o tty= -p ${ppid}`, {
        encoding: 'utf-8',
        timeout: 1000,
      }).trim();

      // Normalize: strip whitespace, reject empty/unknown
      if (tty && tty !== '?' && tty !== '??') {
        return sanitizeKey(`tty-${tty}`);
      }
    }
  } catch {
    // TTY lookup failed, try fallbacks
  }

  // 3. macOS Terminal.app session ID
  if (process.env.TERM_SESSION_ID) {
    return sanitizeKey(`term-${process.env.TERM_SESSION_ID}`);
  }

  // 4. iTerm2 session ID
  if (process.env.ITERM_SESSION_ID) {
    return sanitizeKey(`iterm-${process.env.ITERM_SESSION_ID}`);
  }

  // 5. No key available - skip caching
  return null;
}

/**
 * Sanitize key for use as filename
 * Returns null if key becomes empty after sanitization
 */
function sanitizeKey(key: string): string | null {
  // Replace path separators and special chars with underscores, trim whitespace
  const sanitized = key.trim().replace(/[\/\\:*?"<>|\s]+/g, '_').slice(0, 100);
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Get cache file path for a key
 */
function getCacheFilePath(key: string): string {
  return join(STATUS_CACHE_DIR, `${key}.json`);
}

/**
 * Write session info to status cache (atomic write)
 */
export function writeStatusCache(entry: StatusCacheEntry): boolean {
  const key = getStatusKey();
  if (!key) {
    return false;
  }

  try {
    ensureCacheDir();

    const filePath = getCacheFilePath(key);
    const tempPath = `${filePath}.tmp`;

    // Write to temp file first
    writeFileSync(tempPath, JSON.stringify(entry, null, 2), { mode: 0o600 });

    // Atomic rename
    renameSync(tempPath, filePath);

    return true;
  } catch {
    // Silently fail - status line is non-critical
    return false;
  }
}

/**
 * Clear session info from status cache
 */
export function clearStatusCache(): boolean {
  const key = getStatusKey();
  if (!key) {
    return false;
  }

  try {
    const filePath = getCacheFilePath(key);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Read status cache entry for current terminal
 * (Used by status line script, but exposed here for testing)
 */
export function readStatusCache(): StatusCacheEntry | null {
  const key = getStatusKey();
  if (!key) {
    return null;
  }

  try {
    const filePath = getCacheFilePath(key);
    if (!existsSync(filePath)) {
      return null;
    }

    const data = readFileSync(filePath, 'utf-8');
    const entry: StatusCacheEntry = JSON.parse(data);

    // Check TTL using entry.timestamp (not file mtime)
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      // Stale entry - remove it
      unlinkSync(filePath);
      return null;
    }

    return entry;
  } catch {
    return null;
  }
}

/**
 * Clean up stale cache entries (older than TTL) and orphaned .tmp files
 * Called periodically to prevent cache directory from growing
 */
export function cleanupStaleCache(): number {
  let cleaned = 0;

  try {
    if (!existsSync(STATUS_CACHE_DIR)) {
      return 0;
    }

    const files = readdirSync(STATUS_CACHE_DIR);
    const now = Date.now();

    for (const file of files) {
      const filePath = join(STATUS_CACHE_DIR, file);

      // Clean up orphaned .tmp files (crashed writes)
      if (file.endsWith('.tmp')) {
        try {
          unlinkSync(filePath);
          cleaned++;
        } catch {
          // Ignore
        }
        continue;
      }

      if (!file.endsWith('.json')) continue;

      // Check TTL using entry.timestamp
      try {
        const data = readFileSync(filePath, 'utf-8');
        const entry: StatusCacheEntry = JSON.parse(data);
        if (now - entry.timestamp > CACHE_TTL_MS) {
          unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // Corrupted file - remove it
        try {
          unlinkSync(filePath);
          cleaned++;
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  return cleaned;
}

/**
 * Get cache directory path (for status line script)
 */
export function getStatusCacheDir(): string {
  return STATUS_CACHE_DIR;
}

/**
 * Refresh status cache timestamp for current session
 * Call this on every tool request to keep cache fresh while SaveContext is in use
 * Returns true if cache was refreshed, false if no active session
 */
export function refreshStatusCache(
  session: {
    id: string;
    name: string;
    project_path?: string;
    status?: string;
  } | null,
  options?: {
    itemCount?: number;
    provider?: string;
    projectPath?: string;
  }
): boolean {
  if (!session) {
    return false;
  }

  const projectPath = session.project_path ?? options?.projectPath;
  if (!projectPath) {
    return false;
  }

  const status = session.status;
  const sessionStatus: StatusCacheEntry['sessionStatus'] =
    status === 'active' || status === 'paused' || status === 'completed' ? status : 'active';

  return writeStatusCache({
    sessionId: session.id,
    sessionName: session.name,
    projectPath,
    timestamp: Date.now(),
    provider: options?.provider,
    itemCount: options?.itemCount ?? 0,
    sessionStatus,
  });
}

/**
 * High-level helper to update status line from session data
 * Pass null to clear the cache
 */
export function updateStatusLine(
  session: {
    id: string;
    name: string;
    project_path?: string;
    status?: string;
  } | null,
  options?: {
    itemCount?: number;
    provider?: string;
    projectPath?: string; // Override if session.project_path is missing
  }
): void {
  if (!session) {
    clearStatusCache();
    return;
  }

  const projectPath = session.project_path ?? options?.projectPath;
  if (!projectPath) {
    // Avoid writing an invalid cache entry
    return;
  }

  const status = session.status;
  const sessionStatus: StatusCacheEntry['sessionStatus'] =
    status === 'active' || status === 'paused' || status === 'completed' ? status : 'active';

  writeStatusCache({
    sessionId: session.id,
    sessionName: session.name,
    projectPath,
    timestamp: Date.now(),
    provider: options?.provider,
    itemCount: options?.itemCount ?? 0,
    sessionStatus,
  });
}
