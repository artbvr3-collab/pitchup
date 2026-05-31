# Quick Navigation

> Find-by-concept index for this codebase. Updated whenever new modules or major features land.

---

## Find by concept

### Auth / sessions / onboarding
- **Provider config:** `src/auth/infrastructure/auth-config.ts`
- **`requireAuth` / `requireAdmin`:** `src/auth/application/`
- **Onboarding guard middleware:** `middleware.ts` (repo root)
- **Spec:** [docs/spec/pitchup-spec-global.md](./docs/spec/pitchup-spec-global.md) → "Authentication", "Onboarding guard", "Ban / account deletion"

### Match lifecycle (create / join / approve / kick / cancel / edit)
- **Domain:** `src/match_lifecycle/domain/` — `Match`, `MatchStatus`, `computeSlots`, `MatchRepository`
- **Use cases:** `src/match_lifecycle/application/` — one service per verb (`join-match-service.ts`, `approve-request-service.ts`, etc.)
- **Prisma adapters:** `src/match_lifecycle/infrastructure/`
- **Advisory lock helper:** `src/shared/db/with-match-lock.ts`
- **Spec:** [docs/spec/pitchup-spec-match.md](./docs/spec/pitchup-spec-match.md) — full lifecycle, per-endpoint checklist, race scenarios

### Create match (`/matches/new`)
- **Wizard (3-step client island):** `app/(private)/matches/new/wizard.tsx`
- **Server Component shell:** `app/(private)/matches/new/page.tsx`
- **Use case:** `src/match_lifecycle/application/create-match-service.ts` (no advisory lock — the match id doesn't exist yet)
- **Zod payload schema:** `src/match_lifecycle/application/dto/create-match-input.ts`
- **Venue listing port + adapter:** `src/match_lifecycle/domain/venue-repository.ts`, `src/match_lifecycle/infrastructure/prisma-venue-repository.ts`
- **Repo `create()`:** `src/match_lifecycle/infrastructure/prisma-match-repository.ts`
- **Domain errors:** `src/match_lifecycle/domain/errors.ts`
- **Route handlers:** `app/api/matches/route.ts` (POST), `app/api/venues/route.ts` (GET)
- **Spec:** [docs/spec/pitchup-spec-match.md](./docs/spec/pitchup-spec-match.md) → "/matches/new", "Per-endpoint checklist" → POST /matches

### Match discovery (`/games`)
- **URL-filter parser:** `src/match_lifecycle/application/discover-filters.ts` (Zod + cursor codec)
- **Paged service:** `src/match_lifecycle/application/list-discover-matches.ts`
- **Repository port:** `src/match_lifecycle/domain/match-repository.ts` (`findDiscoverPage`)
- **Prisma adapter (raw SQL: Prague-TZ extract, Haversine, keyset cursor):** `src/match_lifecycle/infrastructure/prisma-match-repository.ts`
- **Route handler (Show more / live search):** `app/api/matches/discover/route.ts`
- **Page (Server Component) + client islands:** `app/(public)/games/`
- **Spec:** [docs/spec/pitchup-spec-discovery.md](./docs/spec/pitchup-spec-discovery.md) → "/games"

### Time / TZ
- **Prague-day primitives:** `src/shared/time/prague.ts` (`pragueDay`, `pragueRange`, `todayPrague`, `addPragueDays`)
- **Spec:** [docs/spec/pitchup-spec-global.md](./docs/spec/pitchup-spec-global.md) → "Timezones & date ranges"

### Notifications (in-app inbox / browser / email)
- **Code:** `src/notifications/`
- **Spec:** [docs/spec/pitchup-spec-global.md](./docs/spec/pitchup-spec-global.md) → "Notifications", "Polling sync", "action → notification.type mapping"

### Moderation (reports / admin actions / Hide text)
- **Code:** `src/moderation/`
- **Spec:** [docs/spec/pitchup-spec-personal.md](./docs/spec/pitchup-spec-personal.md) → "/admin/reports", "Hide text (content moderation)"

### Polling
- **Client hook:** `src/ui/hooks/use-polling.ts`
- **Global poll handler:** `app/api/updates/state/route.ts`
- **Per-match poll handler:** `app/api/matches/[id]/state/route.ts`
- **Spec:** [docs/spec/pitchup-spec-global.md](./docs/spec/pitchup-spec-global.md) → "Polling sync", [docs/spec/pitchup-spec-match.md](./docs/spec/pitchup-spec-match.md) → "Polling for match state"

### Realtime chat (Ably pub/sub in v1, self-hosted Socket.io in v2)
- **Spec:** [docs/spec/pitchup-spec-match.md](./docs/spec/pitchup-spec-match.md) → "Realtime chat transport"
- **Status:** not yet implemented — design only. Polling already covers message delivery as fallback.

### UI kit (components, tokens, theme)
- **Components:** `src/ui/components/` — `TopBar`, `BottomNav`, `MatchCard`, `Button`, `Badge`, `Skeleton`, `BottomSheet`, ...
- **Tokens:** `src/ui/tokens.ts` + `tailwind.config.ts`
- **Visual catalog:** `app/design/page.tsx`
- **Design source:** `mockups/match.html` (canonical anchor — light palette, token list in header comment)

### Errors
- **Base hierarchy:** `src/shared/errors/app-error.ts`, `src/shared/errors/domain-error.ts`
- **Per-context errors:** `src/<context>/domain/errors.ts`
- **HTTP mapping:** `src/shared/errors/http-mapping.ts`
- **Conventions:** [docs/ARCHITECTURE.md §6](./docs/ARCHITECTURE.md)

### Config / env
- **Validation:** `src/shared/config/env.ts`
- **Template:** `.env.example`

### Database
- **Prisma client:** `src/shared/db/prisma.ts`
- **Schema:** `prisma/schema.prisma`
- **Migrations:** `prisma/migrations/`
- **Advisory lock:** `src/shared/db/with-match-lock.ts`

### Deployment / infrastructure (Layer 10)
- **Image build:** `Dockerfile` (stages: base/deps/build/runner/cron) + `.dockerignore`
- **Stack:** `docker-compose.yml` (db + app + caddy[`prod` profile] + cron[`cron`, run-only]) + `.env.production.example`
- **Entry / migrations:** `docker-entrypoint.sh` (`prisma migrate deploy` → `node server.js`)
- **Reverse proxy / TLS:** `caddy/Caddyfile` (Cloudflare Origin cert in `caddy/certs/`)
- **Cron + backups:** `scripts/run-cron.ts`, `deploy/crontab.example`, `deploy/backup.sh`
- **CI/CD:** `.github/workflows/deploy.yml` (CI gate → GHCR build → SSH deploy)
- **Runbook + decision:** [docs/deploy-runbook.md](./docs/deploy-runbook.md), [docs/adr/0006-deploy-topology.md](./docs/adr/0006-deploy-topology.md)

---

## Find by use case (when you have a "I need to..." task)

| Task | Where to start |
|---|---|
| Add a new endpoint | Service in `src/<context>/application/` → route handler in `app/api/.../route.ts` |
| Add a new screen | Page in `app/<group>/<route>/page.tsx`, use components from `src/ui/components/` |
| Add a new UI component | First in `src/ui/components/`, then exercise in `app/design/page.tsx`, only then in a real screen |
| Change DB schema | Edit `prisma/schema.prisma` → `pnpm prisma migrate dev --name <slug>` → update repositories/types |
| Add an HTTP error code | Add error class to `src/shared/errors/` or context-local `errors.ts` → register in `src/shared/errors/http-mapping.ts` |
| Make an architectural decision | Write ADR in `docs/adr/NNNN-short-slug.md`, then update [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) if pattern changes |
| Wire a new external service | Port in `src/<context>/domain/` → impl in `src/<context>/infrastructure/` → register in `src/<context>/composition.ts` |

---

## Find by external integration

- **Google OAuth** → `src/auth/infrastructure/auth-config.ts`
- **Postgres** → `src/shared/db/prisma.ts`
- **MapLibre + OSM** → `src/ui/components/map.tsx` (when added)
- **Email sender** (provider TBD) → `src/notifications/infrastructure/email-sender.ts` (when added)

---

## Spec navigation (functional behavior)

- **Entry point:** [docs/spec/pitchup-spec-INDEX.md](./docs/spec/pitchup-spec-INDEX.md)
- **App map (ERD + status table):** [docs/spec/pitchup-app-map.md](./docs/spec/pitchup-app-map.md)
- **Glossary (disputed pairs §9):** [docs/spec/_translation-glossary.md](./docs/spec/_translation-glossary.md)
- **Spec working rules:** [docs/spec/CLAUDE.md](./docs/spec/CLAUDE.md)
