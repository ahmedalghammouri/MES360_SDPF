# ============================================================
# MES360° API - Multi-Stage Dockerfile
# ============================================================

# Base
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++ openssl openssl-dev
WORKDIR /app
RUN npm install -g pnpm@9

# Dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml* .npmrc* ./
RUN pnpm install --no-frozen-lockfile

# Development
FROM base AS development
WORKDIR /app
COPY package.json .npmrc* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
# Retry: the Prisma engine download from binaries.prisma.sh is occasionally flaky.
RUN for i in 1 2 3 4 5; do node node_modules/.bin/prisma generate && break || { echo "prisma generate failed (attempt $i/5), retrying in 8s…"; sleep 8; }; done
EXPOSE 3001
CMD ["pnpm", "start:dev"]

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Retry: the Prisma engine download from binaries.prisma.sh is occasionally flaky.
RUN for i in 1 2 3 4 5; do node node_modules/.bin/prisma generate && break || { echo "prisma generate failed (attempt $i/5), retrying in 8s…"; sleep 8; }; done
RUN pnpm build

# Production
FROM node:20-alpine AS production
# dumb-init: PID-1 signal handling | openssl: required by the Prisma query engine
RUN apk add --no-cache dumb-init openssl
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./
# tsconfig is needed so ts-node can run the master-data seed (prisma/prod-init.js)
COPY --from=builder --chown=nestjs:nodejs /app/tsconfig*.json ./

RUN mkdir -p logs && chown nestjs:nodejs logs

USER nestjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1));"

CMD ["dumb-init", "node", "dist/main.js"]
