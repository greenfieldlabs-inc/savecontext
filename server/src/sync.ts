/**
 * Local Database Sync Module - Save Sessions to Local PostgreSQL
 *
 * NOTE: This currently syncs to LOCAL PostgreSQL database only.
 * Future implementation will add cloud API sync for Pro users.
 * For now, all users sync to local database at DATABASE_URL.
 *
 * Cloud sync will be implemented when Next.js dashboard API is ready.
 */

import { PrismaClient } from '@prisma/client';
import { getApiKey } from './crypto.js';

// Initialize Prisma client (connects to DATABASE_URL from .env)
const prisma = new PrismaClient();

// NOTE: Cloud API URL for future implementation
// const CLOUD_API_URL = process.env.CLOUD_API_URL || 'https://savecontext.io/api';

export interface SyncSession {
  id: string;
  userId: string;
  projectName: string;
  toolUsed: string;
  tokenCount: number;
  context?: any;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface SyncResponse {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface SyncStats {
  today: {
    sessions: number;
    tokens: number;
  };
  thisWeek: {
    sessions: number;
    tokens: number;
  };
  quotaRemaining: number;
}

/**
 * Check if user has valid API key (is Pro user)
 * NOTE: For local testing, everyone is considered "Pro" if they have any API key set
 * In production, this will verify with cloud API
 */
export async function isProUser(userId: string): Promise<boolean> {
  // TEMPORARY: For local testing, return true to enable all features
  // In production, this will check API key with cloud
  return true;
}

/**
 * Sync session to local PostgreSQL database
 * NOTE: Future version will also sync to cloud API for Pro users
 */
export async function syncSessionToCloud(session: SyncSession): Promise<SyncResponse> {
  try {
    // Serialize context to JSON string for storage
    const encryptedContext = session.context
      ? JSON.stringify(session.context)
      : null;

    // Save to local PostgreSQL database using Prisma
    const savedSession = await prisma.session.create({
      data: {
        id: session.id,
        userId: session.userId,
        projectName: session.projectName,
        toolUsed: session.toolUsed,
        tokenCount: session.tokenCount,
        encryptedContext: encryptedContext,
        createdAt: session.createdAt,
        updatedAt: new Date(),
      },
    });

    // TODO: When cloud API is ready, also sync to cloud:
    // if (isPro && CLOUD_API_ENABLED) {
    //   await fetch(`${CLOUD_API_URL}/sessions`, { ... });
    // }

    return {
      success: true,
      sessionId: savedSession.id,
    };
  } catch (error) {
    console.error('Failed to sync session to local database:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}

/**
 * Fetch session from local PostgreSQL database
 * NOTE: Future version will also check cloud API
 */
export async function fetchSessionFromCloud(userId: string, sessionId: string): Promise<SyncSession | null> {
  try {
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        userId: userId,
      },
    });

    if (!session) {
      return null;
    }

    // Parse context back from JSON
    const context = session.encryptedContext
      ? JSON.parse(session.encryptedContext)
      : null;

    return {
      id: session.id,
      userId: session.userId,
      projectName: session.projectName,
      toolUsed: session.toolUsed,
      tokenCount: session.tokenCount,
      context: context,
      metadata: {}, // TODO: Parse from context or add metadata column
      createdAt: session.createdAt,
    };
  } catch (error) {
    console.error('Failed to fetch session from local database:', error);
    return null;
  }
}

/**
 * Delete session from local PostgreSQL database
 * NOTE: Uses soft delete (sets deletedAt timestamp)
 */
export async function deleteSessionFromCloud(userId: string, sessionId: string): Promise<boolean> {
  try {
    await prisma.session.update({
      where: {
        id: sessionId,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    return true;
  } catch (error) {
    console.error('Failed to delete session from local database:', error);
    return false;
  }
}

/**
 * Get usage statistics from local PostgreSQL database
 * NOTE: Future version will fetch from cloud API for real-time stats
 */
export async function getUsageStats(userId: string): Promise<SyncStats | null> {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get start of week (Sunday)
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    // Count sessions and sum tokens for today
    const todaySessions = await prisma.session.count({
      where: {
        userId: userId,
        createdAt: {
          gte: todayStart,
        },
        deletedAt: null,
      },
    });

    const todayTokens = await prisma.session.aggregate({
      where: {
        userId: userId,
        createdAt: {
          gte: todayStart,
        },
        deletedAt: null,
      },
      _sum: {
        tokenCount: true,
      },
    });

    // Count sessions and sum tokens for this week
    const weekSessions = await prisma.session.count({
      where: {
        userId: userId,
        createdAt: {
          gte: weekStart,
        },
        deletedAt: null,
      },
    });

    const weekTokens = await prisma.session.aggregate({
      where: {
        userId: userId,
        createdAt: {
          gte: weekStart,
        },
        deletedAt: null,
      },
      _sum: {
        tokenCount: true,
      },
    });

    // For local testing, quota is always 1M tokens
    const usedTokens = todayTokens._sum.tokenCount || 0;
    const quotaRemaining = Math.max(0, 1_000_000 - usedTokens);

    return {
      today: {
        sessions: todaySessions,
        tokens: todayTokens._sum.tokenCount || 0,
      },
      thisWeek: {
        sessions: weekSessions,
        tokens: weekTokens._sum.tokenCount || 0,
      },
      quotaRemaining,
    };
  } catch (error) {
    console.error('Failed to get usage stats from local database:', error);
    return null;
  }
}

/**
 * Verify API key with cloud
 * NOTE: For local testing, always returns true
 * In production, this will verify with cloud API
 */
export async function verifyApiKeyWithCloud(apiKey: string): Promise<boolean> {
  // TEMPORARY: For local testing, accept any API key
  // TODO: Implement real verification when cloud API is ready
  return apiKey.length > 0;
}

/**
 * Export all user data (GDPR compliance)
 * NOTE: For local testing, exports from local database
 * In production, this will export from cloud API
 */
export async function exportUserData(userId: string): Promise<any | null> {
  try {
    // Export all sessions for this user
    const sessions = await prisma.session.findMany({
      where: {
        userId: userId,
        deletedAt: null,
      },
      include: {
        files: true,
        tasks: true,
        memories: true,
      },
    });

    return {
      userId,
      exportedAt: new Date().toISOString(),
      sessionCount: sessions.length,
      sessions: sessions.map(session => ({
        id: session.id,
        projectName: session.projectName,
        toolUsed: session.toolUsed,
        tokenCount: session.tokenCount,
        createdAt: session.createdAt,
        files: session.files,
        tasks: session.tasks,
        memories: session.memories,
      })),
    };
  } catch (error) {
    console.error('Failed to export user data:', error);
    return null;
  }
}

/**
 * Cleanup: Close Prisma connection
 * Call this on server shutdown
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
