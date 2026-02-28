#!/bin/bash
set -e

ENABLE_SSH="${ENABLE_SSH:-true}"
ENABLE_DASHBOARD="${ENABLE_DASHBOARD:-true}"
SSH_PASSWORD="${SSH_PASSWORD:-savecontext}"

# Ensure DB file exists on the volume — schema auto-applies on first use
# (sc init doesn't respect SAVECONTEXT_DB; Storage::open + apply_schema handles it)
touch /data/savecontext.db

# SSH — provides CLI access, sync, and MCP (via stdio pipe)
if [ "$ENABLE_SSH" = "true" ]; then
    # Generate host keys if missing (persisted via volume)
    [ ! -f /etc/ssh/ssh_host_rsa_key ] && ssh-keygen -t rsa -f /etc/ssh/ssh_host_rsa_key -N ""
    [ ! -f /etc/ssh/ssh_host_ed25519_key ] && ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N ""

    # Set root password for SSH login
    echo "root:$SSH_PASSWORD" | chpasswd

    # Also support key-based auth if keys are mounted
    if [ -f /root/.ssh/authorized_keys ]; then
        chmod 600 /root/.ssh/authorized_keys 2>/dev/null || true
    fi

    /usr/sbin/sshd
    echo "[savecontext] SSH enabled on port 22 (password: $SSH_PASSWORD)"
    if [ "$SSH_PASSWORD" = "savecontext" ]; then
        echo "[savecontext] WARNING: Using default password. Set SSH_PASSWORD for production."
    fi
fi

# Dashboard
if [ "$ENABLE_DASHBOARD" = "true" ]; then
    cd /opt/savecontext/dashboard
    PORT=3333 SAVECONTEXT_DB=/data/savecontext.db bun .next/standalone/dashboard/server.js &
    echo "[savecontext] Dashboard enabled on port 3333"
fi

# Keep container alive (SSH + dashboard are background processes)
echo "[savecontext] Ready. Services: SSH=$ENABLE_SSH, Dashboard=$ENABLE_DASHBOARD"
tail -f /dev/null
