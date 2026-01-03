#!/usr/bin/env python3
"""
SaveContext Status Line for Claude Code
Session tracking with accurate context usage from transcript parsing
"""

import json
import sys
import os
import re
import subprocess
import time

# ============================================================================
# SaveContext Session Cache
# ============================================================================

def get_savecontext_session():
    """Read SaveContext session from cache using platform-specific key resolution."""
    import platform
    cache_dir = os.path.expanduser("~/.savecontext/status-cache")

    # Check explicit env var first (works on all platforms)
    status_key = os.environ.get('SAVECONTEXT_STATUS_KEY')

    system = platform.system()
    is_windows = system == 'Windows'
    is_wsl = system == 'Linux' and 'microsoft' in platform.release().lower()

    if not status_key and (is_windows or is_wsl):
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
                ppid = os.getppid()
                status_key = f"win-{session_name}-{ppid}"

        # Fallback: use parent process ID
        if not status_key:
            ppid = os.getppid()
            if ppid:
                prefix = "wslpid" if is_wsl else "winpid"
                status_key = f"{prefix}-{ppid}"

    if not status_key and system in ('Darwin', 'Linux'):
        # macOS/Linux: Try to get TTY from parent process
        ppid = os.getppid()
        try:
            result = subprocess.run(
                ['ps', '-o', 'tty=', '-p', str(ppid)],
                capture_output=True, text=True, timeout=1
            )
            tty = result.stdout.strip()
            if tty and tty not in ('?', '??', '-'):
                status_key = f"tty-{tty}"
        except:
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

        # Linux: Alacritty
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

    status_key = re.sub(r'[/\\:*?"<>| ]', '_', status_key)[:100]
    cache_file = os.path.join(cache_dir, f"{status_key}.json")

    if not os.path.exists(cache_file):
        return None

    try:
        with open(cache_file, 'r') as f:
            data = json.load(f)

        timestamp = data.get('timestamp', 0)
        now_ms = int(time.time() * 1000)
        if now_ms - timestamp > 7200000:  # 2 hours
            os.remove(cache_file)
            return None

        return data
    except:
        return None

# ============================================================================
# Context Usage from Transcript
# ============================================================================

def parse_context_from_transcript(transcript_path):
    """Parse token usage and threshold from transcript."""
    if not transcript_path or not os.path.exists(transcript_path):
        return None

    try:
        with open(transcript_path, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()

        # Collect ALL compact_boundary preTokens, use median (robust to outliers)
        all_pre_tokens = []
        for line in lines:
            # Fast string filter before expensive JSON parsing
            if 'compact_boundary' not in line:
                continue
            try:
                data = json.loads(line.strip())
                if (data.get('type') == 'system' and
                    data.get('subtype') == 'compact_boundary'):
                    pre_tokens = data.get('compactMetadata', {}).get('preTokens', 0)
                    if pre_tokens > 0:
                        all_pre_tokens.append(pre_tokens)
            except:
                continue

        # Use median as threshold (handles outlier compaction points)
        threshold = None
        if all_pre_tokens:
            sorted_tokens = sorted(all_pre_tokens)
            mid = len(sorted_tokens) // 2
            if len(sorted_tokens) % 2 == 0:
                threshold = (sorted_tokens[mid - 1] + sorted_tokens[mid]) // 2
            else:
                threshold = sorted_tokens[mid]

        # Find current token count from most recent assistant message
        recent_lines = lines[-30:] if len(lines) > 30 else lines
        for line in reversed(recent_lines):
            try:
                data = json.loads(line.strip())
                if data.get('type') == 'assistant':
                    usage = data.get('message', {}).get('usage', {})
                    if usage:
                        input_tokens = usage.get('input_tokens', 0)
                        cache_read = usage.get('cache_read_input_tokens', 0)
                        cache_creation = usage.get('cache_creation_input_tokens', 0)
                        total_tokens = input_tokens + cache_read + cache_creation
                        if total_tokens > 0:
                            # Calculate percent using threshold if available
                            if threshold:
                                percent = min(100, (total_tokens / threshold) * 100)
                            else:
                                percent = None
                            return {
                                'tokens': total_tokens,
                                'threshold': threshold,
                                'percent': percent
                            }
            except:
                continue

        return None

    except (FileNotFoundError, PermissionError):
        return None

# ============================================================================
# Visual Components
# ============================================================================

def format_tokens(tokens):
    """Format token count as human-readable (e.g., 104k)."""
    if tokens >= 1000:
        return f"{tokens / 1000:.0f}k"
    return str(tokens)

def get_context_display(context_info):
    """Generate context bar with token count and color-coded usage."""
    if not context_info:
        return "\033[90m---\033[0m"

    tokens = context_info.get('tokens', 0)
    percent = context_info.get('percent')

    # Format token count
    token_str = format_tokens(tokens)

    # If no threshold/percent available, just show tokens
    if percent is None:
        return f"\033[32m{token_str}\033[0m"

    # Color based on usage level (higher = worse)
    if percent >= 95:
        color = "\033[31;1m"  # Bold red - critical
    elif percent >= 85:
        color = "\033[31m"  # Red
    elif percent >= 70:
        color = "\033[33m"  # Yellow
    else:
        color = "\033[32m"  # Green

    # Progress bar (shows how full context is)
    segments = 10
    filled = int((percent / 100) * segments)
    bar = "\033[90m[\033[0m" + color + "█" * filled + "\033[0m" + "░" * (segments - filled) + "\033[90m]\033[0m"

    return f"{color}{token_str}\033[0m {bar} {color}{percent:.0f}%\033[0m"

def get_session_metrics(cost_data):
    """Get session metrics display."""
    if not cost_data:
        return ""

    metrics = []

    cost_usd = cost_data.get('total_cost_usd', 0)
    if cost_usd > 0:
        if cost_usd >= 1:
            cost_str = f"${cost_usd:.2f}"
            metrics.append(f"\033[31m{cost_str}\033[0m")
        elif cost_usd >= 0.10:
            cost_str = f"${cost_usd:.2f}"
            metrics.append(f"\033[33m{cost_str}\033[0m")
        else:
            cost_str = f"${cost_usd:.3f}"
            metrics.append(f"\033[32m{cost_str}\033[0m")

    duration_ms = cost_data.get('total_duration_ms', 0)
    if duration_ms > 0:
        minutes = duration_ms / 60000
        if minutes < 1:
            duration_str = f"{duration_ms//1000}s"
        elif minutes < 60:
            duration_str = f"{int(minutes)}m"
        else:
            hours = minutes / 60
            duration_str = f"{hours:.1f}h"
        metrics.append(duration_str)

    lines_added = cost_data.get('total_lines_added', 0)
    lines_removed = cost_data.get('total_lines_removed', 0)
    if lines_added > 0 or lines_removed > 0:
        net = lines_added - lines_removed
        sign = "+" if net >= 0 else ""
        if net > 0:
            metrics.append(f"\033[32m{sign}{net}\033[0m")
        elif net < 0:
            metrics.append(f"\033[31m{net}\033[0m")
        else:
            metrics.append("±0")

    return " ".join(metrics) if metrics else ""

# ============================================================================
# Main
# ============================================================================

def main():
    try:
        data = json.load(sys.stdin)

        transcript_path = data.get('transcript_path', '')
        cost_data = data.get('cost', {})

        sc_session = get_savecontext_session()
        context_info = parse_context_from_transcript(transcript_path)

        context_display = get_context_display(context_info)
        metrics = get_session_metrics(cost_data)

        parts = []

        # SaveContext branding + session
        if sc_session:
            session_name = sc_session.get('sessionName', '')
            if session_name:
                if len(session_name) > 40:
                    session_name = session_name[:37] + "..."
                parts.append(f"\033[95mSaveContext\033[0m  \033[90m|\033[0m  \033[93mCurrent Session:\033[0m {session_name}")
        else:
            parts.append(f"\033[95mSaveContext\033[0m  \033[90m|\033[0m  \033[90mNo Active Session\033[0m")

        # Context usage
        parts.append(f"\033[90mContext:\033[0m {context_display}")

        # Session metrics
        if metrics:
            parts.append(metrics)

        print("  ".join(parts))

    except Exception as e:
        print(f"\033[95mSaveContext\033[0m  \033[31mError: {str(e)[:30]}\033[0m")

if __name__ == "__main__":
    main()
