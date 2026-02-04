//! Embedding provider trait.
//!
//! Defines the interface that all embedding providers must implement.
//! Uses async methods for HTTP-based providers.

use crate::error::Result;
use super::types::ProviderInfo;

/// Trait for embedding providers.
///
/// Implemented by Ollama and HuggingFace providers.
/// The trait is object-safe to allow runtime provider selection.
pub trait EmbeddingProvider: Send + Sync {
    /// Get provider metadata.
    fn info(&self) -> ProviderInfo;

    /// Check if the provider is available.
    ///
    /// For Ollama, this checks if the server is running and the model is available.
    /// For HuggingFace, this checks if the API token is valid.
    fn is_available(&self) -> impl std::future::Future<Output = bool> + Send;

    /// Generate embedding for a single text.
    fn generate_embedding(&self, text: &str) -> impl std::future::Future<Output = Result<Vec<f32>>> + Send;

    /// Generate embeddings for multiple texts (batch).
    ///
    /// Default implementation calls `generate_embedding` for each text.
    fn generate_embeddings(&self, texts: &[&str]) -> impl std::future::Future<Output = Result<Vec<Vec<f32>>>> + Send {
        async move {
            let mut results = Vec::with_capacity(texts.len());
            for text in texts {
                results.push(self.generate_embedding(text).await?);
            }
            Ok(results)
        }
    }
}

/// Boxed provider for dynamic dispatch.
///
/// Since the trait has async methods with `impl Future`, we need this wrapper
/// for runtime polymorphism.
pub struct BoxedProvider {
    inner: Box<dyn EmbeddingProviderBoxed + Send + Sync>,
}

/// Object-safe version of EmbeddingProvider for boxing.
pub trait EmbeddingProviderBoxed: Send + Sync {
    fn info(&self) -> ProviderInfo;
    fn is_available_boxed(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + '_>>;
    fn generate_embedding_boxed(&self, text: &str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<f32>>> + Send + '_>>;
    fn generate_embeddings_boxed(&self, texts: &[&str]) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<Vec<f32>>>> + Send + '_>>;
}

impl BoxedProvider {
    /// Create a new boxed provider.
    pub fn new<P: EmbeddingProvider + 'static>(provider: P) -> Self {
        Self {
            inner: Box::new(BoxedProviderWrapper(provider)),
        }
    }

    /// Get provider metadata.
    pub fn info(&self) -> ProviderInfo {
        self.inner.info()
    }

    /// Check if the provider is available.
    pub async fn is_available(&self) -> bool {
        self.inner.is_available_boxed().await
    }

    /// Generate embedding for a single text.
    pub async fn generate_embedding(&self, text: &str) -> Result<Vec<f32>> {
        self.inner.generate_embedding_boxed(text).await
    }

    /// Generate embeddings for multiple texts (batch).
    pub async fn generate_embeddings(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        self.inner.generate_embeddings_boxed(texts).await
    }
}

/// Wrapper to implement EmbeddingProviderBoxed for any EmbeddingProvider.
struct BoxedProviderWrapper<P: EmbeddingProvider + 'static>(P);

impl<P: EmbeddingProvider + 'static> EmbeddingProviderBoxed for BoxedProviderWrapper<P> {
    fn info(&self) -> ProviderInfo {
        self.0.info()
    }

    fn is_available_boxed(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + '_>> {
        Box::pin(self.0.is_available())
    }

    fn generate_embedding_boxed(&self, text: &str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<f32>>> + Send + '_>> {
        // Convert to owned String to avoid lifetime issues with the future.
        // The underlying provider's generate_embedding takes &str, so we pass a reference
        // to the owned string in the async block.
        let text_owned = text.to_string();
        Box::pin(async move {
            // We need a reference that lives in this async block
            self.0.generate_embedding(&text_owned).await
        })
    }

    fn generate_embeddings_boxed(&self, texts: &[&str]) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<Vec<f32>>>> + Send + '_>> {
        // Convert to owned Strings to avoid lifetime issues.
        let texts_owned: Vec<String> = texts.iter().map(|s| (*s).to_string()).collect();
        Box::pin(async move {
            // Create references to the owned strings for the provider call
            let refs: Vec<&str> = texts_owned.iter().map(String::as_str).collect();
            self.0.generate_embeddings(&refs).await
        })
    }
}
