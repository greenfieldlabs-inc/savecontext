#!/usr/bin/env python3
"""
SaveContext PostToolUse Hook
Updates ~/.savecontext/status-cache/ when MCP tools return session data.

This bridges remote MCP Lambda responses to local status line display.
Works identically for both local and cloud MCP servers.
"""

import json
import sys
import os
import re
import time
from pathlib import Path


def get_status_key():
    """Get status key using platform-specific terminal identification."""
    import subprocess
    import platform

    # Check explicit env var first (works on all platforms)
    status_key = os.environ.get('SAVECONTEXT_STATUS_KEY')
    if status_key:
        return re.sub(r'[/\\:*?"<>| ]', '_', status_key)[:100]

    system = platform.system()
    is_windows = system == 'Windows'
    is_wsl = system == 'Linux' and 'microsoft' in platform.release().lower()

    if is_windows or is_wsl:
        # Windows Terminal session GUID (works in native Windows and WSL)
        wt_session = os.environ.get('WT_SESSION')
        if wt_session:
            status_key = f"wt-{wt_session}"

        # ConEmu/Cmder terminal
        if not status_key:
            conemu_pid = os.environ.get('ConEmuPID') or os.environ.get('ConEmuServerPID')
            if conemu_pid:
                status_key = f"conemu-{conemu_pid}"

        # Windows session name (Console, RDP-Tcp#0, etc.)
        if not status_key:
            session_name = os.environ.get('SESSIONNAME')
            if session_name:
                # Combine with PID for uniqueness across multiple terminals
                ppid = os.getppid()
                status_key = f"win-{session_name}-{ppid}"

        # Fallback: use parent process ID (unique per terminal window)
        if not status_key:
            ppid = os.getppid()
            if ppid:
                prefix = "wslpid" if is_wsl else "winpid"
                status_key = f"{prefix}-{ppid}"

    if not status_key and system in ('Darwin', 'Linux'):
        # macOS/Linux: Try to get TTY from parent process (Claude Code)
        ppid = os.getppid()
        try:
            result = subprocess.run(
                ['ps', '-o', 'tty=', '-p', str(ppid)],
                capture_output=True, text=True, timeout=1
            )
            tty = result.stdout.strip()
            if tty and tty not in ('?', '??', '-'):
                status_key = f"tty-{tty}"
        except Exception:
            pass

        # macOS Terminal session ID
        if not status_key:
            term_session = os.environ.get('TERM_SESSION_ID')
            if term_session:
                status_key = f"term-{term_session}"

        # iTerm2 session ID
        if not status_key:
            iterm_session = os.environ.get('ITERM_SESSION_ID')
            if iterm_session:
                status_key = f"iterm-{iterm_session}"

        # Linux: GNOME Terminal
        if not status_key:
            gnome_term = os.environ.get('GNOME_TERMINAL_SERVICE')
            if gnome_term:
                status_key = f"gnome-{ppid}"

        # Linux: Konsole (KDE)
        if not status_key:
            konsole = os.environ.get('KONSOLE_DBUS_SESSION')
            if konsole:
                status_key = f"konsole-{ppid}"

        # Linux: Tilix
        if not status_key:
            tilix = os.environ.get('TILIX_ID')
            if tilix:
                status_key = f"tilix-{tilix}"

        # Linux: Kitty
        if not status_key:
            kitty = os.environ.get('KITTY_PID')
            if kitty:
                status_key = f"kitty-{kitty}"

        # Linux: Alacritty (uses PPID as fallback since no unique ID)
        if not status_key:
            alacritty = os.environ.get('ALACRITTY_SOCKET')
            if alacritty:
                status_key = f"alacritty-{ppid}"

        # Linux/macOS fallback: use parent process ID
        if not status_key:
            prefix = "linuxpid" if system == 'Linux' else "macpid"
            status_key = f"{prefix}-{ppid}"

    if not status_key:
        return None

    # Sanitize the key for use as filename
    return re.sub(r'[/\\:*?"<>| ]', '_', status_key)[:100]


def parse_tool_response(tool_response) -> dict | None:
    """Parse tool response from various formats into a dict."""

    # Handle Claude Code format: [{"type":"text","text":"{ JSON }"}]
    if isinstance(tool_response, list) and len(tool_response) > 0:
        first_item = tool_response[0]
        if isinstance(first_item, dict) and first_item.get('type') == 'text':
            try:
                tool_response = json.loads(first_item.get('text', '{}'))
            except json.JSONDecodeError:
                return None

    if not isinstance(tool_response, dict):
        return None

    # Check for success
    if not tool_response.get('success'):
        return None

    # Unwrap data field if present
    if 'data' in tool_response:
        return tool_response['data']

    return tool_response


def extract_session_info(tool_name: str, data: dict, cwd: str) -> dict | None:
    """Extract session info from parsed MCP tool response data."""

    if not data:
        return None

    # context_status - most complete session info
    if tool_name == 'mcp__savecontext__context_status':
        session_id = data.get('current_session_id')
        if session_id:
            return {
                'sessionId': session_id,
                'sessionName': data.get('session_name', ''),
                'projectPath': data.get('project_path', cwd),
                'itemCount': data.get('item_count', 0),
                'sessionStatus': data.get('status', 'active'),
                'provider': 'claude-code'
            }
        # No active session
        return {'clear': True}

    # context_session_start - new or resumed session
    if tool_name == 'mcp__savecontext__context_session_start':
        session_id = data.get('id')
        if session_id:
            return {
                'sessionId': session_id,
                'sessionName': data.get('name', ''),
                'projectPath': data.get('project_path', cwd),
                'itemCount': 0,
                'sessionStatus': data.get('status', 'active'),
                'provider': 'claude-code'
            }

    # context_session_resume - resumed session
    if tool_name == 'mcp__savecontext__context_session_resume':
        session_id = data.get('session_id')
        if session_id:
            return {
                'sessionId': session_id,
                'sessionName': data.get('session_name', ''),
                'projectPath': data.get('project_path', cwd),
                'itemCount': data.get('item_count', 0),
                'sessionStatus': 'active',
                'provider': 'claude-code'
            }

    # context_session_switch - switched to new session
    if tool_name == 'mcp__savecontext__context_session_switch':
        session_id = data.get('session_id')
        if session_id:
            return {
                'sessionId': session_id,
                'sessionName': data.get('current_session', ''),
                'projectPath': data.get('project_path', cwd),
                'itemCount': data.get('item_count', 0),
                'sessionStatus': 'active',
                'provider': 'claude-code'
            }

    # context_session_rename - update with new name
    if tool_name == 'mcp__savecontext__context_session_rename':
        session_id = data.get('session_id')
        new_name = data.get('new_name')
        if session_id and new_name:
            return {
                'sessionId': session_id,
                'sessionName': new_name,
                'projectPath': cwd,
                'itemCount': 0,  # Unknown after rename
                'sessionStatus': 'active',
                'provider': 'claude-code'
            }

    # context_session_pause - session paused, clear active display
    if tool_name == 'mcp__savecontext__context_session_pause':
        return {'clear': True}

    # context_session_end - session ended, clear active display
    if tool_name == 'mcp__savecontext__context_session_end':
        return {'clear': True}

    # context_prepare_compaction - may indicate session state
    if tool_name == 'mcp__savecontext__context_prepare_compaction':
        session_id = data.get('session_id')
        if session_id:
            return {
                'sessionId': session_id,
                'sessionName': data.get('session_name', ''),
                'projectPath': data.get('project_path', cwd),
                'itemCount': data.get('item_count', 0),
                'sessionStatus': 'active',
                'provider': 'claude-code'
            }

    # context_save - item saved, update item count
    if tool_name == 'mcp__savecontext__context_save':
        # Read existing cache to get session info, then increment item count
        return {'update_item_count': 1}

    # context_delete - item deleted, decrement item count
    if tool_name == 'mcp__savecontext__context_delete':
        # Read existing cache to get session info, then decrement item count
        return {'update_item_count': -1}

    # context_checkpoint - checkpoint created, has session info
    if tool_name == 'mcp__savecontext__context_checkpoint':
        session_id = data.get('session_id')
        if session_id:
            return {
                'sessionId': session_id,
                'sessionName': data.get('session_name', ''),
                'projectPath': data.get('project_path', cwd),
                'itemCount': data.get('item_count', 0),
                'sessionStatus': 'active',
                'provider': 'claude-code'
            }

    # context_restore - checkpoint restored, update with session info
    if tool_name == 'mcp__savecontext__context_restore':
        session_id = data.get('session_id')
        if session_id:
            return {
                'sessionId': session_id,
                'sessionName': data.get('session_name', ''),
                'projectPath': data.get('project_path', cwd),
                'itemCount': data.get('items_restored', 0),
                'sessionStatus': 'active',
                'provider': 'claude-code'
            }

    # Checkpoint tools that don't affect session display - explicitly ignore
    # These should NOT clear or modify the status cache
    checkpoint_readonly_tools = [
        'mcp__savecontext__context_list_checkpoints',
        'mcp__savecontext__context_get_checkpoint',
        'mcp__savecontext__context_checkpoint_add_items',
        'mcp__savecontext__context_checkpoint_remove_items',
        'mcp__savecontext__context_checkpoint_split',
        'mcp__savecontext__context_checkpoint_delete',
        'mcp__savecontext__context_tag',
    ]
    if tool_name in checkpoint_readonly_tools:
        return None  # Explicitly return None to preserve existing cache

    return None


def update_cache(status_key: str, session_info: dict) -> bool:
    """Write session info to cache file atomically."""
    cache_dir = Path.home() / '.savecontext' / 'status-cache'
    cache_dir.mkdir(parents=True, exist_ok=True)

    cache_file = cache_dir / f"{status_key}.json"
    temp_file = cache_dir / f".{status_key}.tmp"

    # Handle clear request - remove cache file
    if session_info.get('clear'):
        try:
            cache_file.unlink(missing_ok=True)
            return True
        except Exception:
            return False

    # Handle item count update - read existing cache and modify
    if 'update_item_count' in session_info:
        try:
            if cache_file.exists():
                with open(cache_file, 'r') as f:
                    existing = json.load(f)
                existing['itemCount'] = max(0, existing.get('itemCount', 0) + session_info['update_item_count'])
                existing['timestamp'] = int(time.time() * 1000)
                session_info = existing
            else:
                # No existing cache, nothing to update
                return True
        except Exception:
            return False

    session_info['timestamp'] = int(time.time() * 1000)

    try:
        with open(temp_file, 'w') as f:
            json.dump(session_info, f, indent=2)

        temp_file.rename(cache_file)
        return True
    except Exception:
        temp_file.unlink(missing_ok=True)
        return False


def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            sys.exit(0)

        hook_data = json.loads(raw_input)

        tool_name = hook_data.get('tool_name', '')

        # Only process SaveContext MCP tools
        if not tool_name.startswith('mcp__savecontext__'):
            sys.exit(0)

        tool_response = hook_data.get('tool_response')
        cwd = hook_data.get('cwd', os.getcwd())

        # Parse the response
        data = parse_tool_response(tool_response)

        # Extract session info based on tool type
        session_info = extract_session_info(tool_name, data, cwd)

        if session_info:
            status_key = get_status_key()
            if status_key:
                update_cache(status_key, session_info)

    except Exception:
        pass  # Silent failure - don't break Claude Code

    sys.exit(0)


if __name__ == '__main__':
    main()
