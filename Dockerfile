# syntax=docker/dockerfile:1

# ---------- Stage 1: builder ----------
# We use the official Bun image for a fast, deterministic install that
# respects bun.lock. Native modules (better-sqlite3, embedder add-ons) need
# a toolchain, so we pull it in before `bun install`.
FROM oven/bun:1.3-debian AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      git \
      ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so the install layer caches cleanly.
COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

# Copy the rest of the source. The .dockerignore keeps node_modules,
# .env, .eliza and data/ out of the build context.
COPY tsconfig.json ./
COPY src ./src
COPY characters ./characters
COPY nos_job_def ./nos_job_def

# ---------- Stage 2: runtime ----------
# Same base so the prebuilt node_modules (with native .node files) stay
# binary-compatible. Minimal apt surface to keep the image small.
FROM oven/bun:1.3-debian AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV SERVER_PORT=3000
ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/characters ./characters
COPY --from=builder /app/nos_job_def ./nos_job_def

RUN mkdir -p /app/.eliza /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

# Run the ElizaOS CLI via bunx so we don't have to bake the CLI into deps
# twice. The CLI picks up src/index.ts via package.json#main and loads the
# SignalSage character + x402-smartflow plugin.
CMD ["bunx", "--bun", "@elizaos/cli", "start"]
