#!/bin/bash
# SaveContext MCP Launcher
# Finds bun in common locations when not in PATH

# Common bun installation paths
BUN_PATHS=(
    "$HOME/.bun/bin/bun"
    "/usr/local/bin/bun"
    "/opt/homebrew/bin/bun"
    "$HOME/.local/bin/bun"
    "/usr/bin/bun"
)

# Try to find bun
find_bun() {
    # First check if bun is in PATH
    if command -v bun &> /dev/null; then
        echo "$(command -v bun)"
        return 0
    fi

    # Check common installation paths
    for path in "${BUN_PATHS[@]}"; do
        if [[ -x "$path" ]]; then
            echo "$path"
            return 0
        fi
    done

    return 1
}

BUN_PATH=$(find_bun)

if [[ -z "$BUN_PATH" ]]; then
    echo "Error: Bun runtime not found." >&2
    echo "SaveContext requires Bun. Install from: https://bun.sh" >&2
    echo "" >&2
    echo "Searched locations:" >&2
    for path in "${BUN_PATHS[@]}"; do
        echo "  - $path" >&2
    done
    exit 1
fi

# Get the directory where this script is located (resolve symlinks)
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
SERVER_PATH="$SCRIPT_DIR/../dist/index.js"

# Run the MCP server with bun
exec "$BUN_PATH" "$SERVER_PATH" "$@"
