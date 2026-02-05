#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// JSON packages (package.json files)
const jsonPackages = [
  'package.json',
  'server/package.json',
  'dashboard/package.json'
];

// TOML packages (Cargo.toml files)
const tomlPackages = [
  'cli/Cargo.toml'
];

const bumpType = process.argv[2] || 'patch';

function bumpVersion(version, type) {
  // If type looks like a version number (x.y.z), use it directly
  if (/^\d+\.\d+\.\d+$/.test(type)) {
    return type;
  }

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

function updateJsonPackage(fullPath, newVersion) {
  const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
}

function getTomlVersion(content) {
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

function updateTomlPackage(fullPath, newVersion) {
  let content = fs.readFileSync(fullPath, 'utf8');
  content = content.replace(
    /^(version\s*=\s*)"[^"]+"/m,
    `$1"${newVersion}"`
  );
  fs.writeFileSync(fullPath, content);
}

const rootDir = path.resolve(__dirname, '../../..');
let newVersion;

// Process JSON packages first to get the new version
for (const pkgPath of jsonPackages) {
  const fullPath = path.join(rootDir, pkgPath);
  const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

  if (!newVersion) {
    newVersion = bumpVersion(pkg.version, bumpType);
  }

  updateJsonPackage(fullPath, newVersion);
  console.log(`${pkgPath}: ${newVersion}`);
}

// Process TOML packages with the same version
for (const pkgPath of tomlPackages) {
  const fullPath = path.join(rootDir, pkgPath);

  if (!fs.existsSync(fullPath)) {
    console.log(`${pkgPath}: skipped (file not found)`);
    continue;
  }

  updateTomlPackage(fullPath, newVersion);
  console.log(`${pkgPath}: ${newVersion}`);
}

console.log(`\nBumped all packages to v${newVersion}`);
