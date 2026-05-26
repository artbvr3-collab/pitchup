# PITCHUP — Build Roadmap

> **What this is.** A layer-by-layer status board for the build. The spec (`docs/spec/`) tells you *what* the system does; `ARCHITECTURE.md` tells you *how* it's structured; this file tells you **where we are right now**.
>
> **How to update.** When a layer completes, change its status and add a one-line note. When a layer starts, mark it `in progress`. Don't write a diary — keep it terse.
>
> **Audience.** Anyone (human or AI) opening a fresh chat on this repo. Read this first to know what to skip and what to pick up.

---

## Pre-code phase (done)

These artifacts are locked. Don't re-litigate them without an ADR.

| Artifact | Status | Path |
|---|---|---|
| Functional spec (4 parts + INDEX + app-map, EN) | ✅ Locked | [`docs/spec/pitchup-spec-INDEX.md`](./spec/pitchup-spec-INDEX.md) |
| Code-side universal principles | ✅ Locked | [`CODING_STANDARDS.md`](../CODING_STANDARDS.md) |
| Project-specific architecture (layouts, patterns) | ✅ Locked | [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) |
| ADR-0001 REST Route Handlers default | ✅ Accepted | [`docs/adr/0001-…`](./adr/0001-rest-routes-over-server-actions.md) |
| ADR-0002 Throw `AppError` hierarchy | ✅ Accepted | [`docs/adr/0002-…`](./adr/0002-throw-with-app-error-hierarchy.md) |
| ADR-0003 Repository ports + Prisma | ✅ Accepted | [`docs/adr/0003-…`](./adr/0003-repository-port-pattern-with-prisma.md) |
| Brand: name + domain + logo + palette | ✅ Locked 2026-05-24 | name PITCHUP, domain `pitchup.online`, logo Concept 4 (`PITCH` + lime `UP` pill), tokens in `mockups/match.html` |
| Mockup anchor — login / landing | ✅ Ready | [`mockups/login.html`](../mockups/login.html) |
| Mockup anchor — match detail (canonical tokens) | ✅ Ready | [`mockups/match.html`](../mockups/match.html) |
| Mockup anchor — Create Match wizard (3 steps) | ✅ Ready | [`mockups/create-match.html`](../mockups/create-match.html) |

---

## Implementation layers (vertical slices)

Each layer is a thin end-to-end slice — not a horizontal cut. Pick the next `▢ Not started` row and finish it before moving on.

| # | Layer | Status | Scope |
|---|---|---|---|
| **0** | **Bare scaffold** | ✅ Done 2026-05-24 | `package.json` (pnpm + Next 15 + React 19 + TS 5 strict) + `tsconfig` (strict, `@/*` alias) + Tailwind v3 wired to canonical tokens (`app/globals.css` + `tailwind.config.ts`) + Radix-based hand-rolled UI primitives (Button, Card, Chip, Input, Stepper, Switch, Checkbox) + `/design` catalog + `about.md` per bounded context. **No auth, no DB, no business logic.** Note: introduced `--border-strong #C7C0B3` from `create-match.html` (was missing from match.html canonical list, now backported to it). Catalog lives at `/design` not `/_design` (Next.js excludes `_`-prefixed folders from routing). |
| **1** | **Auth slice** | ✅ Done 2026-05-25 | Prisma + `User` table + Auth.js v5 (Google OAuth) + `/login` + `/welcome` + `/my-matches` stub + `requireAuth()` + onboarding middleware + Vitest unit tests. Prisma pinned to 6.x (Prisma 7 → ADR). Spec `/login` re-synced to mockup (was drifted). Mockup `mockups/login.html` is canonical. Not exercised against a live DB / OAuth — `DATABASE_URL` / `AUTH_GOOGLE_*` are placeholders. Real end-to-end smoke moves to whichever layer first needs a live database (Layer 2). |
| **2** | **Read-only Discover (skeleton)** | ✅ Done 2026-05-26 | Prisma `Match` + `Venue` tables (full app-map shape) + DDL/seed migrations. `match_lifecycle` domain (branded ids, `computeSlots` and `deriveMatchStatus` canonical pure functions) + `MatchRepository` port + `PrismaMatchRepository` adapter (JOINs venue, sorts `(startTime ASC, id ASC)`, excludes cancelled / past). `ListDiscoverMatchesService` decorates rows with status + slots. `/games` Server Component + `MatchCard` UI component (no cover image yet — pending venue photos; status pill in card header, Prague-TZ formatting). Middleware whitelists `/games` for guests. 20 Vitest unit tests passing. **First live DB exercise** — Neon Postgres reachable, `migrate deploy` applied cleanly, end-to-end render verified in preview (Open / AlmostFull / Full statuses, slot math, Free/Kč pricing). Filters / day picker / cursor pagination intentionally deferred to Layer 2.5. |
| **2.5** | **Discover filters + pagination** | ✅ Done 2026-05-26 | Canonical Prague-TZ primitives (`src/shared/time/prague.ts` — `pragueDay` 23h/25h DST-aware) + `DiscoverFilters` Zod parser with whitelist fallback (invalid params → today / drop, never throw) + extended `MatchRepository.findDiscoverPage` port returning `{rows, nextCursor}` + raw-SQL Prisma adapter (Prague-hour `EXTRACT`, `total_spots` bands for game size, derived `free_slots` for spots-left, ILIKE venue search with `%/_` escaping, Haversine distance, keyset cursor on `(start_time, id)`) + first `GET /api/matches/discover` route handler + rewritten `/games` Server Component delegating to client islands (DayPicker, FilterBar, MoreFiltersSheet, DistanceBanner, Show more). URL filters via `router.replace` (RSC refresh); search + Show more via client `fetch` to the API; `?date=` defaults to `today_prague(now)`. Distance silently dropped server-side (no localStorage); banner + client refetch take over after hydration. 62 unit tests passing (Prague DST 2026-03-29 / 10-25, cursor round-trip, filter whitelist edges); end-to-end smoke against live Neon DB + preview confirmed (day picker, filter sheet Apply/Reset, search live-fetch, distance-banner conditional, `?free=1` filter). Bottom-sheet hand-rolled (no Radix Dialog dep yet — first reuse case in Layer 5 captain-sheet will be the moment to extract). |
| **3** | **Create match** | ✅ Done 2026-05-26 | `VenueRepository` port + Prisma adapter (`listActive` / `findById`) + `MatchRepository.create()` (no advisory lock — id doesn't exist yet, per spec). `CreateMatchService` validates: start_time ≥ now+30min, start_time < prague_day(today+20).utcEnd, total_spots ∈ [8, 30], crew names trim+≤30, `1 + crew.length ≤ total_spots`, surface ∈ venue.surface, studs forced `false` on hard, venue active. `coverId` snapshotted from venue at INSERT. Domain errors in `match_lifecycle/domain/errors.ts` (`invalid_start_time` / `too_far_ahead` / `invalid_total_spots` / `invalid_crew_name` / `captain_crew_overflow` / `invalid_surface` / `venue_not_found` / `venue_inactive`). Shared `toHttpResponse(err)` maps `AppError → {code, meta?}` JSON; `ZodError` collapses to `400 validation_failed`. Routes: `POST /api/matches` (auth + Zod + service + map errors), `GET /api/venues` (public list). UI: `/matches/new` Server-Component shell + 3-step client wizard (calendar grid 21-day horizon, time input with `now+30min` floor on today, duration chips, venue search + list; total stepper 8–30, crew chip input lime-pill style, surface chips from venue, studs Switch hidden on hard, field-booked Checkbox, price + Free toggle; description textarea ≤2000, mockup-parity preview card, Publish button). Backend-error codes routed back to the matching step via toast. 77 Vitest tests passing (14 new for `CreateMatchService`). End-to-end smoke against the live Neon DB confirmed: `/api/venues` returns the 3 seeded active venues; wizard rendered via ephemeral `/design/wizard-preview` (deleted before commit) verifies all 3 steps + the preview card. Real authenticated publish flow waits on the user opening the wizard with their own Google OAuth session — middleware correctly bounces guests to `/login?callbackUrl=/matches/new`. Post-publish redirect goes to `/games?created=:id` until Layer 5 builds `/matches/:id`. |
| **4** | **Join + approve flow** | ▢ Not started | `POST /api/matches/:id/join`, `POST /api/matches/:id/approve`, `POST /api/matches/:id/reject`. Includes `JoinRequest` aggregate + advisory locks (`withMatchLock`) + per-endpoint error codes. |
| **5** | **Match detail + roster + chat** | ▢ Not started | `/matches/:id` page wired to real data. Polling endpoint `GET /api/matches/:id/state`. Chat (`Message` aggregate). |
| **6** | **My-matches + profile** | ▢ Not started | `/my-matches` (Upcoming/Captain/Past) and `/me`. |
| **7** | **Notifications (in-app + email + push)** | ▢ Not started | `Notification` aggregate + polling endpoint `GET /api/updates/state` + Updates panel UI + email via Resend/Postmark + browser Notification API. |
| **8** | **Map + venue picker** | ▢ Not started | `/map` MapLibre + venue search backend. |
| **9** | **Admin** | ▢ Not started | `/admin/users`, `/admin/venues`, `/admin/reports` + `requireAdmin()`. |
| **10** | **Production deploy** | ▢ Not started | Caddy + Docker Compose + VPS + GitHub Actions + Cloudflare proxy. Domain `pitchup.online`. |

---

## Cross-cutting backlog (handle inline when a layer touches them)

Things that don't deserve a layer of their own but must be solved as they come up. Tick when done.

- [x] `.env.example` — replace stale `PlusOneFC` comment with PITCHUP wording (done during Layer 0 scaffold, 2026-05-24).
- [ ] `mockups/login.html` shape — already updated, but if any new wordmark variant ships, sync the comment block.
- [ ] Email sender provider decision (Resend vs Postmark) — needed at Layer 7.
- [ ] First venue covers — when match cards land in Layer 2, decide if we ship without covers or generate ~10 placeholders.
- [ ] `docs/spec/ru/*` — frozen archive. Carries stale `plusonefc.app` and `plusonefc:teams:` strings. **Don't touch.** If RU gets revived, do a full re-translation pass, not patches.
- [ ] Repo folder rename `/PlusOneFC/` → `/pitchup/` — user-managed (requires IDE restart). Do whenever convenient.

---

## How to start a fresh chat on this repo

Paste this into the new chat as the first message:

> Read `docs/ROADMAP.md`, then `AGENTS.md`, then `CODING_STANDARDS.md`. We're picking up at the next `▢ Not started` layer in the roadmap. Confirm what you understand the scope to be before writing any code.

That gives Claude (or any agent) enough orientation in 3 files. If the work touches a specific spec area, it'll pull the relevant `pitchup-spec-*.md` on its own.
