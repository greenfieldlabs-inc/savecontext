//! Model2Vec embedding provider.
//!
//! Uses local Model2Vec static embeddings for instant embedding generation.
//! This is the "fast tier" provider in the 2-tier architecture - generates
//! embeddings in < 1ms for immediate semantic search.
//!
//! Model2Vec uses pre-computed word vectors with averaging, not neural inference,
//! which is why it's 200-800x faster than transformer-based providers.

use crate::error::{Error, Result};
use model2vec_rs::model::StaticModel;
use std::sync::Arc;

use super::provider::EmbeddingProvider;
use super::types::{model2vec_models, ProviderInfo};

/// Model2Vec embedding provider for fast embeddings.
///
/// Loads the model into memory on creation for instant inference.
/// Typical latency: < 1ms per embedding.
pub struct Model2VecProvider {
    /// The loaded Model2Vec model (Arc for thread-safety)
    model: Arc<StaticModel>,
    /// Model name (e.g., "minishlab/potion-base-8M")
    model_name: String,
    /// Output dimensions (256 for potion models)
    dimensions: usize,
    /// Maximum input characters
    max_chars: usize,
}

impl Model2VecProvider {
    /// Create a new Model2Vec provider with the default model (potion-base-8M).
    ///
    /// # Errors
    ///
    /// Returns an error if the model cannot be loaded from HuggingFace Hub.
    pub fn new() -> Result<Self> {
        Self::with_model(None)
    }

    /// Create a new Model2Vec provider with a custom model.
    ///
    /// # Arguments
    ///
    /// * `model_name` - Optional model name. Defaults to `minishlab/potion-base-8M`.
    ///
    /// # Errors
    ///
    /// Returns an error if the model cannot be loaded.
    pub fn with_model(model_name: Option<String>) -> Result<Self> {
        let model_name = model_name.unwrap_or_else(|| "minishlab/potion-base-8M".to_string());
        let config = model2vec_models::get_config(&model_name);

        let model = StaticModel::from_pretrained(
            &model_name,
            None, // No HF token needed for public models
            None, // Use default normalization
            None, // No subfolder
        )
        .map_err(|e| Error::Embedding(format!("Failed to load Model2Vec model '{}': {}", model_name, e)))?;

        Ok(Self {
            model: Arc::new(model),
            model_name,
            dimensions: config.dimensions,
            max_chars: config.max_chars,
        })
    }

    /// Try to create a provider, returning None if model loading fails.
    ///
    /// Useful for graceful fallback when Model2Vec isn't available.
    pub fn try_new() -> Option<Self> {
        Self::new().ok()
    }
}

impl EmbeddingProvider for Model2VecProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            name: "model2vec".to_string(),
            model: self.model_name.clone(),
            dimensions: self.dimensions,
            max_chars: self.max_chars,
            available: true, // If constructed, it's available
        }
    }

    async fn is_available(&self) -> bool {
        // Model2Vec is local - if we have the model loaded, it's available
        true
    }

    async fn generate_embedding(&self, text: &str) -> Result<Vec<f32>> {
        // Model2Vec encode expects Vec<String>
        let sentences = vec![text.to_string()];
        let embeddings = self.model.encode(&sentences);

        embeddings
            .into_iter()
            .next()
            .ok_or_else(|| Error::Embedding("Model2Vec returned no embeddings".into()))
    }

    async fn generate_embeddings(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        // Convert to owned strings for Model2Vec
        let sentences: Vec<String> = texts.iter().map(|&s| s.to_string()).collect();
        Ok(self.model.encode(&sentences))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model2vec_config() {
        let config = model2vec_models::get_config("minishlab/potion-base-8M");
        assert_eq!(config.dimensions, 256);
        assert!(config.max_chars > 0);
    }

    // Note: This test requires network access to download the model
    // #[tokio::test]
    // async fn test_model2vec_embedding() {
    //     let provider = Model2VecProvider::new().expect("Failed to load model");
    //     let embedding = provider.generate_embedding("Hello world").await.unwrap();
    //     assert_eq!(embedding.len(), 256);
    // }
}
