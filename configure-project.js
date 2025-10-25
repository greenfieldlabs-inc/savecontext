#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration paths for different AI tools
const CONFIG_PATHS = {
  'Claude Desktop': path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json'),
  'Claude Code CLI': path.join(os.homedir(), '.claude.json'),
  'VS Code Claude Dev': path.join(os.homedir(), 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
  'Factory AI': path.join(os.homedir(), '.factory/mcp.json')
};

function updateConfig(configPath, projectPath, toolName) {
  try {
    let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    
    // Claude Code CLI needs "type": "stdio" field
    if (toolName === 'Claude Code CLI') {
      config.mcpServers.contextkeeper = {
        type: "stdio",
        command: "node",
        args: ["/Users/shane/code/dev/contextkeeper/server/dist/index.js"],
        env: {
          PROJECT_PATH: projectPath
        }
      };
    } else {
      config.mcpServers.contextkeeper = {
        command: "node",
        args: ["/Users/shane/code/dev/contextkeeper/server/dist/index.js"],
        env: {
          PROJECT_PATH: projectPath
        }
      };
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ ${toolName}: Updated to ${projectPath}`);
  } catch (error) {
    console.log(`⚠️  ${toolName}: ${error.message}`);
  }
}

function main() {
  const projectPath = process.argv[2] || process.cwd();
  
  console.log('🔧 Configuring ContextKeeper for all AI tools\n');
  console.log(`📁 Project: ${projectPath}\n`);
  
  // Update all configs
  for (const [tool, configPath] of Object.entries(CONFIG_PATHS)) {
    updateConfig(configPath, projectPath, tool);
  }
  
  console.log('\n🚀 Done! Restart your AI tools to load the new context.');
  console.log('\nUsage: node configure-project.js [/path/to/project]');
  console.log('If no path is provided, uses current directory.');
}

main();
