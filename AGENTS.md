# AGENTS.md — Guide for AI assistants

> Quick-reference for AI agents working on this codebase. Read after [CODING_STANDARDS.md](./CODING_STANDARDS.md) §0–§3 and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). Updated whenever a convention shifts — keep this fresh.

---

## Project layout (1-screen version)

```
plusonefc/
├── app/                    # Next.js routes + Route Handlers (interfaces layer)
├── src/
│   ├── auth/               # bounded context: Google OAuth + onboarding
│   ├── match_lifecycle/    # bounded context: Match CRUD + state machine + concurrency
│   ├── notifications/      # bounded context: in-app inbox + browser + email
│   ├── moderation/         # bounded context: reports + admin actions
│   ├── ui/                 # UI kit components + design tokens
│   └── shared/             # cross-cutting: db, errors, config, logger
├── prisma/                 # schema + migrations
├── docs/spec/              # functional spec (source of truth for behavior)
├── docs/adr/               # architecture decision records
├── docs/ARCHITECTURE.md    # source of truth for code patterns
├── mockups/                # HTML design anchors — canonical: match.html (light palette)
└── CODING_STANDARDS.md     # universal principles
```

Inside each `src/<context>/` folder:
- `domain/` — pure, no I/O. Entities, value objects, repository ports, domain errors.
- `application/` — use cases. Orchestrates ports. Returns DTOs.
- `infrastructure/` — adapters (Prisma repositories, email senders, etc.).
- `composition.ts` — wires concrete adapters into services for `app/` to import.
- `about.md` — one-paragraph manifest (what this context does, core entities).

Full layout: [docs/ARCHITECTURE.md §2](./docs/ARCHITECTURE.md).

---

## Conventions cheat sheet

| Topic | Rule | Reference |
|---|---|---|
| **Language** | Code English. Chat Russian. No mixing inside one artifact. | CODING_STANDARDS §0 |
| **File header** | Every non-trivial file starts with `MODULE/PURPOSE/LAYER/DEPS/CONSUMED BY/INVARIANTS/RELATED DOCS` JSDoc block. | CODING_STANDARDS §4 |
| **Mutations** | Route Handlers (`app/api/.../route.ts`). Server Actions only for `/welcome` and `/me edit`. | ARCHITECTURE §5 |
| **Errors** | `throw` exceptions from `AppError` hierarchy. Map to HTTP via `src/shared/errors/http-mapping.ts`. | ARCHITECTURE §6 |
| **Validation** | Zod everywhere: API payloads, DTOs, env, forms. | ARCHITECTURE §7 |
| **Persistence** | Repository port in `domain/` + Prisma impl in `infrastructure/`. Never import Prisma from `application/`. | ARCHITECTURE §8 |
| **Concurrency** | `withMatchLock(matchId, async (tx) => {...})` for every match-mutating use case. | ARCHITECTURE §8 + spec match.md "Concurrency & locking" |
| **Auth** | Call `requireAuth(req)` first in every protected handler. Admin endpoints call `requireAdmin()`. | ARCHITECTURE §9 |
| **Components** | Server Components by default. `'use client'` only when interactivity required. | ARCHITECTURE §11 |
| **Theme** | **Light-only** on v1 launch (cream surfaces, dark-green primary, lime CTA — canonical tokens in `mockups/match.html`, mirrored in `src/ui/tokens.ts`). `next-themes` is planned with `forcedTheme="light"` so a future dark mode is a single-line switch — not yet wired in `app/layout.tsx`. | docs/ARCHITECTURE.md (Stack table) + spec personal.md Known Gaps ("Dark theme") |
| **Container** | `max-width: 375px`, centered, mobile safe-area. Not 480, not responsive. | ARCHITECTURE §11 |
| **Design tokens** | Never inline hex outside `src/ui/tokens.ts` and `tailwind.config.ts`. New token = add there first. | ARCHITECTURE §11 |
| **Commits** | Conventional Commits with bounded-context scope: `feat(match_lifecycle): add join flow`. One logical change per commit. | CODING_STANDARDS §11 |

---

## Common gotchas

- **Glossary §9 disputed pairs matter in code.** DB: `rejected`. UI label: `Decline` / `Declined`. Variable names in `application/` should match the DB term (`status: 'rejected'`); UI strings use the UI term. See [docs/spec/_translation-glossary.md](./docs/spec/_translation-glossary.md) §9.
- **`my_status` is NOT `JoinRequest.status`.** `my_status` is a UI-derived enum that lives only in poll payloads. Mapping table is in [global.md → "Polling sync"](./docs/spec/pitchup-spec-global.md).
- **Match status is computed on-read.** No `status` column on `Match`. Derived from `start_time`, `duration`, `cancelled_at`. Single helper, never duplicate the logic.
- **Slot math has a single canonical formula.** `computeSlots(match)`. Never recompute locally — see [global.md → "Slot math"](./docs/spec/pitchup-spec-global.md).
- **Captain cannot Join or Watch their own match.** Both endpoints explicitly check `user !== match.captain_id` (400 codes). UI doesn't show the buttons, but backend backstop is mandatory.
- **`Match.cover_id` is a snapshot at INSERT.** Changing `venue.cover_id` later does not propagate.
- **Author resolution at render-time, not write-time.** Chat messages from banned/deleted users render as `[Removed user]` retroactively without migration.
- **Material vs non-material edits.** Editing `start_time`/`duration`/`venue`/`surface`/`studs_allowed`/`price`/`field_booked` notifies accepted players. Editing `total_spots`/`captain_crew`/`description` is silent — **EXCEPT** `total_spots ↑` may trigger `notify watching` (separate channel).
- **Two poll endpoints, both at 15s foreground / 60s background.** Don't write a third.
- **Spec wins over app-map.** If [docs/spec/pitchup-app-map.md](./docs/spec/pitchup-app-map.md) and a `docs/spec/*.md` file disagree, the spec file is right and the map needs a fix.
- **Russian archive (`docs/spec/ru/`) is frozen.** Do not read it without explicit human instruction. See [docs/spec/CLAUDE.md](./docs/spec/CLAUDE.md).
- **Don't set `font-size` on `html` / `body`.** Tailwind's rem-based sizing (`h-12` → 48px, `h-11` → 44px) assumes the browser default 16px root. Setting `html { font-size: 15px }` silently shrinks every rem-based class (Layer 0 ran into this: 48px buttons became 45px). Body text size is applied via Tailwind utility (`text-[15px]`) on the `<body>` element in `app/layout.tsx` instead.
- **Component catalog is `/design`, not `/_design`.** Next.js App Router treats `_`-prefixed folders as private and excludes them from routing. The spec / older AGENTS notes may still say `/_design` — the live URL is `/design`. See [docs/ARCHITECTURE.md §11](./docs/ARCHITECTURE.md).
- **`pnpm` may not be on PATH.** On the current dev machine corepack is absent and no global `pnpm` is installed. Run commands as `npx pnpm@9.15.4 <args>` (slower per-call but no setup), or have the human enable corepack once. Don't fall back to `npm install` — it would rewrite the lockfile.
- **Prisma is pinned to 6.x, not 7.x.** Prisma 7 removed `url = env(...)` from `schema.prisma` and requires `prisma.config.ts` + a driver adapter. Our scaffolding (ARCHITECTURE.md §8, repo `src/shared/db/prisma.ts`) assumes classic Prisma. If you ever bump to 7 — open ADR-0004 first; do not silently upgrade.
- **`prisma` CLI does not auto-load `.env.local`.** Next.js reads it; the Prisma CLI only reads `.env`. To run `prisma migrate deploy` / `migrate status` / `generate` against the dev DB, export `DATABASE_URL` explicitly first: `export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) && pnpm exec prisma migrate deploy`. The value contains `&` (Neon query string) — extract it as a `$(...)` value, don't `source` the file naively (bash chokes on the unquoted `&`).
- **Use `prisma migrate deploy`, never `migrate dev`, against the shared Neon DB.** `migrate dev` requires a shadow database and may prompt destructive resets. `deploy` only applies pending migrations idempotently. `migrate reset` drops the entire `public` schema — never run it without explicit user confirmation, the DB is shared.
- **Don't recompute slot math or match status in handlers / components.** There is one canonical source for each: `computeSlots(match, acceptedSlots)` in [`src/match_lifecycle/domain/slot-math.ts`](./src/match_lifecycle/domain/slot-math.ts) and `deriveMatchStatus(match, slots, now)` in [`src/match_lifecycle/domain/match-status.ts`](./src/match_lifecycle/domain/match-status.ts). The application layer calls them once and passes the result downstream. If you find yourself writing `match.totalSpots - …` or `now > match.startTime` anywhere else, stop — call the helper.
- **Seed data lives inside a migration file** (`prisma/migrations/*_seed_demo_data/migration.sql`), not in a `prisma/seed.ts` script. Seed rows use relative times (`NOW() + INTERVAL '…'`) so the dataset stays evergreen no matter when the migration is applied. Seed captains use a deliberately fake `google_sub` (`seed:captain-N`) and `.invalid` email so they cannot collide with a real OAuth user.
- **Funnel every "by day" / horizon filter through `src/shared/time/prague.ts`.** `pragueDay(date)` / `pragueRange(d1, d2)` / `todayPrague(now)` are the canonical primitives (see [spec global.md → Timezones & date ranges](./docs/spec/pitchup-spec-global.md)). Naive `BETWEEN start_of_day_utc AND start_of_day_utc + INTERVAL '24h'` silently drops or duplicates an hour on the two DST Sundays — that's the bug these helpers prevent. Layer 2.5 spec-tested against 2026-03-29 (23h) and 2026-10-25 (25h).
- **Discover URL params are whitelist-parsed and never throw.** `parseDiscoverFilters` (in `src/match_lifecycle/application/discover-filters.ts`) silently falls back to `today_prague(now)` for malformed/past/>+20 `?date=`, drops unknown enum values for `?distance/time/size/spots`, returns `null` cursor on decode failure. **Don't add `400` responses for bad query strings** — the spec explicitly requires graceful fallback ("Invalid query params fallback"). Same parser is shared by `/games` (Server Component) and `GET /api/matches/discover` (Route Handler).
- **`?distance=` has client-only truth.** The saved location lives in `localStorage` (`pitchup.location`, see `app/(public)/games/use-saved-location.ts`). SSR can't see it — the service silently drops the distance filter on first paint, and the `DistanceBanner` client island plus a one-shot client refetch take over after hydration if a location is present. Don't try to read the location server-side, and don't 4xx on `?distance=` without it.
- **Filter-changing URL writes use `router.replace`, not `push`.** Day-picker selection and filter-sheet Apply should not pollute browser history — back-button should leave `/games`, not walk through filter combinations. Search + Show more don't touch the URL at all (search is ephemeral per spec; pagination is a fetch).
- **Discover pagination is keyset on `(start_time ASC, id ASC)` with a `LIMIT n+1` trick.** The Prisma adapter (`prisma-match-repository.ts`) takes one extra row to detect `nextCursor` without a second query. Cursor format is `base64url(JSON{s,i})` — opaque to clients, kept tight via `encodeCursor`/`decodeCursor` in `discover-filters.ts`. **Don't recompute cursor format elsewhere** — round-trip through these helpers.
- **Discover SQL uses `$queryRaw`, not Prisma's `where` builder.** Three of the filters can't be expressed via Prisma's typed API: Prague-TZ hour extract (`EXTRACT(HOUR FROM start_time AT TIME ZONE 'Europe/Prague')`), Haversine distance, and tuple cursor comparison `(start_time, id) > ($1, $2)`. The handwritten query is in `prisma-match-repository.ts`; ILIKE search escapes `%` and `_` to neutralise wildcard injection. Keep the formula for `free_slots` (`total_spots - 1 - COALESCE(array_length(captain_crew, 1), 0)`) **in sync with `computeSlots()`** when Layer 4 adds the accepted-requests JOIN.
- **Create-match has no advisory lock (and that is correct).** `POST /api/matches` is the *only* match-mutating endpoint that does **not** wrap its work in `withMatchLock` — the match id doesn't exist until the row is inserted, so there's nothing to lock on. The "Per-endpoint checklist" in match.md spells this out as an explicit exception; do not add a lock here when copying the Join/Approve/Kick patterns later. The other no-lock exception is `POST /api/matches/:id/messages` (chat — no slot/status mutation).
- **`Match.coverId` is taken from the venue at INSERT, never afterwards.** `CreateMatchService` reads `venue.coverId` and passes it into `matchRepository.create({...})` as a frozen snapshot. The Prisma schema's `Match.coverId` column has no FK to venues — it's a denormalised slug. Changing the venue's cover later does not propagate (spec / global.md "Cover venue"). Don't try to "fix" this with a JOIN.
- **Wizard error toasts dispatch on the backend `code`, not status.** `app/(private)/matches/new/wizard.tsx#handleBackendError` switches on `body.code` returned by `toHttpResponse`. When you add a new validation error to `match_lifecycle/domain/errors.ts`, also add a `case` here — otherwise the user falls through to "Couldn't publish. Try again." which buries the real reason.
- **Discover bottom-sheet is hand-rolled (no Radix Dialog yet).** Backdrop click + Esc close + body-scroll lock are implemented inline in `more-filters-sheet.tsx`; focus-trap intentionally deferred. Layer 5 captain-sheet will be the second use case — extract a shared `Sheet` primitive then (and consider adding `@radix-ui/react-dialog` at that point; same family as the existing Radix Checkbox/Switch).
- **`MatchRepository.findById(id, tx?)` is the only read method, no `findByIdForUpdate`.** Pass the `tx` from `withMatchLock` to read under the advisory lock; omit it for unlocked reads. `SELECT ... FOR UPDATE` would be theatre on top of `pg_advisory_xact_lock` (spec / ARCHITECTURE.md §8 explicitly forbid it). When growing the port in later layers, follow the same one-method-with-optional-tx shape.
- **JoinRequest UPSERT is a SELECT-then-(INSERT|UPDATE) sequence, safe under the advisory lock.** `PrismaJoinRequestRepository.upsertToPending` returns a discriminated `{outcome: 'inserted' | 'revived' | 'conflict'}` instead of throwing on a status conflict — the service maps `conflict.existingStatus` (`pending` → `AlreadyRequestedError`, `accepted` → `AlreadyInMatchError`). Don't reach for a Postgres `ON CONFLICT` here: the discriminated-outcome shape carries the existing status, which the upsert needs to choose the matching domain error; raw upserts can't surface that.
- **Notification aggregate is deliberately absent in Layer 4.** Approve / reject services have `// TODO(Layer 7): notification(...)` markers at the insertion points (inside the locked tx, before commit — spec match.md "Write ordering"). When Layer 7 lands, inject a `NotificationRepository` port via the constructor and add one line per marker. **Do not write a stub port now** — we'd have to throw it away once the real `Notification` shape (type enum, body templates) is known.
- **Unit tests mock `withMatchLock` via `vi.mock`** to bypass the real Prisma transaction. Fake repositories ignore the sentinel `tx` argument. Race scenarios are simulated by calling the service twice sequentially against a shared fake (the second call sees the state the first one wrote). Real concurrency belongs to integration tests against Postgres, which Layer 4 does not yet ship.
- **Route Handlers under `app/api/matches/[id]/...` use Next 15 async `params`.** Signature: `{ params }: { params: Promise<{ id: string }> }`, then `const { id } = await params;`. Older Next 14 sync-params will type-check but warn at runtime — always `await` it.
- **Chat writes are the second no-lock exception (alongside `POST /matches`).** `POST /api/matches/:id/messages` and `DELETE /api/matches/:id/messages/:msgId` do NOT wrap in `withMatchLock` — chat doesn't mutate slot/status/roster, spec match.md §546 says timestamp ordering is sufficient. Adding a lock here would be theatre. The cross-match guard on delete (verifying `message.matchId === url:id`) is the only safety check needed.
- **Layer 4 ports now accept optional `tx` on reads.** `JoinRequestRepository.findByMatchAndUser` / `findById` / `listAcceptedForMatch` + new `listPendingForMatch`, and `WatchRepository.countForMatch` / `existsForUserAndMatch`, are all callable with NO `tx` — they fall back to the singleton prisma in the adapter constructor. The `tx`-passed call sites in Layer 4 still operate under the advisory lock; the no-`tx` call sites in Layer 5 (chat role gating, `MatchStateService`, viewer-role derivation, RSC page load) read against the unlocked client. Same shape as `MatchRepository.findById(id, tx?)`. When extending other ports in later layers, mirror this convention — never duplicate methods for "locked" and "unlocked" variants.
- **`MatchStateService` is a cross-context read-model assembler.** Lives in `match_lifecycle/application` but imports from three contexts (`chat/domain/chat-message-repository`, `auth/domain/user-repository`, `match_lifecycle/domain/*`). Application-layer composition across contexts is allowed — only `domain/` is forbidden from cross-context imports. The service does NOT enforce the polling-membership 403 (`chat_forbidden` for pending / watching / guest); that gate lives in the `GET /api/matches/[id]/state` route handler so the RSC page can call the same service for everyone. Layer 6+ services that need to assemble a similar cross-context view should follow this pattern — service is pure read, gate lives at the interfaces edge.
- **Polling endpoint never throws on bad `?since=`.** `GET /api/matches/[id]/state?since=foo` parses leniently — invalid ISO → `null` → full history. Same convention as Discover's whitelist URL parsing ("never 4xx on bad query strings"). Adding a 400 would force the client into a panic state on garbage URLs that should just degrade gracefully.
- **`computeCta(matchStatus, viewerRole, isFull)` is the SINGLE source of truth for the CTA bar.** Pure function in `match_lifecycle/domain/compute-cta.ts`, table-driven test in `tests/match_lifecycle/domain/compute-cta.test.ts` covers every cell of the spec §77-103 cascade. UI never inlines CTA logic; if a new role or status branch needs to render differently, change the function and add the row to the test — both update atomically. Out-of-scope Layer 6 actions are flagged `comingSoon: true` and render disabled with a "Coming soon" tooltip — when Layer 6 lands, just flip the flags and wire the click handlers; the cascade itself doesn't need to change.
- **Polling cadence is gated on viewer role at the hook level, not the endpoint.** `MatchShell` passes `enabled: isLiveStatus && (role === captain || accepted)` to `usePolling`. Pending / watching / guest see the initial static snapshot from the RSC and never poll (spec §215-216). Don't add a "kind, sort of polling" mode for watchers — they get the in-app inbox `spot_opened` signal in Layer 7 instead, exactly as the spec prescribes.
- **`optionalAuth()` returns `null` for not-yet-onboarded users.** Same DB-checked invalidation as `requireAuth` (banned / deletedAt / missing User row → null), but does not throw. Use it in Server Components that must serve guests AND signed-in users without redirecting (currently `/matches/:id`; Layer 6 `/me` will need the throwing variant since `/me` requires onboarding). Never trust the JWT alone; the row check is mandatory.
- **`Match.cancelReasonHidden` is honoured at the RSC layer, not in the domain.** The DTO surfaced to the page passes `match.cancelReason` straight through; the page itself flips it to `null` when `cancelReasonHidden === true`. Same pattern as `description` / `descriptionHidden`. Don't filter inside the application service — moderation is a presentation concern.
- **Realtime chat (Ably) is Layer 5.5, with `// TODO(Layer 5.5)` markers at the publish points.** `PostChatMessageService` and `DeleteChatMessageService` have a marker comment after persistence where the Ably fan-out belongs. Polling is the source of truth (spec match.md §229) — Ably is an enhancement that delivers <1s latency on top, not a replacement. Layer 5.5 will be a pure transport addition: no schema change, no service-behaviour change, no test rewrites. Dedup-by-id is already in `mergePollPayload` so the same message arriving once via Ably and once via the next poll is rendered once.

---

## Where to find things by concept

(See [NAVIGATION.md](./NAVIGATION.md) for the full index. Below are the most-asked.)

- **A specific endpoint contract** → [docs/spec/pitchup-spec-match.md](./docs/spec/pitchup-spec-match.md) → "Per-endpoint checklist" + "Race scenarios".
- **An ERD field or table** → [docs/spec/pitchup-app-map.md](./docs/spec/pitchup-app-map.md) → "Main entities".
- **A UI string with disputed wording** → [docs/spec/_translation-glossary.md](./docs/spec/_translation-glossary.md) §9.
- **An open architectural question** → [docs/ARCHITECTURE.md §16](./docs/ARCHITECTURE.md).
- **Why we picked X over Y** → `docs/adr/` (numbered records).

---

## Before you change anything significant

1. **Identify the source of truth.** Spec for behavior, ARCHITECTURE for code patterns, CODING_STANDARDS for universal principles, mockups for visuals.
2. **Search for prior art.** Grep for related anchors (`ANCHOR:`), check `composition.ts` files, look at `about.md` of nearby bounded contexts.
3. **Update the spec first if behavior changes.** Then `app-map.md` if ERD/status table affected (the spec-file edit hook reminds you).
4. **Write an ADR for non-trivial decisions** (`docs/adr/NNNN-short-slug.md`). Context / Decision / Consequences.
5. **One bounded context per PR/commit when possible.** If the change spans contexts, the commit message names all of them: `refactor(match_lifecycle,notifications): ...`.

---

## Adding a new feature (workflow)

1. **Confirm the spec covers it.** If not — stop, escalate in Russian to the human.
2. **Identify or create the bounded context.** New context = new `src/<name>/` folder + `about.md` + composition root.
3. **Domain first.** Entities, value objects, ports, domain errors.
4. **Use case next.** Service in `application/`, accepting ports via constructor. Tests with fakes.
5. **Adapter.** Prisma repository in `infrastructure/`. Integration test against real Postgres.
6. **Wire it.** Update `composition.ts`.
7. **Route handler.** Thin parse-validate-call-map in `app/api/.../route.ts`.
8. **UI.** Server Component page + client island where needed. Use existing UI kit components from `src/ui/`; new visuals → add to `src/ui/` first, exercise in `app/design/page.tsx`, then use in the screen.
9. **Update AGENTS.md** if the workflow taught you a new gotcha.

---

## Cost-aware delegation reminder

This project uses cost-aware model routing (CODING_STANDARDS §13). The primary agent (you, reading this) is the architect. Delegate mechanical work — file lookups, pattern searches, code extraction, single-file summaries — to a cheap sub-agent with an exact output format. Don't waste primary-agent tokens grepping.

Architectural judgement, refactors crossing layers, race-condition debugging, and ADR authorship stay on the primary agent.
