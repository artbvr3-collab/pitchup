# syntax=docker/dockerfile:1.7
#
# MODULE: deploy.image
# PURPOSE: Build the PITCHUP production image — a slim Next.js standalone server
#          plus a pinned Prisma CLI for `migrate deploy` at container start.
# LAYER: infrastructure / deploy (Layer 10a)
# RELATED DOCS: docs/adr/0006-deploy-topology.md, docs/ROADMAP.md (Layer 10)
#
# Stages:
#   base   — Node 22 (Debian slim) + pnpm via corepack + openssl (Prisma).
#   deps   — install ALL deps from the frozen lockfile with a HOISTED
#            node_modules (flat, npm-like) so Next standalone tracing + the
#            Prisma engine copy behave on the well-trodden path.
#   build  — prisma generate + `next build` → `.next/standalone`.
#            NEXT_PUBLIC_* are inlined HERE (build time) — they arrive as
#            --build-arg from CI, never as runtime env.
#   runner — slim runtime: standalone server + static + public + generated
#            Prisma client/engine + a pinned global Prisma CLI + schema.
#   cron   — tsx-capable image (source + deps) for the 4 scheduled jobs; runs
#            the same scripts/run-cron.ts as the dev CLI. Host cron triggers it
#            via `docker compose run --rm cron <command>`.
#
# Build (CI / local):
#   docker build \
#     --build-arg NEXT_PUBLIC_APP_URL=https://pitchup.online \
#     --build-arg NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY=<subscribe-key> \
#     -t ghcr.io/<owner>/pitchup:<sha> .

# ---- base -------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# openssl: Prisma query/schema engines need it at build and runtime.
# ca-certificates: TLS to Neon during the one-off data migration / outbound APIs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# ---- deps -------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# Force a flat (hoisted) node_modules — pnpm's default symlinked store is not
# reliably traceable by Next standalone, and is not copyable out of the stage.
# The lockfile is linker-agnostic, so --frozen-lockfile still holds.
RUN printf 'node-linker=hoisted\n' > .npmrc
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.npmrc ./.npmrc
COPY . .

# NEXT_PUBLIC_* are compiled into the client bundle by `next build`. Declare as
# build args; CI passes the real production values. Also exported to ENV so the
# build process and any prerender see them.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY=$NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY

# `src/shared/config/env.ts` validates required SERVER env at import time, and
# `next build` imports it while collecting routes. Provide throwaway values so
# the build doesn't fail — the REAL values are injected at runtime by compose.
# These are never present in the final image (build stage only).
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime-000000
ENV AUTH_GOOGLE_ID=build-placeholder
ENV AUTH_GOOGLE_SECRET=build-placeholder
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm exec prisma generate
RUN pnpm run build

# Next's public/ dir is optional and this repo ships none. The runner copies it
# unconditionally, so guarantee an (empty) one exists to keep the COPY valid.
RUN mkdir -p /app/public

# ---- runner -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Pinned Prisma CLI (matches @prisma/client 6.19.3) for `migrate deploy` at
# container start. A clean global install yields a self-contained binary.
RUN npm install -g prisma@6.19.3 && npm cache clean --force

# Schema + migrations (consumed by `prisma migrate deploy`).
COPY --from=build /app/prisma ./prisma

# Standalone server + assets.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Generated Prisma client + query engine — standalone tracing can miss .prisma.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run as the unprivileged user the base node image already ships.
USER node

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]

# ---- cron -------------------------------------------------------------------
# Separate image for the 4 scheduled jobs. The slim runner can't execute
# TypeScript; this stage carries the full source + deps (incl. tsx) and runs the
# same scripts/run-cron.ts the dev CLI uses. Invoked on demand by the host
# crontab (`docker compose run --rm cron <command>`) — see deploy/crontab.example.
FROM base AS cron
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.npmrc ./.npmrc
COPY . .
RUN pnpm exec prisma generate
# Args (e.g. `morning-today`) are appended by `docker compose run cron <args>`.
ENTRYPOINT ["pnpm", "exec", "tsx", "scripts/run-cron.ts"]
