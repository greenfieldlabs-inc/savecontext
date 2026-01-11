#!/usr/bin/env bun
/**
 * SaveContext Embeddings CLI
 * Manage embeddings for semantic search: backfill, status, and configuration
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { DatabaseManager } from '../database/index.js';
import {
  createEmbeddingProvider,
  detectAvailableProvider,
  getSupportedModels,
  chunkText,
  type EmbeddingProvider,
  type EmbeddingConfig,
} from '../lib/embeddings/index.js';
import {
  getEmbeddingSettings,
  saveEmbeddingSettings,
  resetEmbeddingSettings,
} from '../utils/config.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

let _dbManager: DatabaseManager | null = null;
function getDbManager(): DatabaseManager {
  if (!_dbManager) {
    _dbManager = new DatabaseManager();
  }
  return _dbManager;
}

program
  .name('savecontext-embeddings')
  .description('Manage embeddings for SaveContext semantic search')
  .version(pkg.version);

// ==================
// STATUS command
// ==================
program
  .command('status')
  .description('Show embedding status and configuration')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const spinner = options.json ? null : ora('Checking embedding status...').start();

    try {
      const db = getDbManager();
      const stats = db.getEmbeddingStats();
      const detection = await detectAvailableProvider();

      spinner?.stop();

      const result = {
        stats: {
          total_items: stats.total,
          embedded: stats.embedded,
          pending: stats.pending,
          total_chunks: stats.totalChunks,
          coverage: stats.total > 0 ? Math.round((stats.embedded / stats.total) * 100) : 0,
        },
        providers: {
          available: detection.available,
          recommended: detection.recommended,
        },
        env: {
          SAVECONTEXT_EMBEDDINGS_ENABLED: process.env.SAVECONTEXT_EMBEDDINGS_ENABLED !== 'false',
          SAVECONTEXT_EMBEDDING_PROVIDER: process.env.SAVECONTEXT_EMBEDDING_PROVIDER || null,
          OLLAMA_ENDPOINT: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
          HF_TOKEN: process.env.HF_TOKEN ? '(set)' : '(not set)',
          HF_MODEL: process.env.HF_MODEL || null,
        },
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Pretty print
      const coverage = stats.total > 0 ? Math.round((stats.embedded / stats.total) * 100) : 0;
      const coverageColor = coverage >= 90 ? chalk.green : coverage >= 50 ? chalk.yellow : chalk.red;

      console.log(boxen(
        `${chalk.bold('Embedding Status')}\n\n` +
        `${chalk.dim('Total items:')}     ${stats.total}\n` +
        `${chalk.dim('Embedded:')}        ${chalk.green(stats.embedded)}\n` +
        `${chalk.dim('Pending:')}         ${stats.pending > 0 ? chalk.yellow(stats.pending) : stats.pending}\n` +
        `${chalk.dim('Total chunks:')}    ${stats.totalChunks}\n` +
        `${chalk.dim('Coverage:')}        ${coverageColor(coverage + '%')}`,
        {
          padding: 1,
          margin: { top: 1, bottom: 0, left: 0, right: 0 },
          borderStyle: 'round',
        }
      ));

      console.log(boxen(
        `${chalk.bold('Available Providers')}\n\n` +
        detection.available.map(p =>
          p === detection.recommended
            ? `${chalk.green('●')} ${p} ${chalk.dim('(recommended)')}`
            : `${chalk.green('●')} ${p}`
        ).join('\n') +
        (detection.available.length === 0 ? chalk.yellow('No providers available') : ''),
        {
          padding: 1,
          margin: { top: 1, bottom: 1, left: 0, right: 0 },
          borderStyle: 'round',
        }
      ));

      if (stats.pending > 0) {
        console.log(chalk.yellow(`\nTip: Run ${chalk.bold('savecontext-embeddings backfill')} to generate embeddings for pending items.\n`));
      }
    } catch (error) {
      spinner?.fail('Failed to get status');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// BACKFILL command
// ==================
program
  .command('backfill')
  .description('Generate embeddings for items without them')
  .option('-l, --limit <n>', 'Maximum items to process', '100')
  .option('-b, --batch <n>', 'Batch size for processing', '10')
  .option('-p, --provider <name>', 'Force specific provider (ollama, transformers, huggingface)')
  .option('-m, --model <name>', 'Model to use (depends on provider)')
  .option('--dry-run', 'Show what would be processed without generating embeddings')
  .action(async (options: {
    limit?: string;
    batch?: string;
    provider?: string;
    model?: string;
    dryRun?: boolean;
  }) => {
    const limit = parseInt(options.limit || '100', 10);
    const batchSize = parseInt(options.batch || '10', 10);

    const spinner = ora('Initializing...').start();

    try {
      const db = getDbManager();

      // Get items needing embeddings
      spinner.text = 'Finding items needing embeddings...';
      const items = db.getAllItemsNeedingEmbeddings(limit);

      if (items.length === 0) {
        spinner.succeed('All items already have embeddings!');
        return;
      }

      spinner.info(`Found ${items.length} items needing embeddings`);

      if (options.dryRun) {
        console.log(chalk.dim('\nDry run - items that would be processed:\n'));
        items.slice(0, 20).forEach((item, i) => {
          console.log(`  ${i + 1}. ${chalk.bold(item.key)} ${chalk.dim(`(${item.value.slice(0, 50)}...)`)}`);
        });
        if (items.length > 20) {
          console.log(chalk.dim(`  ... and ${items.length - 20} more`));
        }
        return;
      }

      // Create embedding provider
      spinner.text = 'Initializing embedding provider...';
      const config: EmbeddingConfig = {};

      if (options.provider) {
        config.provider = options.provider as 'ollama' | 'transformers' | 'huggingface';
      }

      if (options.model) {
        if (options.provider === 'ollama') {
          config.ollamaModel = options.model;
        } else if (options.provider === 'huggingface') {
          config.huggingfaceModel = options.model;
        } else if (options.provider === 'transformers') {
          config.transformersModel = options.model;
        }
      }

      const provider = await createEmbeddingProvider(config);

      if (!provider) {
        spinner.fail('No embedding provider available');
        console.log(chalk.yellow('\nTo enable embeddings, ensure one of:'));
        console.log('  - Ollama is running locally (recommended)');
        console.log('  - HF_TOKEN environment variable is set for HuggingFace');
        console.log('  - @xenova/transformers is installed (automatic fallback)');
        process.exit(1);
      }

      spinner.succeed(`Using ${chalk.bold(provider.name)} (${provider.model}, ${provider.dimensions}d)`);

      // Ensure vec table dimensions match provider
      const dimensionsChanged = db.ensureVecDimensions(provider.dimensions);
      if (dimensionsChanged) {
        console.log(chalk.yellow(`\nVec table recreated for ${provider.dimensions}d embeddings (was different dimensions)`));
        console.log(chalk.dim('All existing embeddings will be regenerated.\n'));
        // Re-fetch items since all now need embeddings
        const updatedItems = db.getAllItemsNeedingEmbeddings(limit);
        items.length = 0;
        items.push(...updatedItems);
        console.log(chalk.cyan(`Found ${items.length} items needing embeddings after dimension change\n`));
      }

      // Process items with chunking
      let processed = 0;
      let errors = 0;
      let totalChunks = 0;

      const progressSpinner = ora('Processing...').start();

      // Chunk config based on provider's maxChars
      const chunkConfig = {
        maxChars: provider.maxChars,
        overlapChars: Math.floor(provider.maxChars * 0.1), // 10% overlap
      };

      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        progressSpinner.text = `Processing ${processed}/${items.length} items (${totalChunks} chunks)...`;

        for (const item of batch) {
          try {
            const text = `${item.key}: ${item.value}`;
            const chunks = chunkText(text, chunkConfig);

            // Generate embeddings for each chunk
            const chunkEmbeddings: Array<{ index: number; embedding: number[] }> = [];
            for (const chunk of chunks) {
              const embedding = await provider.generateEmbedding(chunk.text);
              chunkEmbeddings.push({ index: chunk.index, embedding });
            }

            // Save all chunks for this item
            db.saveChunkEmbeddings(item.id, chunkEmbeddings, provider.name, provider.model);
            processed++;
            totalChunks += chunks.length;
          } catch (err) {
            console.error(chalk.red(`\nError embedding ${item.key}: ${err instanceof Error ? err.message : err}`));
            db.updateEmbeddingStatus(item.id, 'error');
            errors++;
          }
        }
      }

      progressSpinner.stop();

      if (errors > 0) {
        console.log(chalk.yellow(`\nProcessed ${processed} items (${totalChunks} chunks) with ${errors} errors`));
      } else {
        console.log(chalk.green(`\nSuccessfully processed ${processed} items (${totalChunks} chunks)`));
      }

      // Show updated stats
      const stats = db.getEmbeddingStats();
      const coverage = stats.total > 0 ? Math.round((stats.embedded / stats.total) * 100) : 0;
      console.log(chalk.dim(`Coverage: ${coverage}% (${stats.embedded}/${stats.total} items, ${stats.totalChunks} chunks)`));
    } catch (error) {
      spinner.fail('Backfill failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// PROVIDERS command
// ==================
program
  .command('providers')
  .description('List available embedding providers and their status')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const spinner = options.json ? null : ora('Detecting providers...').start();

    try {
      const detection = await detectAvailableProvider();

      spinner?.stop();

      const providers = [
        {
          name: 'ollama',
          description: 'Local Ollama server (fastest, requires Ollama running)',
          available: detection.available.includes('ollama'),
          recommended: detection.recommended === 'ollama',
          config: 'OLLAMA_ENDPOINT, OLLAMA_MODEL',
        },
        {
          name: 'huggingface',
          description: 'HuggingFace Inference API (cloud, requires HF_TOKEN)',
          available: detection.available.includes('huggingface'),
          recommended: detection.recommended === 'huggingface',
          config: 'HF_TOKEN, HF_MODEL',
        },
        {
          name: 'transformers',
          description: 'Transformers.js in-process (fallback, no setup needed)',
          available: detection.available.includes('transformers'),
          recommended: detection.recommended === 'transformers',
          config: 'TRANSFORMERS_MODEL',
        },
      ];

      if (options.json) {
        console.log(JSON.stringify(providers, null, 2));
        return;
      }

      console.log(chalk.bold('\nEmbedding Providers\n'));

      for (const p of providers) {
        const icon = p.available ? chalk.green('●') : chalk.red('○');
        const rec = p.recommended ? chalk.dim(' (recommended)') : '';
        console.log(`${icon} ${chalk.bold(p.name)}${rec}`);
        console.log(`  ${chalk.dim(p.description)}`);
        console.log(`  ${chalk.dim('Config:')} ${p.config}`);
        console.log('');
      }
    } catch (error) {
      spinner?.fail('Failed to detect providers');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// MODELS command
// ==================
program
  .command('models')
  .description('List supported HuggingFace models with dimensions')
  .option('--json', 'Output as JSON')
  .action((options: { json?: boolean }) => {
    const models = getSupportedModels();

    if (options.json) {
      console.log(JSON.stringify(models, null, 2));
      return;
    }

    console.log(chalk.bold('\nSupported HuggingFace Models\n'));
    console.log(chalk.dim('Set HF_MODEL to use a custom model.\n'));

    // Group by prefix
    const grouped: Record<string, typeof models> = {};
    for (const m of models) {
      const prefix = m.model.split('/')[0];
      if (!grouped[prefix]) grouped[prefix] = [];
      grouped[prefix].push(m);
    }

    for (const [prefix, items] of Object.entries(grouped)) {
      console.log(chalk.bold(prefix));
      for (const m of items) {
        const modelName = m.model.split('/')[1];
        console.log(`  ${chalk.cyan(modelName)} ${chalk.dim(`(${m.dimensions}d)`)}`);
      }
      console.log('');
    }

    console.log(chalk.dim('Note: Any HuggingFace embedding model works, these are just presets.\n'));
  });

// ==================
// RESET command
// ==================
program
  .command('reset')
  .description('Reset all embedding statuses (useful when switching models)')
  .option('-f, --force', 'Skip confirmation')
  .action(async (options: { force?: boolean }) => {
    const db = getDbManager();
    const stats = db.getEmbeddingStats();

    if (stats.embedded === 0) {
      console.log(chalk.yellow('\nNo embeddings to reset.\n'));
      return;
    }

    console.log(chalk.yellow(`\nThis will reset ${stats.embedded} embeddings.`));
    console.log(chalk.dim('Items will need to be re-embedded with backfill.\n'));

    if (!options.force) {
      const readline = await import('node:readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const confirmed = await new Promise<boolean>((resolve) => {
        rl.question(`${chalk.red('Confirm reset?')} ${chalk.dim('[y/N]')} `, (answer) => {
          rl.close();
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
      });

      if (!confirmed) {
        console.log(chalk.dim('\nCancelled.\n'));
        return;
      }
    }

    const spinner = ora('Resetting embeddings...').start();

    try {
      // Reset all embedding statuses
      const stmt = db.getDatabase().prepare(`
        UPDATE context_items
        SET embedding_status = 'none',
            embedding_provider = NULL,
            embedding_model = NULL,
            chunk_count = 0,
            embedded_at = NULL
      `);
      stmt.run();

      // Clear vector chunks table
      db.getDatabase().exec('DELETE FROM vec_context_chunks');

      spinner.succeed(`Reset ${stats.embedded} embeddings (${stats.totalChunks} chunks)`);
      console.log(chalk.dim('\nRun savecontext-embeddings backfill to regenerate.\n'));
    } catch (error) {
      spinner.fail('Reset failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  });

// ==================
// CONFIG command
// ==================
program
  .command('config')
  .description('View or update embedding configuration')
  .option('--json', 'Output as JSON')
  .option('--provider <name>', 'Set embedding provider (ollama, huggingface, transformers)')
  .option('--HF_TOKEN <token>', 'Set HuggingFace API token')
  .option('--HF_MODEL <model>', 'Set HuggingFace model')
  .option('--OLLAMA_ENDPOINT <url>', 'Set Ollama endpoint')
  .option('--OLLAMA_MODEL <model>', 'Set Ollama model')
  .option('--enabled <bool>', 'Enable or disable embeddings (true/false)')
  .option('--reset', 'Reset all embedding configuration')
  .option('--force', 'Force provider switch without confirmation')
  .action(async (options: {
    json?: boolean;
    provider?: string;
    HF_TOKEN?: string;
    HF_MODEL?: string;
    OLLAMA_ENDPOINT?: string;
    OLLAMA_MODEL?: string;
    enabled?: string;
    reset?: boolean;
    force?: boolean;
  }) => {
    // Handle reset
    if (options.reset) {
      resetEmbeddingSettings();
      console.log(chalk.green('\nEmbedding configuration reset.\n'));
      return;
    }

    // Check if any settings are being updated
    const hasUpdates = options.provider || options.HF_TOKEN || options.HF_MODEL ||
      options.OLLAMA_ENDPOINT || options.OLLAMA_MODEL || options.enabled !== undefined;

    if (hasUpdates) {
      const updates: Record<string, string | boolean | undefined> = {};

      if (options.provider) {
        const validProviders = ['ollama', 'huggingface', 'transformers'];
        if (!validProviders.includes(options.provider)) {
          console.error(chalk.red(`\nInvalid provider: ${options.provider}`));
          console.error(chalk.dim(`Valid providers: ${validProviders.join(', ')}\n`));
          process.exit(1);
        }

        // Check for provider switch with existing embeddings
        const currentSettings = getEmbeddingSettings();
        const currentProvider = currentSettings?.provider;

        if (currentProvider && currentProvider !== options.provider) {
          const db = getDbManager();
          const stats = db.getEmbeddingStats();

          if (stats.embedded > 0 && !options.force) {
            console.log(chalk.yellow(`\nSwitching provider from ${currentProvider} to ${options.provider}`));
            console.log(chalk.yellow(`You have ${stats.embedded} existing embeddings (${stats.totalChunks} chunks).`));
            console.log(chalk.dim('\nDifferent providers may use different embedding dimensions.'));
            console.log(chalk.dim('Existing embeddings will be reset after switch.\n'));

            // Backup DB
            const { homedir } = await import('os');
            const { join } = await import('path');
            const { copyFileSync, existsSync, mkdirSync } = await import('fs');

            const dbPath = join(homedir(), '.savecontext', 'data', 'savecontext.db');
            const backupDir = join(homedir(), '.savecontext', 'backups');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = join(backupDir, `savecontext-${timestamp}.db`);

            if (existsSync(dbPath)) {
              if (!existsSync(backupDir)) {
                mkdirSync(backupDir, { recursive: true });
              }
              copyFileSync(dbPath, backupPath);
              console.log(chalk.green(`Database backed up to: ${backupPath}`));
            }

            // Prompt for confirmation
            const readline = await import('node:readline');
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            const confirmed = await new Promise<boolean>((resolve) => {
              rl.question(`${chalk.yellow('Proceed with provider switch?')} ${chalk.dim('[y/N]')} `, (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
              });
            });

            if (!confirmed) {
              console.log(chalk.dim('\nCancelled.\n'));
              return;
            }

            // Reset embeddings
            const spinner = ora('Resetting embeddings for new provider...').start();
            const stmt = db.getDatabase().prepare(`
              UPDATE context_items
              SET embedding_status = 'none',
                  embedding_provider = NULL,
                  embedding_model = NULL,
                  chunk_count = 0,
                  embedded_at = NULL
            `);
            stmt.run();
            db.getDatabase().exec('DELETE FROM vec_context_chunks');
            spinner.succeed('Embeddings reset');
          }
        }

        updates.provider = options.provider;
      }

      if (options.HF_TOKEN) updates.HF_TOKEN = options.HF_TOKEN;
      if (options.HF_MODEL) updates.HF_MODEL = options.HF_MODEL;
      if (options.OLLAMA_ENDPOINT) updates.OLLAMA_ENDPOINT = options.OLLAMA_ENDPOINT;
      if (options.OLLAMA_MODEL) updates.OLLAMA_MODEL = options.OLLAMA_MODEL;
      if (options.enabled !== undefined) {
        updates.enabled = options.enabled === 'true';
      }

      saveEmbeddingSettings(updates as Parameters<typeof saveEmbeddingSettings>[0]);
      console.log(chalk.green('\nConfiguration updated.\n'));
    }

    // Get current state
    let settings = getEmbeddingSettings() || {};
    const detection = await detectAvailableProvider();
    const activeProvider = await createEmbeddingProvider();

    // Sync detected provider to config if not explicitly set
    if (activeProvider && !settings.provider) {
      const syncSettings: Record<string, string> = {
        provider: activeProvider.name,
      };
      // Also sync the model being used
      if (activeProvider.name === 'ollama') {
        syncSettings.OLLAMA_MODEL = activeProvider.model;
      } else if (activeProvider.name === 'huggingface') {
        syncSettings.HF_MODEL = activeProvider.model;
      } else if (activeProvider.name === 'transformers') {
        syncSettings.TRANSFORMERS_MODEL = activeProvider.model;
      }
      saveEmbeddingSettings(syncSettings as Parameters<typeof saveEmbeddingSettings>[0]);
      settings = getEmbeddingSettings() || {};
    }

    if (options.json) {
      const output = {
        config: { ...settings },
        active: activeProvider ? {
          provider: activeProvider.name,
          model: activeProvider.model,
        } : null,
      };
      if (output.config.HF_TOKEN) {
        output.config.HF_TOKEN = '(configured)';
      }
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Show active provider first
    const activeInfo = activeProvider
      ? `${chalk.green(activeProvider.name)} ${chalk.dim(`(${activeProvider.model})`)}`
      : chalk.yellow('none');

    console.log(boxen(
      `${chalk.bold('Embedding Configuration')}\n\n` +
      `${chalk.dim('Active:')}           ${activeInfo}\n` +
      `${chalk.dim('Available:')}        ${detection.available.length > 0 ? detection.available.join(', ') : chalk.yellow('none')}\n\n` +
      `${chalk.bold('Config File')}\n\n` +
      `${chalk.dim('enabled:')}          ${settings.enabled !== false ? chalk.green('true') : chalk.red('false')}\n` +
      `${chalk.dim('provider:')}         ${settings.provider || chalk.dim('(auto-detect)')}\n` +
      `${chalk.dim('HF_TOKEN:')}         ${settings.HF_TOKEN ? chalk.green('(configured)') : chalk.dim('(not set)')}\n` +
      `${chalk.dim('HF_MODEL:')}         ${settings.HF_MODEL || chalk.dim('(default)')}\n` +
      `${chalk.dim('OLLAMA_ENDPOINT:')}  ${settings.OLLAMA_ENDPOINT || chalk.dim('(default)')}\n` +
      `${chalk.dim('OLLAMA_MODEL:')}     ${settings.OLLAMA_MODEL || chalk.dim('(default)')}`,
      {
        padding: 1,
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: 'round',
      }
    ));

    console.log(chalk.dim('Config file: ~/.savecontext/config.json\n'));
  });

program.parse();
