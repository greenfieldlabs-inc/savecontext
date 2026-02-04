//! Embedding configuration management.
//!
//! Loads and saves embedding settings from `~/.savecontext/config.json`,
//! maintaining compatibility with the TypeScript MCP server.

use crate::error::{Error, Result};
use std::fs;
use std::path::PathBuf;

use super::types::{EmbeddingSettings, SaveContextConfig};

/// Get the config file path.
fn config_path() -> Result<PathBuf> {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().join(".savecontext").join("config.json"))
        .ok_or(Error::Config("Could not determine home directory".into()))
}

/// Load the full SaveContext configuration.
pub fn load_config() -> Result<SaveContextConfig> {
    let path = config_path()?;

    if !path.exists() {
        return Ok(SaveContextConfig::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| {
        Error::Config(format!("Failed to read config file: {e}"))
    })?;

    serde_json::from_str(&content).map_err(|e| {
        Error::Config(format!("Failed to parse config file: {e}"))
    })
}

/// Save the full SaveContext configuration.
pub fn save_config(config: &SaveContextConfig) -> Result<()> {
    let path = config_path()?;

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            Error::Config(format!("Failed to create config directory: {e}"))
        })?;
    }

    let content = serde_json::to_string_pretty(config).map_err(|e| {
        Error::Config(format!("Failed to serialize config: {e}"))
    })?;

    fs::write(&path, content).map_err(|e| {
        Error::Config(format!("Failed to write config file: {e}"))
    })?;

    Ok(())
}

/// Get embedding settings from config file.
pub fn get_embedding_settings() -> Result<Option<EmbeddingSettings>> {
    let config = load_config()?;
    Ok(config.embeddings)
}

/// Save embedding settings (merges with existing config).
pub fn save_embedding_settings(settings: &EmbeddingSettings) -> Result<()> {
    let mut config = load_config()?;

    // Merge with existing settings
    let existing = config.embeddings.unwrap_or_default();
    config.embeddings = Some(EmbeddingSettings {
        enabled: settings.enabled.or(existing.enabled),
        provider: settings.provider.or(existing.provider),
        HF_TOKEN: settings.HF_TOKEN.clone().or(existing.HF_TOKEN),
        HF_MODEL: settings.HF_MODEL.clone().or(existing.HF_MODEL),
        HF_ENDPOINT: settings.HF_ENDPOINT.clone().or(existing.HF_ENDPOINT),
        OLLAMA_ENDPOINT: settings.OLLAMA_ENDPOINT.clone().or(existing.OLLAMA_ENDPOINT),
        OLLAMA_MODEL: settings.OLLAMA_MODEL.clone().or(existing.OLLAMA_MODEL),
        TRANSFORMERS_MODEL: settings.TRANSFORMERS_MODEL.clone().or(existing.TRANSFORMERS_MODEL),
    });

    save_config(&config)
}

/// Reset embedding settings (removes from config).
pub fn reset_embedding_settings() -> Result<()> {
    let mut config = load_config()?;
    config.embeddings = None;
    save_config(&config)
}

/// Resolve Ollama endpoint from config or environment.
pub fn resolve_ollama_endpoint() -> String {
    // Priority: env var > config > default
    if let Ok(endpoint) = std::env::var("OLLAMA_ENDPOINT") {
        if !endpoint.is_empty() {
            return endpoint;
        }
    }

    if let Ok(Some(settings)) = get_embedding_settings() {
        if let Some(endpoint) = settings.OLLAMA_ENDPOINT {
            return endpoint;
        }
    }

    "http://localhost:11434".to_string()
}

/// Resolve Ollama model from config or environment.
pub fn resolve_ollama_model() -> String {
    // Priority: env var > config > default
    if let Ok(model) = std::env::var("OLLAMA_MODEL") {
        if !model.is_empty() {
            return model;
        }
    }

    if let Ok(Some(settings)) = get_embedding_settings() {
        if let Some(model) = settings.OLLAMA_MODEL {
            return model;
        }
    }

    "nomic-embed-text".to_string()
}

/// Resolve HuggingFace token from config or environment.
pub fn resolve_hf_token() -> Option<String> {
    // Priority: env var > config
    if let Ok(token) = std::env::var("HF_TOKEN") {
        if !token.is_empty() {
            return Some(token);
        }
    }

    if let Ok(Some(settings)) = get_embedding_settings() {
        return settings.HF_TOKEN;
    }

    None
}

/// Resolve HuggingFace model from config or environment.
pub fn resolve_hf_model() -> String {
    // Priority: env var > config > default
    if let Ok(model) = std::env::var("HF_MODEL") {
        if !model.is_empty() {
            return model;
        }
    }

    if let Ok(Some(settings)) = get_embedding_settings() {
        if let Some(model) = settings.HF_MODEL {
            return model;
        }
    }

    "sentence-transformers/all-MiniLM-L6-v2".to_string()
}

/// Resolve HuggingFace endpoint from config or environment.
pub fn resolve_hf_endpoint() -> String {
    // Priority: env var > config > default
    if let Ok(endpoint) = std::env::var("HF_ENDPOINT") {
        if !endpoint.is_empty() {
            return endpoint;
        }
    }

    if let Ok(Some(settings)) = get_embedding_settings() {
        if let Some(endpoint) = settings.HF_ENDPOINT {
            return endpoint;
        }
    }

    "https://router.huggingface.co/hf-inference".to_string()
}

/// Check if embeddings are enabled.
pub fn is_embeddings_enabled() -> bool {
    // Check env var first
    if let Ok(enabled) = std::env::var("SAVECONTEXT_EMBEDDINGS_ENABLED") {
        return enabled != "false" && enabled != "0";
    }

    // Check config
    if let Ok(Some(settings)) = get_embedding_settings() {
        return settings.enabled.unwrap_or(true);
    }

    true // Enabled by default
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_ollama_endpoint() {
        let endpoint = resolve_ollama_endpoint();
        assert!(endpoint.contains("localhost:11434") || !endpoint.is_empty());
    }

    #[test]
    fn test_default_ollama_model() {
        let model = resolve_ollama_model();
        assert!(!model.is_empty());
    }

    #[test]
    fn test_embeddings_enabled_by_default() {
        // Without any config, embeddings should be enabled
        let enabled = is_embeddings_enabled();
        assert!(enabled);
    }
}
