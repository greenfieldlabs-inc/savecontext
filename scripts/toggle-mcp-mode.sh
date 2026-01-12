#!/usr/bin/env bash
#
# SaveContext MCP Mode Toggle
# ===========================
# Switch your AI tools between the npm package and local development source.
#
# This is useful when:
#   - Developing/testing changes to SaveContext locally
#   - Switching back to the stable npm release
#   - Debugging MCP server issues with local source
#
# Requirements:
#   - jq (JSON processor): brew install jq / apt install jq
#   - Bun runtime for local mode: curl -fsSL https://bun.sh/install | bash
#
# Usage:
#   ./toggle-mcp-mode.sh              Toggle between local and npm modes
#   ./toggle-mcp-mode.sh local        Switch to local development
#   ./toggle-mcp-mode.sh npm          Switch to npm package (bunx)
#   ./toggle-mcp-mode.sh status       Show current mode and config status
#   ./toggle-mcp-mode.sh -h|--help    Show this help message
#
# Examples:
#   # Check which mode you're in
#   ./scripts/toggle-mcp-mode.sh status
#
#   # Switch to local dev (after building)
#   cd server && bun run build && cd ..
#   ./scripts/toggle-mcp-mode.sh local
#
#   # Switch back to npm package
#   ./scripts/toggle-mcp-mode.sh npm
#
# Supported Tools:
#   - Claude Code (~/.claude.json)
#   - Cursor (~/.cursor/mcp.json)
#   - Windsurf (~/.codeium/windsurf/mcp_config.json)
#   - Claude Desktop (~/Library/Application Support/Claude/...)
#   - OpenCode (~/.config/opencode/opencode.json)
#
# Adding New Tools:
#   1. Add to STANDARD_CONFIG_FILES for standard MCP format
#   2. Add to OPENCODE_CONFIG_FILES for OpenCode array format
#   3. For other formats, add a new update function
#

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Standard MCP config format: { mcpServers: { savecontext: { command: "bun", args: [...] } } }
readonly STANDARD_CONFIG_FILES=(
    "$HOME/.claude.json"
    "$HOME/.cursor/mcp.json"
    "$HOME/.codeium/windsurf/mcp_config.json"
    "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
)

# OpenCode format: { mcp: { savecontext: { command: ["bun", "..."], type: "local" } } }
readonly OPENCODE_CONFIG_FILES=(
    "$HOME/.config/opencode/opencode.json"
)

# Local development settings (requires Bun runtime for bun:sqlite)
readonly LOCAL_COMMAND="bun"
readonly LOCAL_ARGS="[\"$PROJECT_ROOT/server/dist/index.js\"]"
readonly LOCAL_OPENCODE_CMD="[\"bun\", \"$PROJECT_ROOT/server/dist/index.js\"]"

# NPM package settings
readonly NPM_COMMAND="bunx"
readonly NPM_ARGS='["@savecontext/mcp"]'
readonly NPM_OPENCODE_CMD='["bunx", "@savecontext/mcp"]'

print_header() {
    echo ""
    echo "SaveContext MCP Mode Toggle"
    echo "==========================="
    echo ""
}

show_help() {
    head -45 "$0" | tail -42 | sed 's/^# //' | sed 's/^#//'
    exit 0
}

check_requirements() {
    if ! command -v jq &> /dev/null; then
        echo "Error: jq is required but not installed."
        echo ""
        echo "Install with:"
        echo "  macOS:  brew install jq"
        echo "  Ubuntu: sudo apt install jq"
        echo "  Windows: choco install jq"
        exit 1
    fi
}

get_current_mode() {
    local config="$HOME/.claude.json"
    if [[ -f "$config" ]]; then
        jq -r '.mcpServers.savecontext.command // "unknown"' "$config" 2>/dev/null || echo "unknown"
    else
        echo "unknown"
    fi
}

show_status() {
    local current_command
    current_command=$(get_current_mode)

    echo "Current mode: "
    case "$current_command" in
        bun|node)
            echo "  Mode:    LOCAL (development)"
            echo "  Source:  $PROJECT_ROOT/server/dist/index.js"
            echo ""
            if [[ ! -f "$PROJECT_ROOT/server/dist/index.js" ]]; then
                echo "  Warning: Local build not found! Run:"
                echo "    cd server && bun run build"
            fi
            ;;
        bunx|npx)
            echo "  Mode:    NPM (package)"
            echo "  Package: @savecontext/mcp"
            ;;
        *)
            echo "  Mode:    UNKNOWN (savecontext not configured?)"
            ;;
    esac

    echo ""
    echo "Config files:"
    echo "  Standard format:"
    for config in "${STANDARD_CONFIG_FILES[@]}"; do
        local name
        name=$(basename "$config")
        if [[ -f "$config" ]]; then
            if jq -e '.mcpServers.savecontext' "$config" &>/dev/null; then
                echo "    ✓ $name (savecontext configured)"
            else
                echo "    - $name (no savecontext entry)"
            fi
        else
            echo "    - $name (file not found)"
        fi
    done
    echo "  OpenCode format:"
    for config in "${OPENCODE_CONFIG_FILES[@]}"; do
        local name
        name=$(basename "$config")
        if [[ -f "$config" ]]; then
            if jq -e '.mcp.savecontext' "$config" &>/dev/null; then
                echo "    ✓ $name (savecontext configured)"
            else
                echo "    - $name (no savecontext entry)"
            fi
        else
            echo "    - $name (file not found)"
        fi
    done
}

# Update standard format configs (Claude Code, Cursor, Windsurf, Claude Desktop)
update_standard_configs() {
    local command="$1"
    local args="$2"
    local updated=0

    for config in "${STANDARD_CONFIG_FILES[@]}"; do
        if [[ -f "$config" ]]; then
            # Only update if savecontext is configured
            if jq -e '.mcpServers.savecontext' "$config" &>/dev/null; then
                echo "  Updating: $(basename "$config")"
                jq --arg cmd "$command" --argjson args "$args" \
                    '.mcpServers.savecontext.command = $cmd | .mcpServers.savecontext.args = $args' \
                    "$config" > "$config.tmp" && mv "$config.tmp" "$config"
                ((updated++))
            fi
        fi
    done

    echo "  Standard configs updated: $updated"
}

# Update OpenCode format configs (command is an array)
update_opencode_configs() {
    local opencode_cmd="$1"
    local updated=0

    for config in "${OPENCODE_CONFIG_FILES[@]}"; do
        if [[ -f "$config" ]]; then
            # Only update if savecontext is configured
            if jq -e '.mcp.savecontext' "$config" &>/dev/null; then
                echo "  Updating: $(basename "$config")"
                jq --argjson cmd "$opencode_cmd" \
                    '.mcp.savecontext.command = $cmd' \
                    "$config" > "$config.tmp" && mv "$config.tmp" "$config"
                ((updated++))
            fi
        fi
    done

    echo "  OpenCode configs updated: $updated"
}

update_all_configs() {
    local command="$1"
    local args="$2"
    local opencode_cmd="$3"

    echo "Updating configs..."
    echo ""
    update_standard_configs "$command" "$args"
    update_opencode_configs "$opencode_cmd"
}

main() {
    local mode="${1:-toggle}"

    # Handle help flags
    if [[ "$mode" == "-h" || "$mode" == "--help" || "$mode" == "help" ]]; then
        show_help
    fi

    check_requirements
    print_header

    local current_command
    current_command=$(get_current_mode)

    case "$mode" in
        status)
            show_status
            exit 0
            ;;
        local)
            echo "Switching to LOCAL development mode..."
            echo ""
            if [[ ! -f "$PROJECT_ROOT/server/dist/index.js" ]]; then
                echo "Warning: Local build not found at:"
                echo "  $PROJECT_ROOT/server/dist/index.js"
                echo ""
                echo "Build first with: cd server && bun run build"
                echo ""
            fi
            update_all_configs "$LOCAL_COMMAND" "$LOCAL_ARGS" "$LOCAL_OPENCODE_CMD"
            ;;
        npm|package)
            echo "Switching to NPM package mode..."
            echo ""
            update_all_configs "$NPM_COMMAND" "$NPM_ARGS" "$NPM_OPENCODE_CMD"
            ;;
        toggle)
            if [[ "$current_command" == "node" || "$current_command" == "bun" ]]; then
                echo "Switching to NPM package mode..."
                echo ""
                update_all_configs "$NPM_COMMAND" "$NPM_ARGS" "$NPM_OPENCODE_CMD"
            else
                echo "Switching to LOCAL development mode..."
                echo ""
                if [[ ! -f "$PROJECT_ROOT/server/dist/index.js" ]]; then
                    echo "Warning: Local build not found. Build first:"
                    echo "  cd server && bun run build"
                    echo ""
                fi
                update_all_configs "$LOCAL_COMMAND" "$LOCAL_ARGS" "$LOCAL_OPENCODE_CMD"
            fi
            ;;
        *)
            echo "Unknown mode: $mode"
            echo ""
            echo "Usage: $0 [local|npm|status|toggle|-h]"
            echo ""
            echo "Run '$0 --help' for detailed usage."
            exit 1
            ;;
    esac

    echo ""
    echo "Done! Restart your AI tool to apply changes."
}

main "$@"
