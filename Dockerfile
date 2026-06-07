# Pin digest for cache stability — update periodically via dependabot or manually.
# Current: node 22.22.x on alpine 3.x (last pushed 2026-05-14)
# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS deps
RUN apk add --no-cache python3 make g++ \
    && corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build the Next.js app ──────────────────────────────────────────
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS build
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS runtime

LABEL org.opencontainers.image.source="https://github.com/altitudecode/mission-control"
LABEL org.opencontainers.image.description="Mission Control — agent orchestration dashboard"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app
ENV NODE_ENV=production

# curl for health checks, bash + git for agent runtime installers (OpenClaw, Hermes)
RUN apk add --no-cache curl bash git

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output from build stage
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/src/lib/schema.sql ./src/lib/schema.sql

# Data directory for SQLite / app state
RUN mkdir -p .data && chown nextjs:nodejs .data
VOLUME ["/app/.data"]

USER nextjs

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/status || exit 1

CMD ["node", "server.js"]
