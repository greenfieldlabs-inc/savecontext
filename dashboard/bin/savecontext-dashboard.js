#!/usr/bin/env bun

const { spawn } = require('child_process');
const path = require('path');

// Parse arguments
const args = process.argv.slice(2);
let port = 3333;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' || args[i] === '--port') {
    const portArg = args[i + 1];
    if (portArg && !isNaN(parseInt(portArg, 10))) {
      port = parseInt(portArg, 10);
      i++;
    }
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log(`
SaveContext Dashboard

Usage: bunx @savecontext/dashboard [options]

Options:
  -p, --port <port>  Port to run on (default: 3333)
  -h, --help         Show this help message

Examples:
  bunx @savecontext/dashboard
  bunx @savecontext/dashboard -p 4000
`);
    process.exit(0);
  }
}

const dashboardDir = path.join(__dirname, '..');
const standaloneDir = path.join(dashboardDir, '.next', 'standalone', 'dashboard');
const serverPath = path.join(standaloneDir, 'server.js');

console.log(`Starting SaveContext Dashboard on http://localhost:${port}`);

const child = spawn('bun', [serverPath], {
  cwd: standaloneDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '0.0.0.0'
  }
});

child.on('error', (err) => {
  console.error('Failed to start dashboard:', err.message);
  console.error('Make sure Bun is installed: https://bun.sh');
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
