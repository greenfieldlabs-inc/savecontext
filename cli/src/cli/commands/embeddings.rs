//! Embeddings command implementation.
//!
//! Provides CLI commands for managing embedding providers:
//! - `status` - Show provider availability and configuration
//! - `configure` - Configure embedding provider settings
//! - `backfill` - Generate embeddings for existing context items
//! - `test` - Test provider connectivity

use crate::cli::EmbeddingsCommands;
use crate::config::resolve_db_path;
use crate::embeddings::{
    chunk_text, create_embedding_provider, detect_available_providers, get_embedding_settings,
    is_embeddings_enabled, prepare_item_text, reset_embedding_settings, save_embedding_settings,
    ChunkConfig, EmbeddingProviderType, EmbeddingSettings,
};
use crate::error::{Error, Result};
use crate::storage::SqliteStorage;
use serde::Serialize;
use std::path::PathBuf;

/// Output for embeddings status command.
#[derive(Serialize)]
struct StatusOutput {
    enabled: bool,
    configured_provider: Option<String>,
    available_providers: Vec<ProviderStatus>,
    active_provider: Option<ActiveProviderInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stats: Option<EmbeddingStatsOutput>,
}

#[derive(Serialize)]
struct EmbeddingStatsOutput {
    items_with_embeddings: usize,
    items_without_embeddings: usize,
    total_items: usize,
}

#[derive(Serialize)]
struct ProviderStatus {
    name: String,
    available: bool,
    model: Option<String>,
    dimensions: Option<usize>,
}

#[derive(Serialize)]
struct ActiveProviderInfo {
    name: String,
    model: String,
    dimensions: usize,
    max_chars: usize,
}

/// Output for embeddings test command.
#[derive(Serialize)]
struct TestOutput {
    success: bool,
    provider: String,
    model: String,
    dimensions: usize,
    input_text: String,
    embedding_sample: Vec<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Output for configure command.
#[derive(Serialize)]
struct ConfigureOutput {
    success: bool,
    message: String,
    settings: EmbeddingSettings,
}

/// Output for backfill command.
#[derive(Serialize)]
struct BackfillOutput {
    processed: usize,
    skipped: usize,
    errors: usize,
    provider: String,
    model: String,
}

/// Output for upgrade-quality command.
#[derive(Serialize)]
struct UpgradeQualityOutput {
    upgraded: usize,
    skipped: usize,
    errors: usize,
    provider: String,
    model: String,
    total_eligible: usize,
}

/// Execute embeddings command.
pub fn execute(command: EmbeddingsCommands, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    // Create tokio runtime for async operations
    let rt = tokio::runtime::Runtime::new()
        .map_err(|e| Error::Other(format!("Failed to create async runtime: {e}")))?;

    rt.block_on(async { execute_async(command, db_path, json).await })
}

async fn execute_async(command: EmbeddingsCommands, db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    match command {
        EmbeddingsCommands::Status => execute_status(db_path, json).await,
        EmbeddingsCommands::Configure {
            provider,
            enable,
            disable,
            model,
            endpoint,
            token,
        } => execute_configure(db_path, provider, enable, disable, model, endpoint, token, json).await,
        EmbeddingsCommands::Backfill {
            limit,
            session,
            force,
        } => execute_backfill(db_path, limit, session, force, json).await,
        EmbeddingsCommands::Test { text } => execute_test(&text, json).await,
        EmbeddingsCommands::ProcessPending { limit, quiet } => {
            execute_process_pending(db_path, limit, quiet).await
        }
        EmbeddingsCommands::UpgradeQuality { limit, session } => {
            execute_upgrade_quality(db_path, limit, session, json).await
        }
    }
}

/// Show embeddings status and provider availability.
async fn execute_status(db_path: Option<&PathBuf>, json: bool) -> Result<()> {
    let enabled = is_embeddings_enabled();
    let settings = get_embedding_settings().unwrap_or_default();
    let detection = detect_available_providers().await;

    // Get embedding stats from database
    let stats = if let Some(path) = resolve_db_path(db_path.map(|p| p.as_path())) {
        if path.exists() {
            SqliteStorage::open(&path)
                .ok()
                .and_then(|storage| storage.count_embedding_status(None).ok())
                .map(|s| EmbeddingStatsOutput {
                    items_with_embeddings: s.with_embeddings,
                    items_without_embeddings: s.without_embeddings,
                    total_items: s.with_embeddings + s.without_embeddings,
                })
        } else {
            None
        }
    } else {
        None
    };

    // Try to create the active provider
    let active_provider = if enabled {
        create_embedding_provider().await
    } else {
        None
    };

    let configured_provider = settings
        .as_ref()
        .and_then(|s| s.provider.as_ref())
        .map(|p| p.to_string());

    // Build provider status list
    let mut providers = Vec::new();

    // Ollama
    let ollama_available = detection.available.contains(&"ollama".to_string());
    providers.push(ProviderStatus {
        name: "ollama".to_string(),
        available: ollama_available,
        model: if ollama_available {
            Some(
                settings
                    .as_ref()
                    .and_then(|s| s.OLLAMA_MODEL.clone())
                    .unwrap_or_else(|| "nomic-embed-text".to_string()),
            )
        } else {
            None
        },
        dimensions: if ollama_available { Some(768) } else { None },
    });

    // HuggingFace
    let hf_available = detection.available.contains(&"huggingface".to_string());
    providers.push(ProviderStatus {
        name: "huggingface".to_string(),
        available: hf_available,
        model: if hf_available {
            Some(
                settings
                    .as_ref()
                    .and_then(|s| s.HF_MODEL.clone())
                    .unwrap_or_else(|| "sentence-transformers/all-MiniLM-L6-v2".to_string()),
            )
        } else {
            None
        },
        dimensions: if hf_available { Some(384) } else { None },
    });

    let active_info = active_provider.as_ref().map(|p| {
        let info = p.info();
        ActiveProviderInfo {
            name: info.name,
            model: info.model,
            dimensions: info.dimensions,
            max_chars: info.max_chars,
        }
    });

    if json {
        let output = StatusOutput {
            enabled,
            configured_provider,
            available_providers: providers,
            active_provider: active_info,
            stats,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Embeddings Status");
        println!("=================");
        println!();
        println!("Enabled: {}", if enabled { "yes" } else { "no" });
        if let Some(ref p) = configured_provider {
            println!("Configured Provider: {p}");
        }
        println!();

        println!("Available Providers:");
        for p in &providers {
            let status = if p.available { "✓" } else { "✗" };
            print!("  {status} {}", p.name);
            if let Some(ref m) = p.model {
                print!(" ({m})");
            }
            println!();
        }
        println!();

        if let Some(ref active) = active_info {
            println!("Active Provider:");
            println!("  Name:       {}", active.name);
            println!("  Model:      {}", active.model);
            println!("  Dimensions: {}", active.dimensions);
            println!("  Max Chars:  {}", active.max_chars);
        } else if enabled {
            println!("No embedding provider available.");
            println!();
            println!("To enable embeddings:");
            println!("  - Install Ollama: https://ollama.ai");
            println!("  - Or set HF_TOKEN environment variable");
        }

        // Display stats if available
        if let Some(ref s) = stats {
            println!();
            println!("Item Statistics:");
            println!("  With embeddings:    {}", s.items_with_embeddings);
            println!("  Without embeddings: {}", s.items_without_embeddings);
            println!("  Total items:        {}", s.total_items);
            if s.items_without_embeddings > 0 {
                println!();
                println!("Run 'sc embeddings backfill' to generate missing embeddings.");
            }
        }
    }

    Ok(())
}

/// Configure embedding settings.
#[allow(clippy::fn_params_excessive_bools)]
async fn execute_configure(
    db_path: Option<&PathBuf>,
    provider: Option<String>,
    enable: bool,
    disable: bool,
    model: Option<String>,
    endpoint: Option<String>,
    token: Option<String>,
    json: bool,
) -> Result<()> {
    // Get current settings or create defaults
    let mut settings = get_embedding_settings()
        .unwrap_or_default()
        .unwrap_or_default();

    let mut changed = false;
    let mut messages = Vec::new();

    // Handle enable/disable
    if enable && disable {
        return Err(Error::InvalidArgument(
            "Cannot specify both --enable and --disable".to_string(),
        ));
    }

    if enable {
        settings.enabled = Some(true);
        messages.push("Embeddings enabled");
        changed = true;
    } else if disable {
        settings.enabled = Some(false);
        messages.push("Embeddings disabled");
        changed = true;
    }

    // Handle provider
    if let Some(ref p) = provider {
        let provider_type = match p.to_lowercase().as_str() {
            "ollama" => EmbeddingProviderType::Ollama,
            "huggingface" | "hf" => EmbeddingProviderType::Huggingface,
            _ => {
                return Err(Error::InvalidArgument(format!(
                    "Unknown provider: {p}. Valid options: ollama, huggingface"
                )));
            }
        };
        settings.provider = Some(provider_type);
        messages.push("Provider configured");
        changed = true;
    }

    // Handle model
    if let Some(ref m) = model {
        // Set model for the configured provider
        let provider_type = settings.provider.unwrap_or(EmbeddingProviderType::Ollama);
        match provider_type {
            EmbeddingProviderType::Ollama => {
                settings.OLLAMA_MODEL = Some(m.clone());
            }
            EmbeddingProviderType::Huggingface => {
                settings.HF_MODEL = Some(m.clone());
            }
            EmbeddingProviderType::Transformers => {
                settings.TRANSFORMERS_MODEL = Some(m.clone());
            }
            EmbeddingProviderType::Model2vec => {
                // Model2Vec model is configured via tiered settings
                // Silently ignore for now - tiered config not yet implemented
            }
        }
        messages.push("Model configured");
        changed = true;
    }

    // Handle endpoint
    if let Some(ref e) = endpoint {
        let provider_type = settings.provider.unwrap_or(EmbeddingProviderType::Ollama);
        match provider_type {
            EmbeddingProviderType::Ollama => {
                settings.OLLAMA_ENDPOINT = Some(e.clone());
            }
            EmbeddingProviderType::Huggingface => {
                settings.HF_ENDPOINT = Some(e.clone());
            }
            _ => {}
        }
        messages.push("Endpoint configured");
        changed = true;
    }

    // Handle token
    if let Some(ref t) = token {
        settings.HF_TOKEN = Some(t.clone());
        messages.push("Token configured");
        changed = true;
    }

    if !changed {
        // If no changes, just show current config
        return execute_status(db_path, json).await;
    }

    // Save settings
    save_embedding_settings(&settings)?;

    let message = messages.join(", ");

    if json {
        let output = ConfigureOutput {
            success: true,
            message,
            settings,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("Configuration updated: {message}");
        println!();
        execute_status(db_path, false).await?;
    }

    Ok(())
}

/// Backfill embeddings for existing context items.
///
/// This function:
/// 1. Queries context items without embeddings (or all if --force)
/// 2. Chunks large items for full semantic coverage
/// 3. Generates embeddings via the configured provider
/// 4. Stores embeddings as BLOBs in the database
async fn execute_backfill(
    db_path: Option<&PathBuf>,
    limit: Option<usize>,
    session: Option<String>,
    force: bool,
    json: bool,
) -> Result<()> {
    // Get database path
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    // Create provider first to fail fast if not available
    let provider = create_embedding_provider()
        .await
        .ok_or_else(|| Error::Embedding("No embedding provider available".to_string()))?;

    let info = provider.info();
    let provider_name = info.name.clone();
    let model_name = info.model.clone();

    // Get chunk config based on provider
    let chunk_config = if provider_name.to_lowercase().contains("ollama") {
        ChunkConfig::for_ollama()
    } else {
        ChunkConfig::for_minilm()
    };

    // Open storage
    let mut storage = SqliteStorage::open(&db_path)?;

    // Get items to process
    let items = if force {
        // Get all items (with limit)
        storage.get_items_without_embeddings(session.as_deref(), Some(limit.unwrap_or(1000) as u32))?
    } else {
        // Get only items without embeddings
        storage.get_items_without_embeddings(session.as_deref(), Some(limit.unwrap_or(1000) as u32))?
    };

    if items.is_empty() {
        if json {
            let output = BackfillOutput {
                processed: 0,
                skipped: 0,
                errors: 0,
                provider: provider_name,
                model: model_name,
            };
            println!("{}", serde_json::to_string(&output)?);
        } else {
            println!("No items to process.");
            println!("All context items already have embeddings.");
        }
        return Ok(());
    }

    let total_items = items.len();
    let mut processed = 0;
    let mut skipped = 0;
    let mut errors = 0;

    if !json {
        println!("Backfilling embeddings for {} items...", total_items);
        println!("Provider: {} ({})", provider_name, model_name);
        println!();
    }

    for item in items {
        // Prepare text for embedding
        let text = prepare_item_text(&item.key, &item.value, Some(&item.category));

        // Chunk the text
        let chunks = chunk_text(&text, &chunk_config);

        if chunks.is_empty() {
            skipped += 1;
            continue;
        }

        // Generate embeddings for each chunk
        let mut chunk_errors = 0;
        for (chunk_idx, chunk) in chunks.iter().enumerate() {
            match provider.generate_embedding(&chunk.text).await {
                Ok(embedding) => {
                    // Generate chunk ID
                    let chunk_id = format!("emb_{}_{}", item.id, chunk_idx);

                    // Store the embedding
                    if let Err(e) = storage.store_embedding_chunk(
                        &chunk_id,
                        &item.id,
                        chunk_idx as i32,
                        &chunk.text,
                        &embedding,
                        &provider_name,
                        &model_name,
                    ) {
                        if !json {
                            eprintln!("  Error storing chunk {}: {}", chunk_idx, e);
                        }
                        chunk_errors += 1;
                    }
                }
                Err(e) => {
                    if !json {
                        eprintln!("  Error generating embedding for {}: {}", item.key, e);
                    }
                    chunk_errors += 1;
                }
            }
        }

        if chunk_errors == 0 {
            processed += 1;
            if !json {
                println!("  ✓ {} ({} chunks)", item.key, chunks.len());
            }
        } else if chunk_errors < chunks.len() {
            // Partial success
            processed += 1;
            errors += chunk_errors;
            if !json {
                println!("  ⚠ {} ({}/{} chunks)", item.key, chunks.len() - chunk_errors, chunks.len());
            }
        } else {
            // Complete failure
            errors += 1;
            if !json {
                println!("  ✗ {}", item.key);
            }
        }
    }

    if json {
        let output = BackfillOutput {
            processed,
            skipped,
            errors,
            provider: provider_name,
            model: model_name,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!();
        println!("Complete!");
        println!("  Processed: {}", processed);
        println!("  Skipped:   {}", skipped);
        println!("  Errors:    {}", errors);
    }

    Ok(())
}

/// Test embedding provider connectivity.
async fn execute_test(text: &str, json: bool) -> Result<()> {
    let provider = create_embedding_provider()
        .await
        .ok_or_else(|| Error::Embedding("No embedding provider available".to_string()))?;

    let info = provider.info();

    // Generate embedding
    let result = provider.generate_embedding(text).await;

    match result {
        Ok(embedding) => {
            let sample: Vec<f32> = embedding.iter().take(5).copied().collect();

            if json {
                let output = TestOutput {
                    success: true,
                    provider: info.name,
                    model: info.model,
                    dimensions: embedding.len(),
                    input_text: text.to_string(),
                    embedding_sample: sample,
                    error: None,
                };
                println!("{}", serde_json::to_string(&output)?);
            } else {
                println!("Embedding Test: SUCCESS");
                println!();
                println!("Provider:   {}", info.name);
                println!("Model:      {}", info.model);
                println!("Dimensions: {}", embedding.len());
                println!("Input:      \"{text}\"");
                println!();
                println!("Sample (first 5 values):");
                for (i, v) in sample.iter().enumerate() {
                    println!("  [{i}] {v:.6}");
                }
            }
        }
        Err(e) => {
            if json {
                let output = TestOutput {
                    success: false,
                    provider: info.name,
                    model: info.model,
                    dimensions: 0,
                    input_text: text.to_string(),
                    embedding_sample: vec![],
                    error: Some(e.to_string()),
                };
                println!("{}", serde_json::to_string(&output)?);
            } else {
                println!("Embedding Test: FAILED");
                println!();
                println!("Provider: {}", info.name);
                println!("Model:    {}", info.model);
                println!("Error:    {e}");
            }
            return Err(e);
        }
    }

    Ok(())
}

/// Process pending embeddings (for background execution).
///
/// This is called by the spawned background process after a save operation.
/// It processes a limited number of items to avoid long-running operations.
async fn execute_process_pending(
    db_path: Option<&PathBuf>,
    limit: usize,
    quiet: bool,
) -> Result<()> {
    // Get database path
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Ok(()); // No database yet, nothing to do
    }

    // Check if embeddings are enabled
    if !is_embeddings_enabled() {
        return Ok(());
    }

    // Try to create provider (may not be available)
    let provider = match create_embedding_provider().await {
        Some(p) => p,
        None => return Ok(()), // No provider available, skip silently
    };

    let info = provider.info();
    let provider_name = info.name.clone();
    let model_name = info.model.clone();

    // Get chunk config based on provider
    let chunk_config = if provider_name.to_lowercase().contains("ollama") {
        ChunkConfig::for_ollama()
    } else {
        ChunkConfig::for_minilm()
    };

    // Open storage
    let mut storage = SqliteStorage::open(&db_path)?;

    // Get items to process (limited batch)
    let items = storage.get_items_without_embeddings(None, Some(limit as u32))?;

    if items.is_empty() {
        return Ok(());
    }

    let mut processed = 0;

    for item in items {
        // Prepare text for embedding
        let text = prepare_item_text(&item.key, &item.value, Some(&item.category));

        // Chunk the text
        let chunks = chunk_text(&text, &chunk_config);

        if chunks.is_empty() {
            continue;
        }

        // Generate embeddings for each chunk
        let mut success = true;
        for (chunk_idx, chunk) in chunks.iter().enumerate() {
            match provider.generate_embedding(&chunk.text).await {
                Ok(embedding) => {
                    let chunk_id = format!("emb_{}_{}", item.id, chunk_idx);
                    if storage
                        .store_embedding_chunk(
                            &chunk_id,
                            &item.id,
                            chunk_idx as i32,
                            &chunk.text,
                            &embedding,
                            &provider_name,
                            &model_name,
                        )
                        .is_err()
                    {
                        success = false;
                        break;
                    }
                }
                Err(_) => {
                    success = false;
                    break;
                }
            }
        }

        if success {
            processed += 1;
            if !quiet {
                eprintln!("[bg] Embedded: {} ({} chunks)", item.key, chunks.len());
            }
        }
    }

    if !quiet && processed > 0 {
        eprintln!("[bg] Processed {} pending embeddings", processed);
    }

    Ok(())
}

/// Spawn a detached background process to generate embeddings.
///
/// This is called after save operations to process pending embeddings
/// without blocking the main command. The spawned process runs independently
/// and exits when done.
pub fn spawn_background_embedder() {
    use std::process::{Command, Stdio};

    // Only spawn if embeddings are enabled
    if !is_embeddings_enabled() {
        return;
    }

    // Get the current executable path
    let exe = match std::env::current_exe() {
        Ok(path) => path,
        Err(_) => return, // Can't find ourselves, skip
    };

    // Spawn detached process
    let _ = Command::new(exe)
        .args(["embeddings", "process-pending", "--quiet"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    // Ignore errors - if spawn fails, backfill will catch it later
}

/// Reset embedding settings to defaults.
#[allow(dead_code)]
pub fn reset_to_defaults() -> Result<()> {
    reset_embedding_settings()?;
    println!("Embedding settings reset to defaults.");
    Ok(())
}

/// Upgrade items with fast embeddings to quality embeddings.
///
/// This command processes items that have been saved with the 2-tier system
/// (which generates instant Model2Vec embeddings) and generates higher-quality
/// embeddings using Ollama or HuggingFace.
///
/// The quality embeddings enable better semantic search accuracy while the
/// fast embeddings continue to provide instant results.
async fn execute_upgrade_quality(
    db_path: Option<&PathBuf>,
    limit: Option<usize>,
    session: Option<String>,
    json: bool,
) -> Result<()> {
    // Get database path
    let db_path = resolve_db_path(db_path.map(|p| p.as_path())).ok_or(Error::NotInitialized)?;

    if !db_path.exists() {
        return Err(Error::NotInitialized);
    }

    // Create quality provider (Ollama or HuggingFace)
    let provider = create_embedding_provider()
        .await
        .ok_or_else(|| Error::Embedding("No quality embedding provider available. Install Ollama or set HF_TOKEN.".to_string()))?;

    let info = provider.info();
    let provider_name = info.name.clone();
    let model_name = info.model.clone();

    // Get chunk config based on provider
    let chunk_config = if provider_name.to_lowercase().contains("ollama") {
        ChunkConfig::for_ollama()
    } else {
        ChunkConfig::for_minilm()
    };

    // Open storage
    let mut storage = SqliteStorage::open(&db_path)?;

    // Get items that need quality upgrade (have fast embeddings but no quality)
    let items = storage.get_items_needing_quality_upgrade(
        session.as_deref(),
        limit.map(|l| l as u32),
    )?;

    let total_eligible = items.len();

    if items.is_empty() {
        if json {
            let output = UpgradeQualityOutput {
                upgraded: 0,
                skipped: 0,
                errors: 0,
                provider: provider_name,
                model: model_name,
                total_eligible: 0,
            };
            println!("{}", serde_json::to_string(&output)?);
        } else {
            println!("No items need quality upgrade.");
            println!("All items with fast embeddings already have quality embeddings.");
        }
        return Ok(());
    }

    if !json {
        println!("Upgrading {} items to quality embeddings...", total_eligible);
        println!("Provider: {} ({})", provider_name, model_name);
        println!();
    }

    let mut upgraded = 0;
    let mut skipped = 0;
    let mut errors = 0;

    for item in items {
        // Prepare text for embedding
        let text = prepare_item_text(&item.key, &item.value, Some(&item.category));

        // Chunk the text
        let chunks = chunk_text(&text, &chunk_config);

        if chunks.is_empty() {
            skipped += 1;
            if !json {
                println!("  - {} (no content)", item.key);
            }
            continue;
        }

        // Generate embeddings for each chunk
        let mut chunk_errors = 0;
        for (chunk_idx, chunk) in chunks.iter().enumerate() {
            match provider.generate_embedding(&chunk.text).await {
                Ok(embedding) => {
                    // Generate chunk ID (for quality tier)
                    let chunk_id = format!("emb_{}_{}", item.id, chunk_idx);

                    // Store the quality embedding
                    if let Err(e) = storage.store_embedding_chunk(
                        &chunk_id,
                        &item.id,
                        chunk_idx as i32,
                        &chunk.text,
                        &embedding,
                        &provider_name,
                        &model_name,
                    ) {
                        if !json {
                            eprintln!("  Error storing chunk {}: {}", chunk_idx, e);
                        }
                        chunk_errors += 1;
                    }
                }
                Err(e) => {
                    if !json {
                        eprintln!("  Error generating embedding for {}: {}", item.key, e);
                    }
                    chunk_errors += 1;
                }
            }
        }

        if chunk_errors == 0 {
            upgraded += 1;
            if !json {
                println!("  ✓ {} ({} chunks)", item.key, chunks.len());
            }
        } else if chunk_errors < chunks.len() {
            // Partial success
            upgraded += 1;
            errors += chunk_errors;
            if !json {
                println!("  ⚠ {} ({}/{} chunks)", item.key, chunks.len() - chunk_errors, chunks.len());
            }
        } else {
            // Complete failure
            errors += 1;
            if !json {
                println!("  ✗ {}", item.key);
            }
        }
    }

    if json {
        let output = UpgradeQualityOutput {
            upgraded,
            skipped,
            errors,
            provider: provider_name,
            model: model_name,
            total_eligible,
        };
        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!();
        println!("Quality upgrade complete!");
        println!("  Upgraded: {}", upgraded);
        println!("  Skipped:  {}", skipped);
        println!("  Errors:   {}", errors);
        println!();
        println!("Items now have both fast (instant) and quality (accurate) embeddings.");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_status_serialization() {
        let status = ProviderStatus {
            name: "ollama".to_string(),
            available: true,
            model: Some("nomic-embed-text".to_string()),
            dimensions: Some(768),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("ollama"));
        assert!(json.contains("768"));
    }
}
