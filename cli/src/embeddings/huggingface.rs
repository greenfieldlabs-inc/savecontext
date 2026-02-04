//! HuggingFace Inference API embedding provider.
//!
//! Uses HuggingFace's hosted inference API for embedding generation.
//! Requires a HuggingFace API token (HF_TOKEN).

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

use super::config::{resolve_hf_endpoint, resolve_hf_model, resolve_hf_token};
use super::provider::EmbeddingProvider;
use super::types::{huggingface_models, ProviderInfo};

/// HuggingFace Inference API embedding provider.
pub struct HuggingFaceProvider {
    client: reqwest::Client,
    endpoint: String,
    model: String,
    token: String,
    dimensions: usize,
    max_chars: usize,
}

impl HuggingFaceProvider {
    /// Create a new HuggingFace provider with default configuration.
    ///
    /// Returns `None` if no API token is configured.
    pub fn new() -> Option<Self> {
        Self::with_config(None, None, None)
    }

    /// Create a new HuggingFace provider with custom configuration.
    ///
    /// Returns `None` if no API token is available.
    pub fn with_config(
        endpoint: Option<String>,
        model: Option<String>,
        token: Option<String>,
    ) -> Option<Self> {
        let token = token.or_else(resolve_hf_token)?;
        let endpoint = endpoint.unwrap_or_else(resolve_hf_endpoint);
        let model = model.unwrap_or_else(resolve_hf_model);
        let config = huggingface_models::get_config(&model);

        Some(Self {
            client: reqwest::Client::new(),
            endpoint,
            model,
            token,
            dimensions: config.dimensions,
            max_chars: config.max_chars,
        })
    }
}

/// HuggingFace API request for feature extraction.
#[derive(Debug, Serialize)]
struct HfEmbedRequest<'a> {
    inputs: HfInputs<'a>,
    options: HfOptions,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum HfInputs<'a> {
    Single(&'a str),
    Batch(Vec<&'a str>),
}

#[derive(Debug, Serialize)]
struct HfOptions {
    wait_for_model: bool,
}

/// HuggingFace API response - can be single or batch embeddings.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum HfEmbedResponse {
    /// Single embedding (nested array for sentence-transformers)
    Single(Vec<Vec<f32>>),
    /// Batch embeddings
    Batch(Vec<Vec<Vec<f32>>>),
    /// Direct embedding (some models)
    Direct(Vec<f32>),
}

impl EmbeddingProvider for HuggingFaceProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            name: "huggingface".to_string(),
            model: self.model.clone(),
            dimensions: self.dimensions,
            max_chars: self.max_chars,
            available: false,
        }
    }

    async fn is_available(&self) -> bool {
        // HuggingFace is available if we have a token
        // We could also ping the API, but that uses rate limit quota
        !self.token.is_empty()
    }

    async fn generate_embedding(&self, text: &str) -> Result<Vec<f32>> {
        let url = format!("{}/models/{}/pipeline/feature-extraction", self.endpoint, self.model);

        let request = HfEmbedRequest {
            inputs: HfInputs::Single(text),
            options: HfOptions { wait_for_model: true },
        };

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .json(&request)
            .send()
            .await
            .map_err(|e| Error::Embedding(format!("HuggingFace request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let error = response.text().await.unwrap_or_default();
            return Err(Error::Embedding(format!(
                "HuggingFace API error ({status}): {error}"
            )));
        }

        let data: HfEmbedResponse = response.json().await
            .map_err(|e| Error::Embedding(format!("Failed to parse HuggingFace response: {e}")))?;

        // Handle different response formats
        match data {
            HfEmbedResponse::Single(nested) => {
                // sentence-transformers returns [[embedding]]
                nested.into_iter().next()
                    .ok_or_else(|| Error::Embedding("No embeddings in response".into()))
            }
            HfEmbedResponse::Direct(embedding) => Ok(embedding),
            HfEmbedResponse::Batch(batch) => {
                batch.into_iter()
                    .next()
                    .and_then(|nested| nested.into_iter().next())
                    .ok_or_else(|| Error::Embedding("No embeddings in batch response".into()))
            }
        }
    }

    async fn generate_embeddings(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        let url = format!("{}/models/{}/pipeline/feature-extraction", self.endpoint, self.model);

        let request = HfEmbedRequest {
            inputs: HfInputs::Batch(texts.to_vec()),
            options: HfOptions { wait_for_model: true },
        };

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .json(&request)
            .send()
            .await
            .map_err(|e| Error::Embedding(format!("HuggingFace batch request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let error = response.text().await.unwrap_or_default();
            return Err(Error::Embedding(format!(
                "HuggingFace API error ({status}): {error}"
            )));
        }

        let data: HfEmbedResponse = response.json().await
            .map_err(|e| Error::Embedding(format!("Failed to parse HuggingFace response: {e}")))?;

        // Handle different response formats
        match data {
            HfEmbedResponse::Batch(batch) => {
                // sentence-transformers returns [[[embedding1]], [[embedding2]], ...]
                Ok(batch.into_iter()
                    .filter_map(|nested| nested.into_iter().next())
                    .collect())
            }
            HfEmbedResponse::Single(nested) => {
                // Single response for batch of 1
                Ok(nested)
            }
            HfEmbedResponse::Direct(embedding) => {
                // Direct embedding for batch of 1
                Ok(vec![embedding])
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_huggingface_provider_with_explicit_none_token() {
        // When explicitly passing None for token and no config/env, behavior depends
        // on config file. The key assertion is that if a provider IS created,
        // it must have a valid (non-empty) token.
        let provider = HuggingFaceProvider::with_config(None, None, None);
        // Can't assert None because there might be a config file or env var with token
        if let Some(p) = provider {
            assert!(!p.token.is_empty(), "Provider token should not be empty");
        }
    }

    #[test]
    fn test_huggingface_provider_with_token() {
        let provider = HuggingFaceProvider::with_config(
            None,
            Some("sentence-transformers/all-MiniLM-L6-v2".to_string()),
            Some("test-token".to_string()),
        );
        assert!(provider.is_some());
        let p = provider.unwrap();
        let info = p.info();
        assert_eq!(info.name, "huggingface");
        assert_eq!(info.dimensions, 384);
        assert_eq!(p.token, "test-token");
    }

    #[test]
    fn test_huggingface_provider_uses_custom_model() {
        let provider = HuggingFaceProvider::with_config(
            None,
            Some("sentence-transformers/all-mpnet-base-v2".to_string()),
            Some("test-token".to_string()),
        );
        assert!(provider.is_some());
        let info = provider.unwrap().info();
        assert_eq!(info.model, "sentence-transformers/all-mpnet-base-v2");
        assert_eq!(info.dimensions, 768); // mpnet-base-v2 has 768 dimensions
    }
}
