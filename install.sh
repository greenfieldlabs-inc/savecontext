#!/bin/bash

# ContextKeeper Installation Script

echo "🚀 Installing ContextKeeper dependencies..."

# Install server dependencies
echo "📦 Installing server dependencies..."
cd server
npm install

# Install CLI dependencies
echo "📦 Installing CLI dependencies..."
cd ../cli
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build
cd ../server
npm run build

echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Initialize in your project: npx contextkeeper init"
echo "2. Start the server: npx contextkeeper serve"
echo ""
echo "For Claude Desktop integration, see the README.md"
