//! Embedding types and configuration.
//!
//! Mirrors the TypeScript `EmbeddingSettings` and `EmbeddingProvider` interfaces
//! to maintain config compatibility with `~/.savecontext/config.json`.

use serde::{Deserialize, Serialize};

/// Embedding provider types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmbeddingProviderType {
    Ollama,
    Huggingface,
    Transformers,
    /// Model2Vec - fast static embeddings for 2-tier architecture
    Model2vec,
}

impl std::fmt::Display for EmbeddingProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ollama => write!(f, "ollama"),
            Self::Huggingface => write!(f, "huggingface"),
            Self::Transformers => write!(f, "transformers"),
            Self::Model2vec => write!(f, "model2vec"),
        }
    }
}

/// Embedding settings stored in `~/.savecontext/config.json`.
///
/// Field names match TypeScript implementation for compatibility.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct EmbeddingSettings {
    pub enabled: Option<bool>,
    pub provider: Option<EmbeddingProviderType>,
    pub HF_TOKEN: Option<String>,
    pub HF_MODEL: Option<String>,
    pub HF_ENDPOINT: Option<String>,
    pub OLLAMA_ENDPOINT: Option<String>,
    pub OLLAMA_MODEL: Option<String>,
    pub TRANSFORMERS_MODEL: Option<String>,
}

/// SaveContext local configuration file structure.
///
/// Stored at `~/.savecontext/config.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SaveContextConfig {
    pub embeddings: Option<EmbeddingSettings>,
}

/// Result from embedding generation.
#[derive(Debug, Clone)]
pub struct EmbeddingResult {
    pub embedding: Vec<f32>,
    pub model: String,
    pub dimensions: usize,
    pub provider: String,
}

/// Provider metadata returned from availability check.
#[derive(Debug, Clone)]
pub struct ProviderInfo {
    pub name: String,
    pub model: String,
    pub dimensions: usize,
    pub max_chars: usize,
    pub available: bool,
}

/// Model configuration with dimensions and max chars.
#[derive(Debug, Clone)]
pub struct ModelConfig {
    pub name: String,
    pub dimensions: usize,
    pub max_chars: usize,
}

/// Ollama model configurations.
pub mod ollama_models {
    use super::ModelConfig;

    pub fn nomic_embed_text() -> ModelConfig {
        ModelConfig {
            name: "nomic-embed-text".to_string(),
            dimensions: 768,
            max_chars: 5000,
        }
    }

    pub fn mxbai_embed_large() -> ModelConfig {
        ModelConfig {
            name: "mxbai-embed-large".to_string(),
            dimensions: 1024,
            max_chars: 1500,
        }
    }

    pub fn all_minilm() -> ModelConfig {
        ModelConfig {
            name: "all-minilm".to_string(),
            dimensions: 384,
            max_chars: 800,
        }
    }

    pub fn default_config() -> ModelConfig {
        nomic_embed_text()
    }

    pub fn get_config(model: &str) -> ModelConfig {
        match model {
            "nomic-embed-text" => nomic_embed_text(),
            "mxbai-embed-large" => mxbai_embed_large(),
            "all-minilm" => all_minilm(),
            _ => ModelConfig {
                name: model.to_string(),
                dimensions: 768, // Default assumption
                max_chars: 5000,
            },
        }
    }
}

/// HuggingFace model configurations.
pub mod huggingface_models {
    use super::ModelConfig;

    pub fn all_minilm_l6_v2() -> ModelConfig {
        ModelConfig {
            name: "sentence-transformers/all-MiniLM-L6-v2".to_string(),
            dimensions: 384,
            max_chars: 800,
        }
    }

    pub fn all_mpnet_base_v2() -> ModelConfig {
        ModelConfig {
            name: "sentence-transformers/all-mpnet-base-v2".to_string(),
            dimensions: 768,
            max_chars: 1500,
        }
    }

    pub fn default_config() -> ModelConfig {
        all_minilm_l6_v2()
    }

    pub fn get_config(model: &str) -> ModelConfig {
        match model {
            "sentence-transformers/all-MiniLM-L6-v2" => all_minilm_l6_v2(),
            "sentence-transformers/all-mpnet-base-v2" => all_mpnet_base_v2(),
            _ => ModelConfig {
                name: model.to_string(),
                dimensions: 384, // Default assumption
                max_chars: 800,
            },
        }
    }
}

/// Model2Vec model configurations (fast tier - static embeddings).
pub mod model2vec_models {
    use super::ModelConfig;

    /// potion-base-8M - fast 256d embeddings
    pub fn potion_base_8m() -> ModelConfig {
        ModelConfig {
            name: "minishlab/potion-base-8M".to_string(),
            dimensions: 256,
            max_chars: 2048, // Model2Vec handles longer contexts
        }
    }

    /// potion-base-32M - larger 256d embeddings
    pub fn potion_base_32m() -> ModelConfig {
        ModelConfig {
            name: "minishlab/potion-base-32M".to_string(),
            dimensions: 256,
            max_chars: 2048,
        }
    }

    /// potion-multilingual-128M - multilingual 256d embeddings
    pub fn potion_multilingual_128m() -> ModelConfig {
        ModelConfig {
            name: "minishlab/potion-multilingual-128M".to_string(),
            dimensions: 256,
            max_chars: 2048,
        }
    }

    pub fn default_config() -> ModelConfig {
        potion_base_8m()
    }

    pub fn get_config(model: &str) -> ModelConfig {
        match model {
            "minishlab/potion-base-8M" | "potion-base-8M" => potion_base_8m(),
            "minishlab/potion-base-32M" | "potion-base-32M" => potion_base_32m(),
            "minishlab/potion-multilingual-128M" | "potion-multilingual-128M" => potion_multilingual_128m(),
            _ => ModelConfig {
                name: model.to_string(),
                dimensions: 256, // Model2Vec default
                max_chars: 2048,
            },
        }
    }
}

/// Search modes for tiered embedding system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    /// Fast only - instant results using Model2Vec, lower quality
    Fast,
    /// Quality only - slower, uses Ollama/HuggingFace, better accuracy
    Quality,
    /// Tiered (default) - fast candidates, quality re-ranking
    #[default]
    Tiered,
}

impl std::fmt::Display for SearchMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Fast => write!(f, "fast"),
            Self::Quality => write!(f, "quality"),
            Self::Tiered => write!(f, "tiered"),
        }
    }
}

impl std::str::FromStr for SearchMode {
    type Err = String;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "fast" => Ok(Self::Fast),
            "quality" => Ok(Self::Quality),
            "tiered" => Ok(Self::Tiered),
            _ => Err(format!("Unknown search mode: {s}")),
        }
    }
}

/// Tiered embedding settings for 2-tier architecture.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TieredEmbeddingSettings {
    /// Enable tiered embeddings
    pub enabled: Option<bool>,
    /// Fast tier provider (default: model2vec)
    pub fast_provider: Option<EmbeddingProviderType>,
    /// Fast tier model (default: minishlab/potion-base-8M)
    pub fast_model: Option<String>,
    /// Quality tier provider (default: ollama)
    pub quality_provider: Option<EmbeddingProviderType>,
    /// Quality tier model (default: nomic-embed-text)
    pub quality_model: Option<String>,
    /// Default search mode
    pub search_mode: Option<SearchMode>,
}
