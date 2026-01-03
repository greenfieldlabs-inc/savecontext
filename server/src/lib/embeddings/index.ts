/**
 * Embedding Library
 * Re-exports types and providers for semantic search embeddings
 */

// Re-export types from central types file
export type {
  EmbeddingProvider,
  EmbeddingResult,
  EmbeddingConfig,
  ChunkConfig,
  TextChunk,
} from '../../types/index.js';

export { OllamaEmbeddingProvider } from './ollama.js';
export { TransformersEmbeddingProvider } from './transformers.js';
export { HuggingFaceEmbeddingProvider, getSupportedModels } from './huggingface.js';
export { createEmbeddingProvider, detectAvailableProvider } from './factory.js';
export { chunkText, getChunkConfig, estimateChunkCount, CHUNK_DEFAULTS } from './chunker.js';
