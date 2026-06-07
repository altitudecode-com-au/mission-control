# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# python3, make, g++ needed for native addons (node-pty, better-sqlite3)
RUN apk add --no-cache python3 make g++
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build the Next.js app ──────────────────────────────────────────
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.source="https://github.com/altitudecode/mission-control"
LABEL org.opencontainers.image.description="Mission Control — agent orchestration dashboard"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app
ENV NODE_ENV=production

# curl for health checks
RUN apk add --no-cache curl

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output from build stage
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

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
