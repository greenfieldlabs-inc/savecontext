# =============================================================================
# SaveContext — Self-Hosted Docker Image
# Multi-stage build: Rust CLI + Bun MCP Server + Next.js Dashboard
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build Rust CLI
# ---------------------------------------------------------------------------
FROM rust:1.85-bookworm AS rust-builder
WORKDIR /build
COPY cli/ cli/
RUN cargo build --release --manifest-path cli/Cargo.toml

# ---------------------------------------------------------------------------
# Stage 2: Build MCP Server + Dashboard
# ---------------------------------------------------------------------------
FROM oven/bun:1 AS bun-builder
WORKDIR /build

# Copy workspace root files needed by both packages
COPY package.json pnpm-workspace.yaml bun.lock* ./
COPY migrations/ migrations/

# Server — install deps then build
COPY server/ server/
RUN cd server && bun install && bun run build

# Dashboard — install deps then build (skip postbuild pnpm fixer, not needed in Docker)
COPY dashboard/ dashboard/
RUN cd dashboard && bun install && bun --bun next build --webpack \
    && cp -r .next/static .next/standalone/dashboard/.next/ \
    && cp -r public .next/standalone/dashboard/ 2>/dev/null || true

# ---------------------------------------------------------------------------
# Stage 3: Runtime
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    ca-certificates \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun runtime
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# SSH setup
RUN mkdir -p /run/sshd /root/.ssh && chmod 700 /root/.ssh

# Copy Rust CLI binary
COPY --from=rust-builder /build/cli/target/release/sc /usr/local/bin/sc

# Copy MCP Server (dist + node_modules + package.json)
COPY --from=bun-builder /build/server/dist/ /opt/savecontext/server/dist/
COPY --from=bun-builder /build/server/node_modules/ /opt/savecontext/server/node_modules/
COPY --from=bun-builder /build/server/package.json /opt/savecontext/server/

# Copy Dashboard (Next.js standalone build)
COPY --from=bun-builder /build/dashboard/.next/standalone/ /opt/savecontext/dashboard/.next/standalone/
COPY --from=bun-builder /build/dashboard/.next/static/ /opt/savecontext/dashboard/.next/standalone/dashboard/.next/static/

# Config files
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/sshd_config /etc/ssh/sshd_config
RUN chmod +x /entrypoint.sh

# Data volume
RUN mkdir -p /data
ENV SAVECONTEXT_DB=/data/savecontext.db
ENV SC_BINARY_PATH=/usr/local/bin/sc

EXPOSE 22 3333

VOLUME ["/data"]

ENTRYPOINT ["/entrypoint.sh"]
