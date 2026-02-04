#!/bin/bash
# Test CLI bridge delegation
# Run this after starting the MCP server with SC_USE_CLI=true

set -e

CLI_PATH="${CLI_PATH:-../cli/target/release/sc}"
DB_PATH="${SC_DB_PATH:-$HOME/.savecontext/data/savecontext.db}"

echo "=== CLI Bridge Test Script ==="
echo "CLI: $CLI_PATH"
echo "DB:  $DB_PATH"
echo ""

# Check CLI binary exists
if [ ! -f "$CLI_PATH" ]; then
  echo "ERROR: CLI binary not found at $CLI_PATH"
  echo "Run: cd ../cli && cargo build --release"
  exit 1
fi

# Test CLI directly first
echo "1. Testing CLI directly..."
$CLI_PATH --db "$DB_PATH" --json status || {
  echo "  Note: No active session (expected if fresh)"
}
echo ""

echo "2. Testing session list..."
$CLI_PATH --db "$DB_PATH" --json session list --limit 3
echo ""

echo "3. Testing context get..."
$CLI_PATH --db "$DB_PATH" --json get --limit 3 || {
  echo "  Note: Requires active session"
}
echo ""

echo "=== CLI is working! ==="
echo ""
echo "Now test via MCP server:"
echo "  1. Start server: SC_USE_CLI=true SC_DEBUG=true pnpm dev"
echo "  2. Use Claude Code to call context_session_start, context_save, etc."
echo "  3. Watch server output for CLI delegation logs"
