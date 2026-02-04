//! Ollama embedding provider.
//!
//! Uses local Ollama server for embedding generation.
//! This is the recommended provider for local development.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

use super::config::{resolve_ollama_endpoint, resolve_ollama_model};
use super::provider::EmbeddingProvider;
use super::types::{ollama_models, ProviderInfo};

/// Ollama embedding provider.
pub struct OllamaProvider {
    client: reqwest::Client,
    endpoint: String,
    model: String,
    dimensions: usize,
    max_chars: usize,
}

impl OllamaProvider {
    /// Create a new Ollama provider with default configuration.
    pub fn new() -> Self {
        Self::with_config(None, None)
    }

    /// Create a new Ollama provider with custom configuration.
    pub fn with_config(endpoint: Option<String>, model: Option<String>) -> Self {
        let endpoint = endpoint.unwrap_or_else(resolve_ollama_endpoint);
        let model = model.unwrap_or_else(resolve_ollama_model);
        let config = ollama_models::get_config(&model);

        Self {
            client: reqwest::Client::new(),
            endpoint,
            model,
            dimensions: config.dimensions,
            max_chars: config.max_chars,
        }
    }
}

impl Default for OllamaProvider {
    fn default() -> Self {
        Self::new()
    }
}

/// Ollama API response for listing models.
#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Option<Vec<OllamaModel>>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    name: String,
}

/// Ollama API request for embedding.
#[derive(Debug, Serialize)]
struct OllamaEmbedRequest<'a> {
    model: &'a str,
    input: EmbedInput<'a>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum EmbedInput<'a> {
    Single(&'a str),
    Batch(Vec<&'a str>),
}

/// Ollama API response for embedding.
#[derive(Debug, Deserialize)]
struct OllamaEmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

impl EmbeddingProvider for OllamaProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            name: "ollama".to_string(),
            model: self.model.clone(),
            dimensions: self.dimensions,
            max_chars: self.max_chars,
            available: false, // Will be checked by is_available()
        }
    }

    async fn is_available(&self) -> bool {
        let url = format!("{}/api/tags", self.endpoint);

        let response = match self.client
            .get(&url)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => return false,
        };

        if !response.status().is_success() {
            return false;
        }

        let data: OllamaTagsResponse = match response.json().await {
            Ok(d) => d,
            Err(_) => return false,
        };

        // Check if our model is available
        data.models.map_or(false, |models| {
            models.iter().any(|m| {
                m.name == self.model || m.name.starts_with(&format!("{}:", self.model))
            })
        })
    }

    async fn generate_embedding(&self, text: &str) -> Result<Vec<f32>> {
        let url = format!("{}/api/embed", self.endpoint);

        let request = OllamaEmbedRequest {
            model: &self.model,
            input: EmbedInput::Single(text),
        };

        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| Error::Embedding(format!("Ollama request failed: {e}")))?;

        if !response.status().is_success() {
            let error = response.text().await.unwrap_or_default();
            return Err(Error::Embedding(format!("Ollama embedding failed: {error}")));
        }

        let data: OllamaEmbedResponse = response.json().await
            .map_err(|e| Error::Embedding(format!("Failed to parse Ollama response: {e}")))?;

        data.embeddings.into_iter().next()
            .ok_or_else(|| Error::Embedding("No embeddings returned from Ollama".into()))
    }

    async fn generate_embeddings(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        let url = format!("{}/api/embed", self.endpoint);

        let request = OllamaEmbedRequest {
            model: &self.model,
            input: EmbedInput::Batch(texts.to_vec()),
        };

        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| Error::Embedding(format!("Ollama batch request failed: {e}")))?;

        if !response.status().is_success() {
            let error = response.text().await.unwrap_or_default();
            return Err(Error::Embedding(format!("Ollama batch embedding failed: {error}")));
        }

        let data: OllamaEmbedResponse = response.json().await
            .map_err(|e| Error::Embedding(format!("Failed to parse Ollama response: {e}")))?;

        Ok(data.embeddings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ollama_provider_creation() {
        let provider = OllamaProvider::new();
        let info = provider.info();
        assert_eq!(info.name, "ollama");
        assert!(!info.model.is_empty());
        assert!(info.dimensions > 0);
    }

    #[test]
    fn test_ollama_provider_custom_config() {
        let provider = OllamaProvider::with_config(
            Some("http://custom:11434".to_string()),
            Some("mxbai-embed-large".to_string()),
        );
        let info = provider.info();
        assert_eq!(info.model, "mxbai-embed-large");
        assert_eq!(info.dimensions, 1024);
    }
}
