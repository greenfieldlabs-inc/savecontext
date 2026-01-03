/**
 * Embedding Provider Factory
 * Auto-detects and creates the best available embedding provider
 *
 * Priority: Config file > Environment variables > Defaults
 */

import type { EmbeddingProvider, EmbeddingConfig } from '../../types/index.js';
import { OllamaEmbeddingProvider } from './ollama.js';
import { TransformersEmbeddingProvider } from './transformers.js';
import { HuggingFaceEmbeddingProvider } from './huggingface.js';
import { getEmbeddingSettings } from '../../utils/config.js';
import type { EmbeddingSettings } from '../../types/index.js';

/**
 * Resolve configuration from config file and environment variables
 * Config file takes precedence over env vars
 */
function resolveConfig(): EmbeddingSettings {
  const fileConfig = getEmbeddingSettings() || {};

  return {
    enabled: fileConfig.enabled,
    provider: fileConfig.provider || process.env.SAVECONTEXT_EMBEDDING_PROVIDER as EmbeddingSettings['provider'],
    HF_TOKEN: fileConfig.HF_TOKEN || process.env.HF_TOKEN,
    HF_MODEL: fileConfig.HF_MODEL || process.env.HF_MODEL,
    HF_ENDPOINT: fileConfig.HF_ENDPOINT || process.env.HF_ENDPOINT,
    OLLAMA_ENDPOINT: fileConfig.OLLAMA_ENDPOINT || process.env.OLLAMA_ENDPOINT,
    OLLAMA_MODEL: fileConfig.OLLAMA_MODEL || process.env.OLLAMA_MODEL,
    TRANSFORMERS_MODEL: fileConfig.TRANSFORMERS_MODEL || process.env.TRANSFORMERS_MODEL,
  };
}

/**
 * Detect which embedding providers are available
 * Returns providers in order of preference
 */
export async function detectAvailableProvider(): Promise<{
  available: string[];
  recommended: string | null;
}> {
  const available: string[] = [];
  const config = resolveConfig();

  // Check Ollama first (preferred for performance, local)
  const ollama = new OllamaEmbeddingProvider({
    endpoint: config.OLLAMA_ENDPOINT,
    model: config.OLLAMA_MODEL,
  });
  if (await ollama.isAvailable()) {
    available.push('ollama');
  }

  // Check HuggingFace (cloud option with custom models)
  const huggingface = new HuggingFaceEmbeddingProvider({
    apiToken: config.HF_TOKEN,
    model: config.HF_MODEL,
    endpoint: config.HF_ENDPOINT,
  });
  if (await huggingface.isAvailable()) {
    available.push('huggingface');
  }

  // Check Transformers.js (fallback, always works if installed)
  const transformers = new TransformersEmbeddingProvider({
    model: config.TRANSFORMERS_MODEL,
  });
  if (await transformers.isAvailable()) {
    available.push('transformers');
  }

  return {
    available,
    recommended: available[0] || null,
  };
}

/**
 * Create an embedding provider based on configuration or auto-detection
 * Returns null if no provider is available
 */
export async function createEmbeddingProvider(
  explicitConfig?: EmbeddingConfig
): Promise<EmbeddingProvider | null> {
  const config = resolveConfig();

  // Check if embeddings are disabled
  if (config.enabled === false) {
    return null;
  }

  // Explicit config overrides resolved config
  const provider = explicitConfig?.provider || config.provider;

  if (provider === 'ollama') {
    const ollamaProvider = new OllamaEmbeddingProvider({
      endpoint: explicitConfig?.ollamaEndpoint || config.OLLAMA_ENDPOINT,
      model: explicitConfig?.ollamaModel || config.OLLAMA_MODEL,
    });

    if (await ollamaProvider.isAvailable()) {
      return ollamaProvider;
    }

    console.warn('[SaveContext] Ollama provider configured but not available');
    return null;
  }

  if (provider === 'transformers') {
    const transformersProvider = new TransformersEmbeddingProvider({
      model: explicitConfig?.transformersModel || config.TRANSFORMERS_MODEL,
    });

    if (await transformersProvider.isAvailable()) {
      return transformersProvider;
    }

    console.warn('[SaveContext] Transformers provider configured but not available');
    return null;
  }

  if (provider === 'huggingface') {
    const hfProvider = new HuggingFaceEmbeddingProvider({
      apiToken: explicitConfig?.huggingfaceToken || config.HF_TOKEN,
      model: explicitConfig?.huggingfaceModel || config.HF_MODEL,
      endpoint: config.HF_ENDPOINT,
    });

    if (await hfProvider.isAvailable()) {
      return hfProvider;
    }

    console.warn('[SaveContext] HuggingFace provider configured but not available');
    return null;
  }

  // Auto-detect: try Ollama first, then Transformers
  const ollama = new OllamaEmbeddingProvider({
    endpoint: config.OLLAMA_ENDPOINT,
    model: config.OLLAMA_MODEL,
  });

  if (await ollama.isAvailable()) {
    return ollama;
  }

  const transformers = new TransformersEmbeddingProvider({
    model: config.TRANSFORMERS_MODEL,
  });

  if (await transformers.isAvailable()) {
    return transformers;
  }

  return null;
}

/**
 * Get embedding provider info for status display
 */
export function getProviderInfo(provider: EmbeddingProvider | null): {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  dimensions: number | null;
} {
  if (!provider) {
    return {
      enabled: false,
      provider: null,
      model: null,
      dimensions: null,
    };
  }

  return {
    enabled: true,
    provider: provider.name,
    model: provider.model,
    dimensions: provider.dimensions,
  };
}
