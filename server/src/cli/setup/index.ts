/**
 * SaveContext Status Line Setup - Multi-tool Orchestrator
 *
 * Detects installed AI coding tools and configures statusline for each.
 * Currently supports Claude Code (native statusline + hooks).
 *
 * Usage:
 *   bunx @savecontext/mcp --setup-statusline           # Auto-detect and setup
 *   bunx @savecontext/mcp --setup-statusline --tool claude-code
 *   bunx @savecontext/mcp --uninstall-statusline       # Remove statusline config
 */

import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import type { SetupStatusLineOptions, SetupStatusLineResult, SupportedTool, DetectedTool, PythonInfo } from '../../types/index.js';
import {
  detectInstalledTools,
  detectPythonCommand,
  getPythonInstallInstructions,
} from './shared.js';
import { setupClaudeCode, uninstallClaudeCode, printClaudeCodeSuccess } from './claude-code.js';

// Re-export types
export type { SetupStatusLineOptions, SetupStatusLineResult };

/**
 * Print the setup header
 */
function printHeader(uninstall: boolean = false): void {
  console.log();
  console.log(boxen(
    chalk.magenta.bold('SaveContext') + chalk.white(` Status Line ${uninstall ? 'Uninstall' : 'Setup'}\n\n`) +
    chalk.dim(uninstall
      ? 'Removing statusline configuration from installed tools'
      : 'Configuring status line for AI coding tools'),
    {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'magenta',
    }
  ));
  console.log();
}

/**
 * Print detected tools
 */
function printDetectedTools(tools: DetectedTool[]): void {
  console.log(chalk.white('Detected tools:'));
  for (const tool of tools) {
    const status = tool.installed
      ? chalk.green('  [x] ')
      : chalk.dim('  [ ] ');
    const name = tool.installed
      ? chalk.white(tool.name)
      : chalk.dim(tool.name);
    const path = tool.installed
      ? chalk.dim(` (${tool.configDir})`)
      : '';
    console.log(`${status}${name}${path}`);
  }
  console.log();
}

/**
 * Check if Python 3 is available (required for Claude Code)
 */
function checkPython(needsPython: boolean): PythonInfo | null {
  if (!needsPython) {
    return { command: null, version: null };
  }

  const pythonSpinner = ora('Checking for Python 3').start();
  const python = detectPythonCommand();

  if (!python.command) {
    pythonSpinner.fail('Python 3 not found');
    console.log();
    console.log(chalk.yellow('  Python 3 is required for Claude Code status line.\n'));
    console.log(chalk.white('  Install Python 3:'));
    for (const instruction of getPythonInstallInstructions()) {
      console.log(chalk.dim(`    • ${instruction}`));
    }
    console.log();
    return null;
  }

  pythonSpinner.succeed(`Found Python ${python.version} (${python.command})`);
  return python;
}

/**
 * Main setup function - orchestrates multi-tool statusline setup
 */
export async function setupStatusLine(options: SetupStatusLineOptions = {}): Promise<SetupStatusLineResult> {
  const { tool: specificTool, uninstall = false } = options;

  printHeader(uninstall);

  const result: SetupStatusLineResult = {
    success: false,
    tools: [],
  };

  // Detect installed tools
  const allTools = detectInstalledTools();
  printDetectedTools(allTools);

  // Determine which tools to configure
  let toolsToSetup: DetectedTool[];

  if (specificTool) {
    // User specified a specific tool
    const tool = allTools.find(t => t.tool === specificTool);
    if (!tool) {
      result.error = `Unknown tool: ${specificTool}`;
      console.log(chalk.red(`\n  Unknown tool: ${specificTool}\n`));
      console.log(chalk.white('  Supported tools:'));
      for (const t of allTools) {
        console.log(chalk.dim(`    • ${t.tool}`));
      }
      console.log();
      return result;
    }
    if (!tool.installed && !uninstall) {
      result.error = `${tool.name} is not installed`;
      console.log(chalk.yellow(`\n  ${tool.name} is not installed.\n`));
      return result;
    }
    toolsToSetup = [tool];
  } else {
    // Auto-detect: configure all installed tools
    toolsToSetup = allTools.filter(t => t.installed);

    if (toolsToSetup.length === 0 && !uninstall) {
      result.error = 'No supported AI coding tools found';
      console.log(chalk.yellow('  No supported AI coding tools found.\n'));
      console.log(chalk.white('  Supported tools:'));
      console.log(chalk.dim('    • Claude Code (~/.claude)'));
      console.log();
      return result;
    }
  }

  // Handle uninstall
  if (uninstall) {
    return await uninstallStatusLine(toolsToSetup);
  }

  // Check Python if Claude Code is being configured
  const needsPython = toolsToSetup.some(t => t.tool === 'claude-code');
  const python = checkPython(needsPython);

  if (needsPython && !python?.command) {
    result.error = 'Python 3 not found (required for Claude Code)';
    return result;
  }

  // Setup each tool
  for (const tool of toolsToSetup) {
    console.log(chalk.white(`\nConfiguring ${tool.name}...`));

    if (tool.tool === 'claude-code') {
      const setupResult = await setupClaudeCode(python!);
      result.tools.push({
        tool: 'claude-code',
        success: setupResult.success,
        error: setupResult.error,
      });
    }
  }

  // Print success summary
  const successCount = result.tools.filter(t => t.success).length;
  result.success = successCount > 0;

  if (result.success) {
    printSuccessSummary(toolsToSetup, python);
  } else {
    console.log(chalk.red('\n  Setup failed for all tools.\n'));
    for (const toolResult of result.tools) {
      if (toolResult.error) {
        console.log(chalk.dim(`    ${toolResult.tool}: ${toolResult.error}`));
      }
    }
    console.log();
  }

  return result;
}

/**
 * Uninstall statusline from specified tools
 */
async function uninstallStatusLine(tools: DetectedTool[]): Promise<SetupStatusLineResult> {
  const result: SetupStatusLineResult = {
    success: false,
    tools: [],
  };

  for (const tool of tools) {
    if (tool.tool === 'claude-code') {
      const uninstallResult = await uninstallClaudeCode();
      result.tools.push({
        tool: 'claude-code',
        success: uninstallResult.success,
        error: uninstallResult.error,
      });
    }
  }

  const successCount = result.tools.filter(t => t.success).length;
  result.success = successCount > 0;

  if (result.success) {
    console.log();
    console.log(boxen(
      chalk.green.bold('Uninstall Complete!\n\n') +
      chalk.white('Removed statusline configuration from:\n') +
      result.tools
        .filter(t => t.success)
        .map(t => chalk.dim(`  • ${t.tool}`))
        .join('\n') +
      '\n\n' +
      chalk.dim('Note: Scripts in ~/.savecontext/ were kept.\n') +
      chalk.dim('Delete manually if no longer needed.'),
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'green',
      }
    ));
    console.log();
  }

  return result;
}

/**
 * Print success summary for all configured tools
 */
function printSuccessSummary(tools: DetectedTool[], python: PythonInfo | null): void {
  console.log();
  console.log(boxen(
    chalk.green.bold('Setup Complete!\n'),
    {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderStyle: 'round',
      borderColor: 'green',
    }
  ));

  const hasClaudeCode = tools.some(t => t.tool === 'claude-code');

  if (hasClaudeCode && python?.command) {
    printClaudeCodeSuccess(python);
  }

  // Status display info
  console.log();
  console.log(chalk.white('  The status display will show:'));
  console.log(chalk.dim('    • Current SaveContext session name'));
  console.log(chalk.dim('    • Item count (context items saved)'));
  console.log(chalk.dim('    • Session status (active/paused)'));
  console.log();
}

// Re-export types and utilities for external use
export * from './shared.js';
export { setupClaudeCode, uninstallClaudeCode } from './claude-code.js';
