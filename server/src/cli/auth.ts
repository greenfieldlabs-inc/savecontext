#!/usr/bin/env node
/**
 * SaveContext Auth CLI
 * Handles authentication commands: login, logout, status
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import clipboard from 'clipboardy';
import { executeDeviceFlow } from './device-flow.js';
import {
  loadCredentials,
  deleteCredentials,
  isAuthenticated,
  hasApiKey,
  getCloudMcpUrl,
  saveConfig,
  loadConfig,
  formatProvider,
  saveSession,
  loadSession,
  deleteSession,
  hasLocalData,
} from '../utils/config.js';

// Read version from package.json (single source of truth)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

program
  .name('savecontext-auth')
  .description('SaveContext authentication management')
  .version(pkg.version);

program
  .command('login')
  .description('Authenticate with SaveContext Cloud')
  .option('-q, --quiet', 'Suppress decorative output (for CI/automation)')
  .option('--json', 'Output result as JSON (implies --quiet)')
  .option('--no-clipboard', 'Do not copy config to clipboard')
  .option('--no-save', 'Do not save credentials to disk (outputs full API key)')
  .option('--redact', 'Hide API key in output (still saved to credentials file)')
  .action(async (options: { quiet?: boolean; json?: boolean; clipboard?: boolean; save?: boolean; redact?: boolean }) => {
    const quiet = options.quiet || options.json;
    const useClipboard = options.clipboard !== false;
    const shouldSave = options.save !== false;
    const redactKey = options.redact === true;
    // Only block if user has a stored API key (not just a session)
    // This allows re-running login after --no-save to persist the key
    if (hasApiKey()) {
      const creds = loadCredentials();
      const envKey = process.env.SAVECONTEXT_API_KEY;
      const keyPrefix = envKey?.slice(0, 10) || creds?.apiKey?.slice(0, 10) || 'unknown';
      if (options.json) {
        console.log(JSON.stringify({ error: 'already_authenticated', keyPrefix }));
      } else {
        console.log(chalk.yellow(`\nAlready logged in (API key: ${keyPrefix}...)`));
        console.log(chalk.dim('Run "savecontext-auth logout" first to switch accounts.\n'));
      }
      process.exit(0);
    }

    const initSpinner = quiet ? null : ora('Starting device authorization...').start();

    let userCode: string | null = null;
    let verificationUri: string | null = null;

    const result = await executeDeviceFlow({
      onCodeReceived: (code, uri) => {
        userCode = code;
        verificationUri = uri;
        initSpinner?.stop();

        if (quiet) {
          // Minimal output for CI/automation
          console.error(`Visit: ${uri}`);
          console.error(`Code: ${code}`);
        } else {
          // Display auth box
          const authBox = boxen(
            `${chalk.bold('To authenticate, visit:')}\n` +
            `${chalk.cyan(uri)}\n\n` +
            `${chalk.bold('Enter code:')} ${chalk.green.bold(code)}`,
            {
              padding: 1,
              margin: { top: 1, bottom: 1, left: 0, right: 0 },
              borderStyle: 'round',
              borderColor: 'cyan',
            }
          );
          console.log(authBox);
        }

        // Try to open browser automatically
        openBrowser(uri);
      },
      onPolling: () => {
        // Polling callback - use spinner
      },
      saveCredentials: shouldSave,
    });

    const pollSpinner = quiet ? null : ora('Waiting for authorization...').start();

    // Wait a tick to let the spinner show, then check result
    await new Promise(resolve => setTimeout(resolve, 100));
    pollSpinner?.stop();

    if (result.success) {
      // Always save session metadata (identity)
      saveSession({
        version: 1,
        userId: result.userId || '',
        email: result.email,
        provider: result.provider,
        authenticatedAt: new Date().toISOString(),
        hasStoredKey: shouldSave,
      });

      // Set cloud mode on successful authentication
      const config = loadConfig();
      config.mode = 'cloud';
      saveConfig(config);

      // Display key (redacted if --redact flag)
      const displayKey = redactKey ? '<saved to ~/.savecontext/credentials.json>' : result.apiKey;

      // Build MCP config JSON (uses real key for clipboard, display key for output)
      const mcpConfigForClipboard = JSON.stringify({
        savecontext: {
          type: 'stdio',
          command: 'npx',
          args: ['@savecontext/mcp'],
          env: {
            SAVECONTEXT_API_KEY: result.apiKey,
            SAVECONTEXT_BASE_URL: 'https://mcp.savecontext.dev',
          },
        },
      }, null, 2);

      const mcpConfigForDisplay = JSON.stringify({
        savecontext: {
          type: 'stdio',
          command: 'npx',
          args: ['@savecontext/mcp'],
          env: {
            SAVECONTEXT_API_KEY: displayKey,
            SAVECONTEXT_BASE_URL: 'https://mcp.savecontext.dev',
          },
        },
      }, null, 2);

      // Copy to clipboard (if enabled) - always use real key for clipboard
      let copied = false;
      if (useClipboard) {
        try {
          clipboard.writeSync(mcpConfigForClipboard);
          copied = true;
        } catch {
          // Clipboard not available
        }
      }

      // JSON output mode - minimal, machine-readable
      if (options.json) {
        const jsonOutput: Record<string, unknown> = {
          success: true,
          email: result.email,
          provider: result.provider,
          keyPrefix: result.apiKey?.slice(0, 10),
          copied,
          saved: shouldSave,
        };
        // Include full API key only when --no-save is used (user explicitly opted out of local storage)
        if (!shouldSave) {
          jsonOutput.apiKey = result.apiKey;
        }
        console.log(JSON.stringify(jsonOutput));
        process.exit(0);
      }

      // Normal output
      console.log(chalk.green.bold('\n✔ Authentication successful\n'));

      // Show account info
      if (result.email) {
        console.log(`${chalk.dim('Account:')} ${result.email} ${chalk.dim(`(${formatProvider(result.provider)})`)}`);
      }

      if (quiet) {
        // Quiet mode - essential info only, no decorations
        console.log(`\nMCP Config:\n${mcpConfigForDisplay}`);
        if (copied) {
          console.log('\n(Copied to clipboard)');
        }
      } else {
        // Display config box
        const configDisplay =
          `"savecontext": {\n` +
          `  "type": "stdio",\n` +
          `  "command": "npx",\n` +
          `  "args": ["@savecontext/mcp"],\n` +
          `  "env": {\n` +
          `    "SAVECONTEXT_API_KEY": "${chalk.yellow(displayKey)}",\n` +
          `    "SAVECONTEXT_BASE_URL": "https://mcp.savecontext.dev"\n` +
          `  }\n` +
          `}`;

        const configBox = boxen(configDisplay, {
          padding: 1,
          margin: { top: 1, bottom: 1, left: 0, right: 0 },
          borderStyle: 'round',
          borderColor: 'green',
          title: copied ? '✔ MCP Config (copied to clipboard)' : 'MCP Config',
          titleAlignment: 'left',
        });

        console.log(configBox);
      }

      if (!redactKey) {
        console.log(chalk.yellow.bold('⚠  Save this now — the API key cannot be retrieved again.'));
      }
      if (copied) {
        console.log(chalk.dim('Clipboard contains your API key. Clear it after pasting if on a shared machine.'));
      }
      if (!shouldSave) {
        console.log(chalk.yellow('\n⚠  Credentials not saved (--no-save). Set SAVECONTEXT_API_KEY env var to use CLI commands.'));
      }
      if (redactKey && shouldSave) {
        console.log(chalk.green('✔ API key saved to ~/.savecontext/credentials.json'));
      }
      console.log(chalk.dim(`Manage keys → https://savecontext.dev/sign-in\n`));

      // Check for local data and prompt migration (skip if already migrated)
      if (hasLocalData() && !config.migrated && !quiet) {
        console.log(boxen(
          `${chalk.yellow('Local data detected!')}\n\n` +
          `You have existing sessions in your local database.\n` +
          `Run ${chalk.cyan('savecontext-migrate')} to move them to the cloud.\n\n` +
          `${chalk.dim('Already migrated? Run')} ${chalk.cyan('savecontext-migrate --mark-done')} ${chalk.dim('to dismiss.')}`,
          {
            padding: 1,
            margin: { top: 0, bottom: 1, left: 0, right: 0 },
            borderStyle: 'round',
            borderColor: 'yellow',
          }
        ));
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: result.error }));
        process.exit(1);
      }
      console.log(chalk.red.bold(`\n✖ Authentication failed: ${result.error}\n`));
      console.log(chalk.dim('Run "savecontext-auth login" to try again.'));
      console.log(chalk.dim('If this problem persists, contact support@savecontext.dev'));
      console.log(chalk.dim('You can sign up and create an API key at https://savecontext.dev/sign-in\n'));
      process.exit(1);
    }
  });

program
  .command('logout')
  .description('Log out from SaveContext Cloud')
  .action(() => {
    if (!isAuthenticated()) {
      console.log(chalk.dim('\nNot currently logged in.\n'));
      process.exit(0);
    }

    const spinner = ora('Logging out...').start();

    // Get session/creds before deleting for display
    const session = loadSession();
    const creds = loadCredentials();
    const email = session?.email || creds?.email;
    const provider = session?.provider || creds?.provider;

    // Delete both session and credentials
    deleteSession();
    deleteCredentials();

    // Revert to local mode
    const config = loadConfig();
    config.mode = 'local';
    saveConfig(config);

    spinner.succeed(chalk.green('Logged out successfully'));

    console.log('');
    if (email) {
      console.log(`${chalk.dim('Account:')} ${email} ${chalk.dim(`(${formatProvider(provider)})`)}`);
    }
    console.log(`${chalk.dim('Mode:')} local`);
    console.log('');
    console.log(chalk.dim('Your API key remains valid. Delete it at → https://savecontext.dev/sign-in\n'));
  });

program
  .command('status')
  .description('Show current authentication status')
  .action(() => {
    const config = loadConfig();
    const session = loadSession();
    const creds = loadCredentials();
    const envKey = process.env.SAVECONTEXT_API_KEY;

    console.log(chalk.bold('\nSaveContext Status\n'));

    // Determine auth state
    const hasEnvKey = !!envKey;
    const hasStoredKey = !!creds?.apiKey;
    const hasSession = !!session;
    const isAuthed = hasEnvKey || hasStoredKey || hasSession;

    if (isAuthed) {
      // Get account info from best available source
      const email = session?.email || creds?.email;
      const provider = session?.provider || creds?.provider;
      const since = session?.authenticatedAt || creds?.createdAt;

      console.log(`${chalk.green('●')} ${chalk.green.bold('Authenticated')}`);
      if (email) {
        console.log(`  ${chalk.dim('Account:')}  ${email} ${chalk.dim(`(${formatProvider(provider)})`)}`);
      }

      // Show key status
      if (hasEnvKey) {
        console.log(`  ${chalk.dim('API Key:')}  ${envKey.slice(0, 10)}... ${chalk.cyan('(env)')}`);
      } else if (hasStoredKey) {
        console.log(`  ${chalk.dim('API Key:')}  ${creds.apiKey.slice(0, 10)}...`);
      } else {
        console.log(`  ${chalk.dim('API Key:')}  ${chalk.yellow('not stored')}`);
        console.log(chalk.dim('             Set SAVECONTEXT_API_KEY or run "savecontext-auth login" to save key.'));
      }

      if (since) {
        console.log(`  ${chalk.dim('Since:')}    ${new Date(since).toLocaleString()}`);
      }
    } else {
      console.log(`${chalk.red('●')} ${chalk.dim('Not authenticated')}`);
      console.log(chalk.dim('  Run "savecontext-auth login" to authenticate.'));
    }

    console.log('');
    console.log(`  ${chalk.dim('Mode:')}     ${config.mode}`);
    console.log(`  ${chalk.dim('MCP URL:')}  ${getCloudMcpUrl()}`);
    console.log('');
  });

program
  .command('whoami')
  .description('Show current user info')
  .action(() => {
    const session = loadSession();
    const creds = loadCredentials();
    const envKey = process.env.SAVECONTEXT_API_KEY;

    if (!session && !creds && !envKey) {
      console.log(chalk.red('\nNot logged in.'));
      console.log(chalk.dim('Run "savecontext-auth login" to authenticate.\n'));
      process.exit(1);
    }

    const email = session?.email || creds?.email;
    const provider = session?.provider || creds?.provider;
    const since = session?.authenticatedAt || creds?.createdAt;

    console.log('');
    if (email) {
      console.log(`${chalk.bold(email)} ${chalk.dim(`(${formatProvider(provider)})`)}`);
    }
    if (envKey) {
      console.log(`${chalk.dim('API Key:')} ${envKey.slice(0, 10)}... ${chalk.cyan('(env)')}`);
    } else if (creds?.apiKey) {
      console.log(`${chalk.dim('API Key:')} ${creds.apiKey.slice(0, 10)}...`);
    } else {
      console.log(`${chalk.dim('API Key:')} ${chalk.yellow('not stored')}`);
    }
    if (since) {
      console.log(`${chalk.dim('Since:')} ${new Date(since).toLocaleString()}`);
    }
    console.log('');
  });

// Allowed hostnames for browser auto-open (first-party only)
const ALLOWED_HOSTS = ['savecontext.dev', 'www.savecontext.dev'];

/**
 * Open URL in default browser (best-effort, safe implementation)
 */
function openBrowser(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  if (parsed.protocol !== 'https:') return;
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) return;

  const platform = process.platform;
  let cmd: string;
  let args: string[];

  switch (platform) {
    case 'darwin':
      cmd = 'open';
      args = [url];
      break;
    case 'win32':
      cmd = 'powershell';
      args = ['-NoProfile', '-Command', `Start-Process -FilePath '${url.replace(/'/g, "''")}'`];
      break;
    default:
      cmd = 'xdg-open';
      args = [url];
  }

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Silent failure
  }
}

program.parse();
