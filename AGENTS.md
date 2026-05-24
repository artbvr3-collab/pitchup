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
| **Theme** | Dark-only on v1 launch. `next-themes` pinned with `forcedTheme="dark"`. Light deferred to v1.1. | ARCHITECTURE §1 + spec personal.md Known Gaps |
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
