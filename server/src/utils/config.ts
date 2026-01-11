/**
 * SaveContext Configuration
 * Handles persistent storage of local settings
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type {
  SaveContextLocalConfig,
  EmbeddingSettings,
} from '../types/index.js';

// Configuration directory and file paths
const CONFIG_DIR = join(homedir(), '.savecontext');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load configuration
 */
export function loadConfig(): SaveContextLocalConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return defaults on error
  }
  return {};
}

/**
 * Save configuration
 */
export function saveConfig(config: SaveContextLocalConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ====================
// Embedding Configuration
// ====================

/**
 * Get embedding settings from config file
 */
export function getEmbeddingSettings(): EmbeddingSettings | undefined {
  const config = loadConfig();
  return config.embeddings;
}

/**
 * Save embedding settings (merges with existing config)
 */
export function saveEmbeddingSettings(settings: EmbeddingSettings): void {
  const config = loadConfig();
  config.embeddings = {
    ...config.embeddings,
    ...settings,
  };
  saveConfig(config);
}

/**
 * Reset embedding settings (removes from config)
 */
export function resetEmbeddingSettings(): void {
  const config = loadConfig();
  delete config.embeddings;
  saveConfig(config);
}
