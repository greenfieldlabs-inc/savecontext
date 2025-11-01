/**
 * Offline Sync Queue - Retry Logic for Failed Syncs
 *
 * Handles offline scenarios and network failures with exponential backoff.
 * Persists queue to disk to survive server restarts.
 */

import fs from 'fs/promises';
import path from 'path';
import { syncSessionToCloud, SyncSession } from './sync.js';

const QUEUE_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.savecontext',
  'sync-queue.json'
);
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 60000; // 1 minute
const MAX_RETRY_DELAY = 3600000; // 1 hour

export interface QueueItem {
  id: string;
  session: SyncSession;
  retries: number;
  nextRetry: number;
  lastError?: string;
  createdAt: number;
}

class SyncQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Initialize queue from disk
   */
  async initialize(): Promise<void> {
    try {
      const content = await fs.readFile(QUEUE_FILE, 'utf8');
      this.queue = JSON.parse(content);
      console.log(`Loaded ${this.queue.length} items from sync queue`);
    } catch (error) {
      // Queue file doesn't exist yet, start fresh
      this.queue = [];
    }

    // Start background processor
    this.startProcessor();
  }

  /**
   * Add session to queue
   */
  async add(session: SyncSession, error?: string): Promise<void> {
    const item: QueueItem = {
      id: `${session.id}_${Date.now()}`,
      session,
      retries: 0,
      nextRetry: Date.now() + BASE_RETRY_DELAY,
      lastError: error,
      createdAt: Date.now(),
    };

    this.queue.push(item);
    await this.persist();

    console.log(`Added session ${session.id} to sync queue (${this.queue.length} items total)`);
  }

  /**
   * Get items ready for retry
   */
  getReady(): QueueItem[] {
    const now = Date.now();
    return this.queue.filter((item) => item.nextRetry <= now && item.retries < MAX_RETRIES);
  }

  /**
   * Remove item from queue
   */
  async remove(itemId: string): Promise<void> {
    this.queue = this.queue.filter((item) => item.id !== itemId);
    await this.persist();
    console.log(`Removed item ${itemId} from sync queue`);
  }

  /**
   * Update item retry count and next retry time
   */
  async updateRetry(itemId: string, error: string): Promise<void> {
    const item = this.queue.find((i) => i.id === itemId);
    if (!item) return;

    item.retries++;
    item.lastError = error;

    // Exponential backoff: 1m, 2m, 4m, 8m, 16m (capped at 1 hour)
    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, item.retries), MAX_RETRY_DELAY);
    item.nextRetry = Date.now() + delay;

    await this.persist();
    console.log(`Updated retry for ${itemId}: ${item.retries}/${MAX_RETRIES}, next retry in ${delay / 1000}s`);
  }

  /**
   * Remove items that exceeded max retries
   */
  async cleanupFailed(): Promise<number> {
    const failedItems = this.queue.filter((item) => item.retries >= MAX_RETRIES);
    const count = failedItems.length;

    if (count > 0) {
      // Log failed sessions for debugging
      for (const item of failedItems) {
        console.error(`Session ${item.session.id} failed after ${MAX_RETRIES} retries: ${item.lastError}`);
      }

      this.queue = this.queue.filter((item) => item.retries < MAX_RETRIES);
      await this.persist();
    }

    return count;
  }

  /**
   * Get queue status
   */
  getStatus(): {
    total: number;
    ready: number;
    failed: number;
    oldest?: number;
  } {
    const ready = this.getReady().length;
    const failed = this.queue.filter((item) => item.retries >= MAX_RETRIES).length;
    const oldest = this.queue.length > 0 ? Math.min(...this.queue.map((item) => item.createdAt)) : undefined;

    return {
      total: this.queue.length,
      ready,
      failed,
      oldest,
    };
  }

  /**
   * Process queue items
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    try {
      const ready = this.getReady();

      if (ready.length === 0) {
        this.processing = false;
        return;
      }

      console.log(`Processing ${ready.length} queued sync items...`);

      for (const item of ready) {
        try {
          const result = await syncSessionToCloud(item.session);

          if (result.success) {
            await this.remove(item.id);
            console.log(`✓ Synced queued session ${item.session.id}`);
          } else {
            await this.updateRetry(item.id, result.error || 'Unknown error');
            console.log(`✗ Failed to sync ${item.session.id}: ${result.error}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          await this.updateRetry(item.id, errorMsg);
          console.log(`✗ Exception syncing ${item.session.id}: ${errorMsg}`);
        }
      }

      // Clean up failed items
      const cleaned = await this.cleanupFailed();
      if (cleaned > 0) {
        console.log(`Removed ${cleaned} permanently failed items from queue`);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Start background processor
   */
  private startProcessor(): void {
    if (this.intervalId) return;

    // Process queue every minute
    this.intervalId = setInterval(() => {
      this.processQueue().catch((error) => {
        console.error('Queue processor error:', error);
      });
    }, 60000);

    // Process immediately on start
    this.processQueue().catch((error) => {
      console.error('Initial queue processing error:', error);
    });

    console.log('Sync queue processor started (interval: 60s)');
  }

  /**
   * Stop background processor
   */
  stopProcessor(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Sync queue processor stopped');
    }
  }

  /**
   * Persist queue to disk
   */
  private async persist(): Promise<void> {
    try {
      const dir = path.dirname(QUEUE_FILE);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(QUEUE_FILE, JSON.stringify(this.queue, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to persist sync queue:', error);
    }
  }

  /**
   * Force immediate sync of all ready items
   */
  async syncNow(): Promise<{ synced: number; failed: number }> {
    await this.processQueue();

    const status = this.getStatus();
    return {
      synced: status.total - status.ready - status.failed,
      failed: status.failed,
    };
  }
}

// Singleton instance
export const syncQueue = new SyncQueue();
