//! Embedding module for semantic search.
//!
//! Provides embedding generation using HTTP-based providers:
//! - **Ollama** (local) - Recommended for development
//! - **HuggingFace** (cloud) - Requires API token
//!
//! # Architecture
//!
//! ```text
//! ┌──────────────────┐
//! │  CLI Commands    │
//! │ (status/backfill)│
//! └────────┬─────────┘
//!          │
//!          ▼
//! ┌─────────────────┐
//! │    Factory      │  ← Auto-detects available provider
//! └────────┬────────┘
//!          │
//!     ┌────┴────┐
//!     ▼         ▼
//! ┌───────┐ ┌───────────┐
//! │Ollama │ │HuggingFace│
//! └───────┘ └───────────┘
//!     │         │
//!     ▼         ▼
//!   HTTP      HTTP
//! localhost  API
//! ```
//!
//! # Configuration
//!
//! Settings are loaded from `~/.savecontext/config.json` to maintain
//! compatibility with the TypeScript MCP server.
//!
//! Environment variables take precedence:
//! - `OLLAMA_ENDPOINT` - Ollama server URL (default: `http://localhost:11434`)
//! - `OLLAMA_MODEL` - Embedding model (default: `nomic-embed-text`)
//! - `HF_TOKEN` - HuggingFace API token
//! - `HF_MODEL` - HuggingFace model (default: `sentence-transformers/all-MiniLM-L6-v2`)
//! - `SAVECONTEXT_EMBEDDINGS_ENABLED` - Enable/disable embeddings (default: `true`)
//!
//! # Usage
//!
//! ```rust,ignore
//! use sc::embeddings::{create_embedding_provider, detect_available_providers};
//!
//! // Detect available providers
//! let detection = detect_available_providers().await;
//! println!("Available: {:?}", detection.available);
//!
//! // Create provider (auto-detects)
//! if let Some(provider) = create_embedding_provider().await {
//!     let info = provider.info();
//!     println!("Using {} ({})", info.name, info.model);
//!
//!     let embedding = provider.generate_embedding("Hello world").await?;
//!     println!("Dimensions: {}", embedding.len());
//! }
//! ```

pub mod chunking;
pub mod config;
pub mod factory;
pub mod huggingface;
pub mod model2vec;
pub mod ollama;
pub mod provider;
pub mod types;

// Re-exports for convenience
pub use config::{
    get_embedding_settings, is_embeddings_enabled, resolve_hf_model, resolve_hf_token,
    resolve_ollama_endpoint, resolve_ollama_model, reset_embedding_settings, save_embedding_settings,
};
pub use factory::{
    create_embedding_provider, create_huggingface_provider, create_ollama_provider,
    detect_available_providers, ProviderDetection,
};
pub use huggingface::HuggingFaceProvider;
pub use model2vec::Model2VecProvider;
pub use ollama::OllamaProvider;
pub use provider::{BoxedProvider, EmbeddingProvider};
pub use types::{
    EmbeddingProviderType, EmbeddingResult, EmbeddingSettings, ModelConfig, ProviderInfo,
    SaveContextConfig, SearchMode, TieredEmbeddingSettings, model2vec_models,
};
pub use chunking::{chunk_text, prepare_item_text, ChunkConfig, TextChunk};
