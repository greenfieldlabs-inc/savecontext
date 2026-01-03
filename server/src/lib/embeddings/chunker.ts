/**
 * Text chunking utility for embedding large content
 * Splits text into overlapping chunks to ensure full semantic coverage
 */

import type { ChunkConfig, TextChunk } from '../../types/index.js';

// Default configs per provider
export const CHUNK_DEFAULTS = {
  ollama: { maxChars: 5000, overlapChars: 500 },      // Safe for 2048 tokens
  huggingface: { maxChars: 5000, overlapChars: 500 }, // Most HF models handle this
  transformers: { maxChars: 800, overlapChars: 80 },  // 256 token limit
} as const;

/**
 * Split text into overlapping chunks for embedding
 * Small texts return a single chunk, large texts are split with overlap
 */
export function chunkText(text: string, config: ChunkConfig): TextChunk[] {
  // Single chunk if text fits
  if (text.length <= config.maxChars) {
    return [{
      index: 0,
      text,
      startChar: 0,
      endChar: text.length,
    }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + config.maxChars, text.length);

    chunks.push({
      index,
      text: text.slice(start, end),
      startChar: start,
      endChar: end,
    });

    // Move forward by (maxChars - overlap) to create overlap
    start += config.maxChars - config.overlapChars;
    index++;

    // Safety: prevent infinite loop if overlap >= maxChars
    if (config.overlapChars >= config.maxChars) {
      break;
    }
  }

  return chunks;
}

/**
 * Get the appropriate chunk config for a provider
 */
export function getChunkConfig(provider: 'ollama' | 'huggingface' | 'transformers', customMaxChars?: number): ChunkConfig {
  const defaults = CHUNK_DEFAULTS[provider] || CHUNK_DEFAULTS.ollama;

  if (customMaxChars && customMaxChars > 0) {
    return {
      maxChars: customMaxChars,
      overlapChars: Math.floor(customMaxChars * 0.1), // 10% overlap
    };
  }

  return defaults;
}

/**
 * Estimate chunk count for a text without actually chunking
 * Useful for progress estimation
 */
export function estimateChunkCount(textLength: number, config: ChunkConfig): number {
  if (textLength <= config.maxChars) return 1;

  const step = config.maxChars - config.overlapChars;
  return Math.ceil((textLength - config.overlapChars) / step);
}
