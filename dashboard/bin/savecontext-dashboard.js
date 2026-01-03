#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const dashboardDir = path.join(__dirname, '..');

// Run next start
const nextBin = path.join(dashboardDir, 'node_modules', '.bin', 'next');
const child = spawn(nextBin, ['start', '-p', '3333'], {
  cwd: dashboardDir,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' }
});

child.on('error', (err) => {
  console.error('Failed to start dashboard:', err.message);
  console.error('Make sure you have built the dashboard first: pnpm build');
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
