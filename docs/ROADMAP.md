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
| **2** | **Read-only Discover** | ▢ Not started | `/games` list of matches from Prisma. Seed data via migration. `MatchRepository` port + `PrismaMatchRepository` adapter. No mutations yet. Validates repository pattern + Server Component data fetching. Maps `app/(public)/games/page.tsx`, `src/match_lifecycle/`. |
| **3** | **Create match** | ▢ Not started | `/matches/new` wizard (3 steps from mockup) → `POST /api/matches`. First real mutation: exercises Route Handler skeleton + AppError mapping + service + repository write. ADRs 0001/0002/0003 all touched. |
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
