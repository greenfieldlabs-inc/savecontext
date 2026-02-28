#!/bin/bash
# SaveContext Docker Setup
# Generates SSH key, configures remote, and starts the container.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KEY_PATH="$HOME/.ssh/savecontext_docker"
AUTH_KEYS="$SCRIPT_DIR/authorized_keys"
PORT="${SC_DOCKER_PORT:-2222}"
DB_PATH="${SC_DOCKER_DB:-/data/savecontext.db}"

echo "SaveContext Docker Setup"
echo "========================"
echo

# Step 1: SSH key
if [ -f "$KEY_PATH" ]; then
    echo "[1/4] SSH key exists: $KEY_PATH"
else
    echo "[1/4] Generating SSH key..."
    ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "savecontext-docker"
fi

# Copy public key for Docker mount
cp "$KEY_PATH.pub" "$AUTH_KEYS"
echo "  Public key -> $AUTH_KEYS"

# Step 2: Build and start container
echo
echo "[2/4] Building and starting container..."
cd "$SCRIPT_DIR"
docker compose build
docker compose up -d

# Wait for SSH to be ready
echo -n "  Waiting for SSH..."
for i in $(seq 1 15); do
    if ssh -p "$PORT" -i "$KEY_PATH" -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new root@localhost 'true' 2>/dev/null; then
        echo " ready."
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo " timeout."
        echo "  SSH may not be ready yet. Try: ssh -p $PORT -i $KEY_PATH root@localhost"
        exit 1
    fi
    echo -n "."
    sleep 2
done

# Step 3: Configure sc remote
echo
echo "[3/4] Configuring sc remote..."
sc config remote set \
    --host localhost \
    --user root \
    --port "$PORT" \
    --identity-file "$KEY_PATH" \
    --remote-db-path "$DB_PATH"

# Step 4: Verify
echo
echo "[4/4] Verifying connection..."
REMOTE_VERSION=$(ssh -p "$PORT" -i "$KEY_PATH" -o BatchMode=yes root@localhost 'sc version' 2>&1) || true
echo "  Remote sc: $REMOTE_VERSION"

echo
echo "Setup complete. Available commands:"
echo "  sc sync push --full    # Push entire database to Docker"
echo "  sc sync pull --full    # Pull entire database from Docker"
echo "  sc sync push           # Push JSONL (project-scoped)"
echo "  sc sync pull           # Pull JSONL (project-scoped)"
echo
echo "  ssh -p $PORT -i $KEY_PATH root@localhost   # SSH into container"
