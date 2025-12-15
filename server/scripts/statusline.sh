#!/bin/bash
# SaveContext Status Line Script for Claude Code
# Reads session info from cache and outputs status line text
#
# Usage in Claude Code settings.json:
#   "statusLine": {
#     "type": "command",
#     "command": "~/.savecontext/scripts/statusline.sh"
#   }

set -e

CACHE_DIR="$HOME/.savecontext/status-cache"
TTL_MS=1800000  # 30 minutes in milliseconds

# Get status key using same logic as MCP server
get_status_key() {
  # 1. Explicit override
  if [ -n "$SAVECONTEXT_STATUS_KEY" ]; then
    echo "$SAVECONTEXT_STATUS_KEY" | tr '/\\:*?"<>| ' '_' | cut -c1-100
    return
  fi

  # 2. Try PPID TTY
  if [ -n "$PPID" ]; then
    local tty
    tty=$(ps -o tty= -p "$PPID" 2>/dev/null | tr -d ' ')
    if [ -n "$tty" ] && [ "$tty" != "?" ] && [ "$tty" != "??" ]; then
      echo "tty-$tty"
      return
    fi
  fi

  # 3. macOS Terminal.app session ID
  if [ -n "$TERM_SESSION_ID" ]; then
    echo "term-$TERM_SESSION_ID" | tr '/\\:*?"<>| ' '_' | cut -c1-100
    return
  fi

  # 4. iTerm2 session ID
  if [ -n "$ITERM_SESSION_ID" ]; then
    echo "iterm-$ITERM_SESSION_ID" | tr '/\\:*?"<>| ' '_' | cut -c1-100
    return
  fi

  # 5. No key available
  echo ""
}

# Read stdin (Claude Code passes JSON context)
# We don't use it but need to consume it
cat > /dev/null

# Get the status key
KEY=$(get_status_key)
if [ -z "$KEY" ]; then
  exit 0
fi

# Check if cache file exists
CACHE_FILE="$CACHE_DIR/$KEY.json"
if [ ! -f "$CACHE_FILE" ]; then
  exit 0
fi

# Read cache and check TTL
if command -v jq &> /dev/null; then
  TIMESTAMP=$(jq -r '.timestamp // 0' "$CACHE_FILE" 2>/dev/null)
  SESSION_NAME=$(jq -r '.sessionName // ""' "$CACHE_FILE" 2>/dev/null)
  ITEM_COUNT=$(jq -r '.itemCount // 0' "$CACHE_FILE" 2>/dev/null)
else
  # Fallback: simple grep parsing
  TIMESTAMP=$(grep -o '"timestamp":[0-9]*' "$CACHE_FILE" 2>/dev/null | grep -o '[0-9]*' || echo "0")
  SESSION_NAME=$(grep -o '"sessionName":"[^"]*"' "$CACHE_FILE" 2>/dev/null | sed 's/"sessionName":"//;s/"$//' || echo "")
  ITEM_COUNT=$(grep -o '"itemCount":[0-9]*' "$CACHE_FILE" 2>/dev/null | grep -o '[0-9]*' || echo "0")
fi

# Check TTL
NOW_MS=$(($(date +%s) * 1000))
AGE_MS=$((NOW_MS - TIMESTAMP))
if [ "$AGE_MS" -gt "$TTL_MS" ]; then
  # Stale entry
  rm -f "$CACHE_FILE" 2>/dev/null
  exit 0
fi

# Output status line
if [ -n "$SESSION_NAME" ]; then
  echo "[SC: $SESSION_NAME ($ITEM_COUNT)]"
fi
