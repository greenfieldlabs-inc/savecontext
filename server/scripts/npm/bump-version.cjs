#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packages = [
  'package.json',
  'server/package.json',
  'dashboard/package.json'
];

const bumpType = process.argv[2] || 'patch';

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

const rootDir = path.resolve(__dirname, '../../..');
let newVersion;

for (const pkgPath of packages) {
  const fullPath = path.join(rootDir, pkgPath);
  const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

  if (!newVersion) {
    newVersion = bumpVersion(pkg.version, bumpType);
  }

  pkg.version = newVersion;
  fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${pkgPath}: ${newVersion}`);
}

console.log(`\nBumped all packages to v${newVersion}`);
