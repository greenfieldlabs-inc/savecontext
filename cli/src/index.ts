#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const program = new Command();

program
  .name('contextkeeper')
  .description('MCP Server for zero-context-loss AI tool switching')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize ContextKeeper in current project')
  .option('--force', 'Overwrite existing configuration')
  .action(async (options) => {
    const spinner = ora('Initializing ContextKeeper...').start();
    
    try {
      const projectPath = process.cwd();
      const projectName = path.basename(projectPath);
      
      // Create .contextkeeper directory
      const contextKeeperDir = path.join(projectPath, '.contextkeeper');
      await fs.mkdir(contextKeeperDir, { recursive: true });
      
      // Create initial profile
      const profile = {
        project: projectName,
        initialized: new Date().toISOString(),
        version: '0.1.0',
      };
      
      await fs.writeFile(
        path.join(contextKeeperDir, 'profile.json'),
        JSON.stringify(profile, null, 2)
      );
      
      // Generate Claude Desktop config
      const claudeConfig = {
        mcpServers: {
          contextkeeper: {
            command: 'npx',
            args: ['contextkeeper', 'serve'],
            env: {
              PROJECT_PATH: projectPath,
            },
          },
        },
      };
      
      const configPath = path.join(contextKeeperDir, 'claude_desktop_config.json');
      await fs.writeFile(configPath, JSON.stringify(claudeConfig, null, 2));
      
      spinner.succeed(chalk.green('ContextKeeper initialized successfully!'));
      
      console.log('\n' + chalk.cyan('Next steps:'));
      console.log('1. Add this to your Claude Desktop config:');
      console.log(chalk.gray(`   ${configPath}`));
      console.log('2. Start the MCP server:');
      console.log(chalk.yellow('   npx contextkeeper serve'));
      console.log('3. Open Claude Desktop in this directory');
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to initialize'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the MCP server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action(async (options) => {
    console.log(chalk.cyan('Starting ContextKeeper MCP Server...'));
    
    // Start the MCP server
    const serverPath = path.join(__dirname, '../../server/src/index.ts');
    const server = spawn('tsx', [serverPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PROJECT_PATH: process.cwd(),
      },
    });
    
    server.on('error', (error) => {
      console.error(chalk.red('Failed to start server:'), error);
      process.exit(1);
    });
    
    server.on('exit', (code) => {
      if (code !== 0) {
        console.error(chalk.red(`Server exited with code ${code}`));
        process.exit(code || 1);
      }
    });
  });

program
  .command('status')
  .description('Show current context status')
  .action(async () => {
    const spinner = ora('Loading context...').start();
    
    try {
      const projectPath = process.cwd();
      
      // Check if git repository
      try {
        await fs.access(path.join(projectPath, '.git'));
        
        // Get git status (simplified version)
        const { execSync } = require('child_process');
        const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
        const status = execSync('git status --short', { encoding: 'utf-8' });
        
        spinner.succeed(chalk.green('Context loaded'));
        
        console.log('\n' + chalk.cyan('Project Context:'));
        console.log(`  ${chalk.gray('Path:')} ${projectPath}`);
        console.log(`  ${chalk.gray('Branch:')} ${branch}`);
        
        if (status) {
          console.log(`  ${chalk.gray('Changes:')}`);
          console.log(status.split('\n').map((line: string) => '    ' + line).join('\n'));
        } else {
          console.log(`  ${chalk.gray('Status:')} Clean working tree`);
        }
      } catch {
        spinner.warn(chalk.yellow('Not a git repository'));
      }
      
      // Check for sessions
      const dbPath = path.join(os.homedir(), '.contextkeeper', 'contextkeeper.db');
      try {
        await fs.access(dbPath);
        console.log(`\n${chalk.cyan('Sessions:')} Database available at ${dbPath}`);
      } catch {
        console.log(`\n${chalk.gray('No sessions found yet')}`);
      }
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to load context'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('compress')
  .description('Test compression on current context')
  .option('-t, --tokens <number>', 'Target token count', '50000')
  .action(async (options) => {
    const spinner = ora('Compressing context...').start();
    
    try {
      // This would call the compression engine
      // For now, show a placeholder
      spinner.succeed(chalk.green('Compression test complete'));
      console.log(`Target: ${options.tokens} tokens`);
      console.log('(Full compression test will be available after server setup)');
      
    } catch (error) {
      spinner.fail(chalk.red('Compression failed'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Show configuration for AI tools')
  .option('--claude', 'Show Claude Desktop configuration')
  .option('--cursor', 'Show Cursor configuration')
  .option('--factory', 'Show Factory AI configuration')
  .action(async (options) => {
    const projectPath = process.cwd();
    
    if (options.claude || (!options.cursor && !options.factory)) {
      console.log(chalk.cyan('Claude Desktop Configuration:'));
      console.log(chalk.gray('Add this to ~/Library/Application Support/Claude/claude_desktop_config.json:'));
      console.log(JSON.stringify({
        mcpServers: {
          contextkeeper: {
            command: 'npx',
            args: ['contextkeeper', 'serve'],
            env: {
              PROJECT_PATH: projectPath,
            },
          },
        },
      }, null, 2));
    }
    
    if (options.cursor) {
      console.log(chalk.cyan('\nCursor Configuration:'));
      console.log(chalk.gray('(Cursor MCP support coming soon)'));
    }
    
    if (options.factory) {
      console.log(chalk.cyan('\nFactory AI Configuration:'));
      console.log(chalk.gray('(Factory AI MCP support coming soon)'));
    }
  });

program.parse();
