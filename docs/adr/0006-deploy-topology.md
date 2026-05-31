# ADR-0006: Single-VPS Docker Compose deploy (self-hosted Postgres, GHCR pull, Caddy + Cloudflare)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Pr1ce (owner) + Claude (Layer 10)

## Context

Layers 0–9 ship a complete Next.js 15 app (App Router, standalone-capable) with a
Prisma/Postgres data layer, Auth.js v5 Google OAuth, optional Resend email
(ADR-0004) and Ably realtime (ADR-0005), plus four server-side cron jobs
(Layer 7b: morning reminders ×2, auto-reject-pending, inbox-TTL) that have no
HTTP entry point by design (spec: "cron is server-side, never user-triggered").

We now need to run this in production on the domain `pitchup.online`. Constraints
and forces:

- **One small VPS**, already provisioned but bare (no Docker, no config). Hobby
  scale; cost-sensitive; owner is a vibe coder, so *fewer moving parts and less
  ongoing maintenance* beats theoretical elegance.
- Dev used **Neon** (managed Postgres). Production DB host is an open question.
- The cron jobs run **TypeScript** (`scripts/run-cron.ts`) against the same wired
  services as the app, but the app's production artifact is a slim standalone
  bundle that cannot execute TS.
- Cloudflare is in the picture (the roadmap says "Cloudflare proxy") for DNS,
  DDoS, and hiding the origin IP.
- `NEXT_PUBLIC_*` env vars (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY`)
  are **inlined into the client bundle at build time**, not read at runtime.

## Decision

Deploy as a **single-VPS Docker Compose stack**, images **built in GitHub Actions
and pulled from GHCR**, fronted by **Caddy** behind a **proxied Cloudflare** zone.

### 1. Database — self-hosted Postgres in Compose

- **Option A — keep Neon for prod:** managed backups/scaling, zero DB ops.
  Rejected: the owner wants the whole stack self-contained on the one VPS, and a
  hobby app doesn't need Neon's managed tier in prod.
- **Option B — self-hosted Postgres container + named volume:** ✅ chosen.
  Everything lives on the VPS; `pg_dump` cron handles backups. Costs: we own
  backups/restore and a one-off Neon→VPS data carry (or a clean start).

### 2. Image delivery — build in CI, pull on the VPS (GHCR)

- **Build on the VPS** (`git pull && docker build`): rejected — burns VPS CPU,
  needs a build toolchain on the box, slower deploys.
- **Build in GitHub Actions → push to GHCR → VPS `docker compose pull`:** ✅ chosen.
  The VPS only ever pulls. Versioned by `:sha`. `NEXT_PUBLIC_*` are passed as
  `--build-arg` in CI (they must be present at build, see Context).

### 3. Two images — slim app runner + a tsx cron image

The slim standalone runner can't run the TS cron. Options:

- **Bundle the cron entry with esbuild into the runner:** rejected for v1 — adds a
  new build dependency (CODING_STANDARDS §14) and a Prisma-externalization step
  that's easy to get subtly wrong.
- **One fat image (app + source + tsx):** rejected — bloats the frequently
  pulled/restarted app image.
- **A second `cron` Docker stage** (source + deps + `tsx`) running the *same*
  `scripts/run-cron.ts` the dev CLI uses: ✅ chosen. The app image stays slim;
  the cron image is pulled rarely. Behaviour matches dev exactly (lowest risk).
  Note: the `cron` stage is the Dockerfile's last stage, so the `app` build pins
  `target: runner` (else the default target would be `cron`).

### 4. Scheduling — host crontab, not an in-container scheduler

- **Vercel Cron / platform scheduler:** unavailable on the Caddy/Docker target.
- **In-container scheduler (supercronic/ofelia):** rejected — extra binary + a
  24/7 service for four short jobs.
- **Host crontab** invoking `docker compose run --rm cron <command>`: ✅ chosen.
  Uses the OS scheduler everyone knows; `CRON_TZ=Europe/Prague` keeps the slots
  DST-correct. `pg_dump` backups are another crontab line (`deploy/backup.sh`).
  The `cron` compose service sits under a `cron` profile so `up` never starts it.

### 5. TLS — Cloudflare Origin Certificate served by stock Caddy

Cloudflare is **proxied** (orange cloud), SSL mode **Full (strict)**.

- **Let's Encrypt via Caddy auto-HTTPS (HTTP-01):** rejected — the orange cloud
  intercepts the ACME challenge on :443, so issuance fails.
- **Let's Encrypt via the Cloudflare DNS-01 challenge:** auto-renewing and works
  behind the proxy, but needs a *custom* Caddy build (xcaddy + the cloudflare-dns
  module) and a CF API token — more to maintain. Documented as the alternative in
  the runbook, not the default.
- **Cloudflare Origin Certificate + stock `caddy:2-alpine`:** ✅ chosen. One-time
  manual cert (15-year, trusted only by Cloudflare — exactly the Full(strict)
  use case), mounted read-only; no ACME, effectively no renewal.

### 6. Migrations — `prisma migrate deploy` in the container entrypoint

`docker-entrypoint.sh` runs `prisma migrate deploy` (idempotent) before
`node server.js`, fail-fast. The runner image carries a pinned global
`prisma@6.19.3` CLI for this (the slim bundle doesn't include it). Compose
orders the app after a healthy `db`.

### 7. Compose profiles split the topology

`caddy` is under `profiles:["prod"]`, `cron` under `profiles:["cron"]`. The VPS
sets `COMPOSE_PROFILES=prod` so `docker compose up -d` starts db+app+caddy;
`cron` is `run`-only. Locally (no profile) `up` runs db+app only, app on
localhost:3000 — so the same compose file serves dev smoke and prod.

## Consequences

**Easier:** the entire stack is one `docker compose` file on one box; deploys are
`pull && up -d`; backups are a gzipped file; the same compose file works locally
and in prod; cron uses the exact dev code path.

**Harder / new obligations:**
- We own Postgres backups + restore drills (`deploy/backup.sh`, 14-day retention).
- A one-off Neon→VPS data migration (or a clean start) — see the runbook.
- Two images to build/push (app + cron); CI is slightly longer.
- The Cloudflare Origin Certificate is a manual step; if we ever drop the orange
  cloud, switch to DNS-01 (runbook) since the Origin cert isn't publicly trusted.
- `docker compose up -d` recreates the app container on deploy → a few seconds of
  downtime while migrate runs (acceptable at this scale; revisit with a
  blue/green or healthcheck-gated swap if it matters).
- `NEXT_PUBLIC_*` are build-time — changing the public URL or Ably key requires a
  rebuild, not just an env edit.

## References

- Code: `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`,
  `caddy/Caddyfile`, `deploy/crontab.example`, `deploy/backup.sh`,
  `.github/workflows/deploy.yml`, `scripts/run-cron.ts`,
  `src/auth/infrastructure/auth-config.ts` (`trustHost`)
- Docs: `docs/deploy-runbook.md`, `docs/ROADMAP.md` (Layer 10)
- Related ADRs: ADR-0003 (Prisma), ADR-0004 (Resend email), ADR-0005 (Ably)
- External: Cloudflare Origin CA; Caddy reverse_proxy/tls; Next.js
  `output: 'standalone'`; GHCR; `docker/build-push-action`
