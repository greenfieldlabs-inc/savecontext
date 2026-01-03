/**
 * HuggingFace Inference API Embedding Provider
 * Uses HuggingFace's serverless inference API for embeddings
 * Supports any embedding model hosted on HuggingFace Hub
 */

import type { EmbeddingProvider, HuggingFaceConfig } from '../../types/index.js';

// Common model dimensions lookup
const MODEL_DIMENSIONS: Record<string, number> = {
  'sentence-transformers/all-MiniLM-L6-v2': 384,
  'sentence-transformers/all-mpnet-base-v2': 768,
  'sentence-transformers/paraphrase-MiniLM-L6-v2': 384,
  'BAAI/bge-small-en-v1.5': 384,
  'BAAI/bge-base-en-v1.5': 768,
  'BAAI/bge-large-en-v1.5': 1024,
  'thenlper/gte-small': 384,
  'thenlper/gte-base': 768,
  'thenlper/gte-large': 1024,
  'nomic-ai/nomic-embed-text-v1': 768,
  'nomic-ai/nomic-embed-text-v1.5': 768,
  'intfloat/e5-small-v2': 384,
  'intfloat/e5-base-v2': 768,
  'intfloat/e5-large-v2': 1024,
  'intfloat/multilingual-e5-small': 384,
  'intfloat/multilingual-e5-base': 768,
  'intfloat/multilingual-e5-large': 1024,
};

// Model max chars (conservative estimates based on token limits)
const MODEL_MAX_CHARS: Record<string, number> = {
  'sentence-transformers/all-MiniLM-L6-v2': 800,    // 256 tokens
  'sentence-transformers/all-mpnet-base-v2': 1200,  // 384 tokens
  'BAAI/bge-small-en-v1.5': 1500,                   // 512 tokens
  'BAAI/bge-base-en-v1.5': 1500,
  'BAAI/bge-large-en-v1.5': 1500,
  'thenlper/gte-small': 1500,
  'thenlper/gte-base': 1500,
  'thenlper/gte-large': 1500,
  'nomic-ai/nomic-embed-text-v1': 5000,             // 2048 tokens (actual)
  'nomic-ai/nomic-embed-text-v1.5': 5000,
  'intfloat/e5-small-v2': 1500,
  'intfloat/e5-base-v2': 1500,
  'intfloat/e5-large-v2': 1500,
};

const DEFAULT_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const DEFAULT_ENDPOINT = 'https://router.huggingface.co/hf-inference';

export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'huggingface';
  readonly model: string;
  readonly dimensions: number;
  readonly maxChars: number;
  private endpoint: string;
  private apiToken: string | undefined;

  constructor(config: HuggingFaceConfig = {}) {
    this.model = config.model || process.env.HF_MODEL || DEFAULT_MODEL;
    this.endpoint = config.endpoint || process.env.HF_ENDPOINT || DEFAULT_ENDPOINT;
    this.apiToken = config.apiToken || process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;

    // Get dimensions and max chars from lookup or defaults
    this.dimensions = MODEL_DIMENSIONS[this.model] || 768;
    this.maxChars = MODEL_MAX_CHARS[this.model] || 1500;
  }

  async isAvailable(): Promise<boolean> {
    // HuggingFace API requires a token for most models
    if (!this.apiToken) {
      return false;
    }

    try {
      // Quick test with minimal input using feature-extraction pipeline
      // 5 second timeout for availability check
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(
        `${this.endpoint}/models/${this.model}/pipeline/feature-extraction`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: 'test' }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      // Model might be loading (503), that's okay
      if (response.status === 503) {
        const data = await response.json() as { error?: string };
        // Model is loading, consider it available
        if (data.error?.includes('loading')) {
          return true;
        }
      }

      return response.ok;
    } catch {
      return false;
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch(
      `${this.endpoint}/models/${this.model}/pipeline/feature-extraction`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: text,
          options: { wait_for_model: true },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HuggingFace API error: ${response.status} - ${error}`);
    }

    const result = await response.json();

    // Handle different response formats
    // Some models return [[embedding]], others return [embedding]
    if (Array.isArray(result)) {
      if (Array.isArray(result[0])) {
        // Token-level embeddings: [[tok1], [tok2], ...] - mean pool
        if (Array.isArray(result[0][0])) {
          return this.meanPool(result[0] as number[][]);
        }
        return result[0] as number[];
      }
      return result as number[];
    }

    throw new Error('Unexpected embedding response format');
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await fetch(
      `${this.endpoint}/models/${this.model}/pipeline/feature-extraction`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: texts,
          options: { wait_for_model: true },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HuggingFace API error: ${response.status} - ${error}`);
    }

    const result = await response.json() as number[][][] | number[][];

    // Handle batch response format
    if (Array.isArray(result) && Array.isArray(result[0])) {
      // Check if we need to mean pool (token-level embeddings)
      if (Array.isArray(result[0][0])) {
        return (result as number[][][]).map(r => this.meanPool(r as number[][]));
      }
      return result as number[][];
    }

    throw new Error('Unexpected batch embedding response format');
  }

  /**
   * Mean pooling for token-level embeddings
   */
  private meanPool(tokenEmbeddings: number[][]): number[] {
    if (tokenEmbeddings.length === 0) {
      throw new Error('No token embeddings to pool');
    }

    const dims = tokenEmbeddings[0].length;
    const result = new Array(dims).fill(0);

    for (const token of tokenEmbeddings) {
      for (let i = 0; i < dims; i++) {
        result[i] += token[i];
      }
    }

    const numTokens = tokenEmbeddings.length;
    for (let i = 0; i < dims; i++) {
      result[i] /= numTokens;
    }

    return result;
  }
}

/**
 * Get list of supported models with their dimensions
 */
export function getSupportedModels(): { model: string; dimensions: number }[] {
  return Object.entries(MODEL_DIMENSIONS).map(([model, dimensions]) => ({
    model,
    dimensions,
  }));
}
