//! Embedding provider factory.
//!
//! Handles provider detection and creation.

use super::config::{get_embedding_settings, is_embeddings_enabled};
use super::huggingface::HuggingFaceProvider;
use super::ollama::OllamaProvider;
use super::provider::{BoxedProvider, EmbeddingProvider};
use super::types::EmbeddingProviderType;

/// Available provider detection result.
#[derive(Debug, Clone)]
pub struct ProviderDetection {
    /// List of available provider names.
    pub available: Vec<String>,
    /// Recommended provider (first available).
    pub recommended: Option<String>,
}

/// Detect which embedding providers are available.
pub async fn detect_available_providers() -> ProviderDetection {
    let mut available = Vec::new();

    // Check Ollama
    let ollama = OllamaProvider::new();
    if ollama.is_available().await {
        available.push("ollama".to_string());
    }

    // Check HuggingFace (available if token is set)
    if let Some(hf) = HuggingFaceProvider::new() {
        if hf.is_available().await {
            available.push("huggingface".to_string());
        }
    }

    // Note: We don't support transformers.js in Rust CLI
    // Users who need local inference without Ollama should use the TypeScript CLI

    let recommended = available.first().cloned();

    ProviderDetection {
        available,
        recommended,
    }
}

/// Create an embedding provider based on configuration.
///
/// Priority:
/// 1. Explicit provider in config
/// 2. Auto-detect available provider (Ollama preferred)
///
/// Returns `None` if no provider is available or embeddings are disabled.
pub async fn create_embedding_provider() -> Option<BoxedProvider> {
    // Check if embeddings are enabled
    if !is_embeddings_enabled() {
        return None;
    }

    // Check for explicit provider in config
    if let Ok(Some(settings)) = get_embedding_settings() {
        if let Some(provider_type) = settings.provider {
            return create_provider_by_type(provider_type).await;
        }
    }

    // Auto-detect: try Ollama first, then HuggingFace
    let ollama = OllamaProvider::new();
    if ollama.is_available().await {
        return Some(BoxedProvider::new(ollama));
    }

    if let Some(hf) = HuggingFaceProvider::new() {
        if hf.is_available().await {
            return Some(BoxedProvider::new(hf));
        }
    }

    None
}

/// Create a specific provider by type.
async fn create_provider_by_type(provider_type: EmbeddingProviderType) -> Option<BoxedProvider> {
    match provider_type {
        EmbeddingProviderType::Ollama => {
            let provider = OllamaProvider::new();
            if provider.is_available().await {
                Some(BoxedProvider::new(provider))
            } else {
                None
            }
        }
        EmbeddingProviderType::Huggingface => {
            HuggingFaceProvider::new().map(BoxedProvider::new)
        }
        EmbeddingProviderType::Transformers => {
            // Transformers.js is not supported in Rust CLI
            // Users should use Ollama or HuggingFace instead
            None
        }
        EmbeddingProviderType::Model2vec => {
            // Model2Vec is handled separately as fast tier
            // Use create_model2vec_provider() directly
            super::model2vec::Model2VecProvider::try_new().map(BoxedProvider::new)
        }
    }
}

/// Create a provider with explicit configuration (for testing or CLI overrides).
pub fn create_ollama_provider(endpoint: Option<String>, model: Option<String>) -> BoxedProvider {
    BoxedProvider::new(OllamaProvider::with_config(endpoint, model))
}

/// Create a HuggingFace provider with explicit configuration.
pub fn create_huggingface_provider(
    endpoint: Option<String>,
    model: Option<String>,
    token: Option<String>,
) -> Option<BoxedProvider> {
    HuggingFaceProvider::with_config(endpoint, model, token)
        .map(BoxedProvider::new)
}
