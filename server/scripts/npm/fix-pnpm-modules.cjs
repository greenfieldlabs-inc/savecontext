#!/usr/bin/env node

/**
 * Fixes pnpm symlink structure for npm pack compatibility.
 * Copies actual module contents from .pnpm to top-level node_modules.
 */

const fs = require('fs');
const path = require('path');

const standaloneDir = path.join(__dirname, '..', '..', '..', 'dashboard', '.next', 'standalone');
const nodeModulesDir = path.join(standaloneDir, 'node_modules');
const pnpmDir = path.join(nodeModulesDir, '.pnpm');

// Modules that need fixing (native modules with build artifacts)
const modulesToFix = ['better-sqlite3', 'bindings', 'file-uri-to-path', 'detect-libc'];

for (const moduleName of modulesToFix) {
  const stubDir = path.join(nodeModulesDir, moduleName);

  // Find the actual module in .pnpm
  const pnpmEntries = fs.readdirSync(pnpmDir).filter(d => d.startsWith(moduleName + '@'));

  if (pnpmEntries.length === 0) continue;

  const actualDir = path.join(pnpmDir, pnpmEntries[0], 'node_modules', moduleName);

  if (!fs.existsSync(actualDir)) continue;

  // Remove stub and copy actual contents
  fs.rmSync(stubDir, { recursive: true, force: true });
  fs.cpSync(actualDir, stubDir, { recursive: true });

  console.log(`Fixed: ${moduleName}`);
}

console.log('Done fixing pnpm modules');
