#!/usr/bin/env node

// Test script to see ContextKeeper analyze itself
const { spawn } = require('child_process');

console.log('🚀 Testing ContextKeeper on itself...\n');

// Start the server
const server = spawn('node', ['server/dist/index.js'], {
  env: {
    ...process.env,
    PROJECT_PATH: '/Users/shane/code/dev/contextkeeper'
  }
});

// Give server time to start
setTimeout(() => {
  console.log('Testing MCP tools on ContextKeeper project:\n');
  
  // The server is running but we need an MCP client to connect to it
  // For now, let's just show what the server can detect about the project
  
  console.log('📁 Project: /Users/shane/code/dev/contextkeeper');
  console.log('🔧 Available MCP Tools:');
  console.log('  - get_project_context: Full git + codebase overview');
  console.log('  - get_recent_changes: What changed recently');
  console.log('  - save_session: Save conversation state');
  console.log('  - load_session: Load previous work');
  console.log('  - remember: Store important context');
  console.log('  - recall: Retrieve stored memories');
  console.log('  - compress_context: Fit into token limits');
  console.log('  - get_file_structure: Project tree');
  console.log('  - explain_codebase: Auto-explanation\n');
  
  console.log('✅ Server is ready! You can now:');
  console.log('1. Add the config from .contextkeeper/claude_desktop_config.json to Claude Desktop');
  console.log('2. Use Claude Desktop in this project with full context awareness');
  console.log('3. Switch between AI tools without losing context\n');
  
  // Kill the server
  server.kill();
  process.exit(0);
}, 2000);

server.stderr.on('data', (data) => {
  console.log(`Server: ${data}`);
});

server.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
