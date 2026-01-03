/**
 * Transformers.js Embedding Provider
 * Uses @xenova/transformers for in-process embedding generation
 * Works fully offline with no external dependencies
 */

import type { EmbeddingProvider } from '../../types/index.js';

/** Default model - all-MiniLM-L6-v2 has 384 dimensions */
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** Model dimensions mapping */
const MODEL_DIMENSIONS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 384,
  'Xenova/all-mpnet-base-v2': 768,
  'Xenova/bge-small-en-v1.5': 384,
};

/** Model max chars (conservative estimates based on token limits) */
const MODEL_MAX_CHARS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 800,    // 256 tokens
  'Xenova/all-mpnet-base-v2': 1200,  // ~384 tokens
  'Xenova/bge-small-en-v1.5': 1500,  // ~512 tokens
};

// Dynamic import for transformers - loaded on first use
let pipeline: any = null;
let extractor: any = null;

async function loadPipeline(model: string) {
  if (extractor) return extractor;

  try {
    // Dynamic import to avoid loading if not needed
    const { pipeline: pipelineFn } = await import('@xenova/transformers');
    pipeline = pipelineFn;
    extractor = await pipeline('feature-extraction', model);
    return extractor;
  } catch (error) {
    throw new Error(`Failed to load transformers model: ${error}`);
  }
}

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'transformers';
  readonly model: string;
  readonly dimensions: number;
  readonly maxChars: number;
  private extractorPromise: Promise<any> | null = null;

  constructor(options?: { model?: string }) {
    this.model = options?.model || process.env.TRANSFORMERS_MODEL || DEFAULT_MODEL;
    this.dimensions = MODEL_DIMENSIONS[this.model] || 384;
    this.maxChars = MODEL_MAX_CHARS[this.model] || 800;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if @xenova/transformers is installed
      await import('@xenova/transformers');
      return true;
    } catch {
      return false;
    }
  }

  private async getExtractor() {
    if (!this.extractorPromise) {
      this.extractorPromise = loadPipeline(this.model);
    }
    return this.extractorPromise;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();

    // Generate embedding
    const output = await extractor(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert to regular array
    return Array.from(output.data as Float32Array);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Process sequentially to avoid memory issues
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }
}
