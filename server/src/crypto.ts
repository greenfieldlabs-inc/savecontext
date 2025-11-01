/**
 * Crypto Module - Secure API Key Storage
 *
 * Uses OS keychain (macOS Keychain, Windows Credential Manager) for secure storage.
 * Falls back to encrypted file storage if keychain is unavailable.
 */

import keytar from 'keytar';
import bcrypt from 'bcryptjs';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const SERVICE_NAME = 'savecontext';
const BCRYPT_ROUNDS = 12;

/**
 * Store API key securely in OS keychain
 */
export async function storeApiKey(userId: string, apiKey: string): Promise<void> {
  try {
    await keytar.setPassword(SERVICE_NAME, userId, apiKey);
  } catch (error) {
    // Fallback to encrypted file storage if keychain fails
    await storeApiKeyFallback(userId, apiKey);
  }
}

/**
 * Retrieve API key from OS keychain
 */
export async function getApiKey(userId: string): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE_NAME, userId);
  } catch (error) {
    // Try fallback storage
    return await getApiKeyFallback(userId);
  }
}

/**
 * Delete API key from OS keychain
 */
export async function deleteApiKey(userId: string): Promise<boolean> {
  try {
    const deleted = await keytar.deletePassword(SERVICE_NAME, userId);
    // Also try to delete from fallback
    await deleteApiKeyFallback(userId);
    return deleted;
  } catch (error) {
    return false;
  }
}

/**
 * Hash API key for database storage (one-way)
 * Used for lookup/verification, NOT for retrieval
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  return await bcrypt.hash(apiKey, BCRYPT_ROUNDS);
}

/**
 * Verify API key against stored hash
 */
export async function verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(apiKey, hash);
}

/**
 * Generate a new API key
 * Format: ck_{live|test}_{32 random chars}
 */
export function generateApiKey(isLive: boolean = false): string {
  const prefix = isLive ? 'ck_live' : 'ck_test';
  const randomPart = randomBytes(16).toString('hex'); // 32 chars
  return `${prefix}_${randomPart}`;
}

// ============================================================================
// Fallback Storage (Encrypted Files) - Used if keychain unavailable
// ============================================================================

const FALLBACK_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.savecontext', 'keys');
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'savecontext-fallback-key-change-in-prod';

async function ensureFallbackDir(): Promise<void> {
  try {
    await fs.mkdir(FALLBACK_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

async function storeApiKeyFallback(userId: string, apiKey: string): Promise<void> {
  await ensureFallbackDir();

  // Encrypt API key
  const iv = randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const cipher = createCipheriv('aes-256-cbc', key, iv);

  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Store IV + encrypted data
  const data = {
    iv: iv.toString('hex'),
    encrypted,
  };

  const filePath = path.join(FALLBACK_DIR, `${userId}.json`);
  await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
}

async function getApiKeyFallback(userId: string): Promise<string | null> {
  try {
    const filePath = path.join(FALLBACK_DIR, `${userId}.json`);
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);

    // Decrypt API key
    const iv = Buffer.from(data.iv, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const decipher = createDecipheriv('aes-256-cbc', key, iv);

    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    return null;
  }
}

async function deleteApiKeyFallback(userId: string): Promise<void> {
  try {
    const filePath = path.join(FALLBACK_DIR, `${userId}.json`);
    await fs.unlink(filePath);
  } catch (error) {
    // File might not exist
  }
}
