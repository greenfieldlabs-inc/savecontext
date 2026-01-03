/**
 * Ollama Embedding Provider
 * Uses local Ollama server for embedding generation
 */

import type { EmbeddingProvider } from '../../types/index.js';

/** Default Ollama endpoint */
const DEFAULT_ENDPOINT = 'http://localhost:11434';

/** Default embedding model - nomic-embed-text has 768 dimensions */
const DEFAULT_MODEL = 'nomic-embed-text';

/** Model dimensions mapping */
const MODEL_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
};

/** Model max chars (conservative estimates based on token limits) */
const MODEL_MAX_CHARS: Record<string, number> = {
  'nomic-embed-text': 5000,   // 2048 tokens * ~3.5 chars/token * 0.7 safety
  'mxbai-embed-large': 1500,  // 512 tokens
  'all-minilm': 800,          // 256 tokens
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly model: string;
  readonly dimensions: number;
  readonly maxChars: number;
  private endpoint: string;

  constructor(options?: { endpoint?: string; model?: string }) {
    this.endpoint = options?.endpoint || process.env.OLLAMA_ENDPOINT || DEFAULT_ENDPOINT;
    this.model = options?.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
    this.dimensions = MODEL_DIMENSIONS[this.model] || 768;
    this.maxChars = MODEL_MAX_CHARS[this.model] || 5000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });

      if (!response.ok) return false;

      const data = await response.json() as { models?: Array<{ name: string }> };
      const models = data.models || [];

      // Check if our embedding model is available
      const hasModel = models.some(m =>
        m.name === this.model ||
        m.name.startsWith(`${this.model}:`)
      );

      return hasModel;
    } catch {
      return false;
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${this.endpoint}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${error}`);
    }

    const data = await response.json() as { embeddings: number[][] };

    if (!data.embeddings || data.embeddings.length === 0) {
      throw new Error('No embeddings returned from Ollama');
    }

    return data.embeddings[0];
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.endpoint}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama batch embedding failed: ${error}`);
    }

    const data = await response.json() as { embeddings: number[][] };

    if (!data.embeddings) {
      throw new Error('No embeddings returned from Ollama');
    }

    return data.embeddings;
  }
}
