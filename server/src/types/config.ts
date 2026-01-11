// ====================
// Config Types
// ====================

export type EmbeddingProviderType = 'ollama' | 'huggingface' | 'transformers';

/**
 * Embedding configuration settings
 * Keys match environment variable names for consistency
 */
export interface EmbeddingSettings {
  enabled?: boolean;
  provider?: EmbeddingProviderType;
  HF_TOKEN?: string;
  HF_MODEL?: string;
  HF_ENDPOINT?: string;
  OLLAMA_ENDPOINT?: string;
  OLLAMA_MODEL?: string;
  TRANSFORMERS_MODEL?: string;
}

/**
 * Embedding provider interface
 * Abstraction for generating text embeddings for semantic search
 */
export interface EmbeddingProvider {
  name: string;
  model: string;
  dimensions: number;
  maxChars: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings?(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
}

/**
 * Result from embedding generation
 */
export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  provider: string;
}

/**
 * Provider-specific configuration for embedding creation
 */
export interface EmbeddingConfig {
  provider?: EmbeddingProviderType;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  transformersModel?: string;
  huggingfaceToken?: string;
  huggingfaceModel?: string;
}

/**
 * HuggingFace provider configuration
 */
export interface HuggingFaceConfig {
  /** HuggingFace API token (or set HF_TOKEN env var) */
  apiToken?: string;
  /** Model ID on HuggingFace Hub (default: sentence-transformers/all-MiniLM-L6-v2) */
  model?: string;
  /** API endpoint (default: https://router.huggingface.co/hf-inference) */
  endpoint?: string;
}

/**
 * Ollama provider configuration
 */
export interface OllamaConfig {
  /** Ollama server URL (default: http://localhost:11434) */
  endpoint?: string;
  /** Model to use (default: nomic-embed-text) */
  model?: string;
}

/**
 * Transformers.js provider configuration
 */
export interface TransformersConfig {
  /** Model to use (default: Xenova/all-MiniLM-L6-v2) */
  model?: string;
}

/**
 * Text chunking configuration for large content
 */
export interface ChunkConfig {
  maxChars: number;
  overlapChars: number;
}

/**
 * Result of text chunking
 */
export interface TextChunk {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
}

/**
 * SaveContext local configuration
 * Stored in ~/.savecontext/config.json
 */
export interface SaveContextLocalConfig {
  embeddings?: EmbeddingSettings;
}
