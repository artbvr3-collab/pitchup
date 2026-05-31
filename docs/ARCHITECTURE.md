# PITCHUP — Architecture

> **What this is.** The bridge between [CODING_STANDARDS.md](../CODING_STANDARDS.md) (universal principles) and the functional spec in [docs/spec/](./spec/pitchup-spec-INDEX.md) (what the system does). This file answers: *given those principles and that spec, what concrete patterns and file layouts do we use in this codebase?*
>
> **Audience.** AI agents (Claude, DeepSeek via Cursor) starting work on this project. Read this **after** [CODING_STANDARDS.md](../CODING_STANDARDS.md) §0–§3 and **before** writing any code.
>
> **Status.** Initial draft, 2026-05-24. Open questions at the bottom. Major decisions land here; subsequent significant changes go to `docs/adr/` (see §15).

---

## 1. Stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS | App Router requires Node 18+; we pin 22. |
| Framework | Next.js 15 (App Router) | Server Components default. |
| Language | TypeScript 5.x, `strict: true` | No `any` without a comment justifying it. |
| Styling | Tailwind CSS + shadcn/ui | Tokens extracted from `mockups/*.html`. |
| Theme | `next-themes` | **Light-only on v1 launch** (decision 2026-05-24 — was previously dark; flipped after the cream/green/lime palette was anchored in `mockups/match.html`). `next-themes` wired with `forcedTheme="light"` so future dark mode is a single-line switch. Palette: cream surfaces (`#F5F0E8` / `#EDE8DC`), dark-green primary `#0E5C2F`, lime CTA `#C5E63C`. Canonical token list in the header comment of [`mockups/match.html`](../mockups/match.html); see §11. |
| ORM | Prisma 6.x | Postgres-only; no other DBs ever. **Pinned to 6.x** — Prisma 7 dropped `url` from `schema.prisma` and demands `prisma.config.ts` + driver adapter; treat any 7.x bump as a separate ADR. |
| DB | Postgres (Neon or Supabase managed) | Single DB, no read replicas in v1. |
| Auth | Auth.js v5 (Google OAuth only) | JWT lifetime 333 days (see [global.md](./spec/pitchup-spec-global.md) "Authentication"). |
| Validation | Zod | Single source of DTO shapes and env validation. |
| Tests | Vitest | Playwright deferred to v1.1. |
| Package manager | pnpm | Lockfile committed. |
| Map | MapLibre GL JS + OpenStreetMap tiles | Not Google Maps. |

New dependencies require human approval (CODING_STANDARDS §14.4). The list above does not.

---

## 2. Folder layout

We combine **flat bounded contexts** (CODING_STANDARDS §2.1) with **hexagonal layering** (§3). The synthesis: each bounded context is a folder; inside it, layers are subfolders.

```
plusonefc/
├── app/                          # Next.js App Router — interfaces layer (HTTP/UI)
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── welcome/page.tsx
│   ├── (public)/
│   │   ├── games/page.tsx
│   │   ├── map/page.tsx
│   │   └── matches/[id]/page.tsx
│   ├── (private)/
│   │   ├── my-matches/page.tsx
│   │   ├── chats/page.tsx
│   │   └── me/page.tsx
│   ├── api/
│   │   ├── matches/[id]/join/route.ts        # thin → calls JoinMatchService
│   │   ├── matches/[id]/approve/route.ts
│   │   ├── updates/state/route.ts            # global poll
│   │   └── matches/[id]/state/route.ts       # per-match poll
│   ├── layout.tsx
│   └── globals.css
│
├── src/
│   ├── auth/                     # bounded context: Auth & onboarding
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── about.md
│   ├── match_lifecycle/          # bounded context: Match CRUD + state machine
│   │   ├── domain/               # Match, MatchStatus, computeSlots(), invariants
│   │   ├── application/          # JoinMatchService, ApproveRequestService, ...
│   │   ├── infrastructure/       # PrismaMatchRepository, withMatchLock()
│   │   └── about.md
│   ├── notifications/            # bounded context: inbox + browser + email
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── about.md
│   ├── moderation/               # bounded context: reports + admin actions
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── about.md
│   ├── ui/                       # UI kit — bounded context for shared components
│   │   ├── components/           # TopBar, BottomNav, MatchCard, Button, ...
│   │   ├── tokens.ts             # Tailwind theme tokens
│   │   └── about.md
│   └── shared/                   # cross-cutting (errors, logging, config, db helpers)
│       ├── db/                   # prisma client + withMatchLock()
│       ├── errors/               # AppError hierarchy + http mapping
│       ├── config/               # env validation via Zod
│       └── logger/
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── docs/
│   ├── ARCHITECTURE.md           # this file
│   ├── adr/                      # numbered architecture decision records
│   └── spec/                     # functional spec (source of truth for behavior)
│
├── mockups/                      # HTML design anchors — canonical: match.html (light palette, token list in header)
├── tests/                        # mirrors src/ structure
├── CODING_STANDARDS.md
├── README.md
├── AGENTS.md                     # AI-facing onboarding
├── NAVIGATION.md                 # "find by concept" index
└── .env.example
```

### Bounded context naming

The flat namespace under `src/` lists every bounded context. **Names from spec, not from data model.** E.g. `match_lifecycle` (not `matches`), `auth` (not `users`). If you can't write a one-sentence `about.md` for a folder, it's not a bounded context — fold it into an existing one or into `shared/`.

### Where `app/` fits

`app/` **is** the interfaces layer for HTTP. Bounded contexts under `src/` do **not** have their own `interfaces/` subfolder — route handlers and pages live in `app/`, import services from `src/<context>/application/`, and never reach into `infrastructure/` directly.

```
app/api/matches/[id]/join/route.ts
  └─ imports → src/match_lifecycle/application/join-match-service.ts
                  └─ imports → src/match_lifecycle/domain/match-repository.ts (port)
                                  └─ injected: src/match_lifecycle/infrastructure/prisma-match-repository.ts (adapter)
```

---

## 3. Layer responsibilities

### `domain/`
Pure business logic. No I/O, no Prisma, no Next.js imports. Allowed: stdlib, Zod (for value-object schemas), pure utility libs.

Contents:
- **Entities** as classes or readonly objects: `Match`, `JoinRequest`.
- **Value objects**: `MatchStatus`, `MatchId` (branded string), `SlotMath`.
- **Domain functions**: `computeSlots(match)`, `canApprove(match, request)`.
- **Repository ports**: `MatchRepository` interface — implementations live in `infrastructure/`.
- **Domain errors**: `MatchLockedError`, `OverCapacityError` extending `DomainError`.

### `application/`
Use cases / services. Orchestrates domain + repository ports. Returns typed DTOs (Zod-inferred). One service per significant use case.

Naming: `<verb-noun>-service.ts` exporting one class or one factory function.

Examples: `join-match-service.ts`, `approve-request-service.ts`, `cancel-match-service.ts`, `compute-my-status-service.ts`.

Receives ports through constructor injection (not global imports). Tests substitute fakes.

### `infrastructure/`
Adapters for external systems: Prisma, email sender (Resend / Postmark TBD), browser push API. Each adapter implements a port from `domain/`.

Examples: `prisma-match-repository.ts`, `resend-email-sender.ts`.

### `app/` (interfaces layer)
- **`app/api/*/route.ts`** — thin HTTP handlers. Parse → validate (Zod) → call service → map result/error to HTTP. No business logic.
- **`app/**/page.tsx`** — Server Components fetching via services. No direct Prisma imports.
- **Client Components** (`'use client'`) — only when interactivity is required (forms with local state, polling hooks, optimistic UI).

### `shared/`
Cross-cutting: `db/prisma.ts` (singleton), `db/with-match-lock.ts` (advisory lock helper), `errors/app-error.ts` (base classes), `errors/http-mapping.ts` (`AppError → HTTP response`), `config/env.ts` (Zod-validated env), `logger/logger.ts` (structured JSON).

### Dependency direction (strict)

```
app/  →  src/<context>/application/  →  src/<context>/domain/
                                            ↑
            src/<context>/infrastructure/ ───┘  (implements ports)

app/        ←  shared/      (any layer can use shared)
application ←  shared/
domain      ←  shared/errors only (not db, not config — domain is pure)
```

**A file in `domain/` may NOT import from `infrastructure/`, `application/`, or `app/`.**
**A file in `application/` may NOT import from `app/` or from `infrastructure/` directly** (only via injected ports).
**A file in `app/` may import from `application/`** and from `ui/`. Never from `domain/` directly except for type-only imports of domain types.

---

## 4. File header convention (TypeScript)

Every non-trivial source file starts with a JSDoc block. Format mirrors CODING_STANDARDS §4 in TS idiom:

```ts
/**
 * MODULE: match_lifecycle.application.join-match-service
 * PURPOSE: Use case — player submits a join request to a match (with optional guests).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository, WatchRepository, NotificationSender
 * CONSUMED BY: app/api/matches/[id]/join/route.ts
 * INVARIANTS:
 *   - Captain cannot join their own match (400 captain_cannot_join).
 *   - Re-apply after reject/leave/kick is UPSERT-update to pending (not INSERT).
 *   - On success, any existing Watch record for (user, match) is deleted.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Reject / Kick / Leave flows", "Per-endpoint checklist"
 *   - docs/spec/pitchup-spec-global.md → "Slot math", "Total spots — hard cap on approve"
 */
```

For trivial files (single-export utilities, type files under 30 lines) — a one-line `// MODULE: ...` is enough.

---

## 5. Mutations: Route Handlers default

**Decision:** All mutations are REST Route Handlers under `app/api/`. Server Actions are an exception, used only for two narrow cases:

- `/welcome` onboarding form (simple form, no polling, no optimistic UI)
- `/me → Edit profile` (same reason)

**Why:** the spec already describes every mutation as a REST endpoint (`POST /api/matches/:id/join`, etc.). Route Handlers naturally pair with the polling endpoints (`GET /api/updates/state`, `GET /api/matches/:id/state`) and with optimistic-UI client components. Mixing Server Actions everywhere would force half the codebase into a parallel pattern.

### Route Handler skeleton

```ts
// app/api/matches/[id]/join/route.ts
/**
 * MODULE: app.api.matches.id.join.route
 * PURPOSE: HTTP entry for POST /api/matches/:id/join.
 * LAYER: interfaces
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST /join
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/src/auth/application/require-auth";
import { joinMatchService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

const BodySchema = z.object({
  guest_count: z.number().int().min(0).max(4),
  message: z.string().max(500).nullable(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAuth(req);  // throws UnauthorizedError on banned/deleted/missing
    const body = BodySchema.parse(await req.json());
    const result = await joinMatchService.execute({
      matchId: params.id,
      userId: session.userId,
      guestCount: body.guest_count,
      message: body.message,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
```

Notes:
- The handler is **thin**: parse, validate, delegate, map errors. No domain logic.
- `requireAuth()` lives in `src/auth/application/` and throws `UnauthorizedError` (mapped to 401 by `toHttpResponse`).
- Service is imported from a per-context **composition root** (`src/match_lifecycle/composition.ts`) that wires concrete adapters into the service constructor. One source of truth for "what gets injected where".

---

## 6. Errors

**Decision:** throw exceptions inheriting from a base `AppError`. One generic HTTP-mapping handler in `app/api/*/route.ts` catch blocks (or in a shared `toHttpResponse(err)`).

```
AppError                                    (src/shared/errors/app-error.ts)
├── DomainError                             (src/shared/errors/domain-error.ts)
│   ├── MatchLockedError                    (src/match_lifecycle/domain/errors.ts)
│   ├── OverCapacityError
│   ├── AlreadyRequestedError
│   ├── AlreadyAcceptedError
│   ├── NotInMatchError
│   └── CaptainCannotJoinError
├── ValidationError                         (Zod parse failures → wrapped)
├── UnauthorizedError                       (from requireAuth)
├── ForbiddenError                          (not banned but not allowed)
├── NotFoundError
└── InfrastructureError                     (DB down, third-party API failure)
```

### Error → HTTP mapping

All HTTP codes are specified in the per-endpoint checklist in [match.md](./spec/pitchup-spec-match.md). The mapping table lives in `src/shared/errors/http-mapping.ts`:

```ts
const ERROR_CODE_TABLE = {
  MatchLockedError:      { status: 409, code: "match_locked" },
  OverCapacityError:     { status: 409, code: "over_capacity" },
  AlreadyRequestedError: { status: 409, code: "already_requested" },
  CaptainCannotJoinError:{ status: 400, code: "captain_cannot_join" },
  UnauthorizedError:     { status: 401, code: "unauthorized" },
  ValidationError:       { status: 400, code: "validation_failed" },
  NotFoundError:         { status: 404, code: "not_found" },
  InfrastructureError:   { status: 500, code: "internal_error" },
} as const;
```

If you find an HTTP code in the spec that isn't in this table — **stop and add it explicitly**, don't generalize.

### Error context

Every error carries structured fields (CODING_STANDARDS §8). Example:

```ts
export class OverCapacityError extends DomainError {
  constructor(public readonly matchId: string, public readonly attemptedFilled: number, public readonly capacity: number) {
    super(`Over capacity: would fill ${attemptedFilled}/${capacity} on match ${matchId}`);
  }
}
```

Logged as JSON with all fields. Never logged with stack to user (HTTP response has only `code`, `message` is generic).

---

## 7. Validation: Zod

Zod is the single source of:
- **API payload schemas** in `app/api/*/route.ts` (parse request bodies).
- **DTO types** in `application/` (services accept already-parsed input DTOs).
- **Env variables** at startup (see §13).
- **Form validation** on client (use `@hookform/resolvers/zod` if forms get complex; not required for v1).

Pattern: define schema once, infer the type, export both.

```ts
// src/match_lifecycle/application/dto/join-match-input.ts
import { z } from "zod";

export const JoinMatchInputSchema = z.object({
  matchId: z.string().uuid(),
  userId: z.string().uuid(),
  guestCount: z.number().int().min(0).max(4),
  message: z.string().max(500).nullable(),
});

export type JoinMatchInput = z.infer<typeof JoinMatchInputSchema>;
```

Route handler parses raw HTTP body with a separate schema (snake_case keys from spec), then maps to the application DTO (camelCase). Keep the API contract and the application contract independent — different audiences.

---

## 8. Persistence

### Prisma client

Singleton, exported from `src/shared/db/prisma.ts`. Standard Next.js pattern (global var in dev to survive HMR).

### Repository pattern

Every aggregate (Match, JoinRequest, User, Watch, Notification, etc.) has a **repository port** in `domain/` and a **Prisma implementation** in `infrastructure/`.

```ts
// src/match_lifecycle/domain/match-repository.ts
export interface MatchRepository {
  findById(id: string): Promise<Match | null>;
  findByIdForUpdate(id: string, tx: TransactionClient): Promise<Match | null>;
  save(match: Match, tx: TransactionClient): Promise<void>;
}

// src/match_lifecycle/infrastructure/prisma-match-repository.ts
export class PrismaMatchRepository implements MatchRepository {
  async findById(id: string): Promise<Match | null> { /* ... */ }
  // ...
}
```

**Why the port pattern even though Prisma is "already an abstraction":**
1. `application/` services don't import Prisma directly → no leak of DB types into use cases.
2. Tests inject in-memory fakes for fast unit tests of orchestration logic.
3. If we ever swap DB or add a read-side projection — one place to change.

The cost is ~15% boilerplate. Accepted.

### Advisory locks

The spec mandates `pg_advisory_xact_lock` for all match-mutating endpoints (see [match.md](./spec/pitchup-spec-match.md) → "Concurrency & locking"). Helper:

```ts
// src/shared/db/with-match-lock.ts
import { prisma } from "./prisma";
import type { TransactionClient } from "./types";

export async function withMatchLock<T>(
  matchId: string,
  work: (tx: TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`match:${matchId}`}, 0))`;
    return work(tx);
  });
}
```

Every mutating use case that touches match state wraps its work in `withMatchLock(matchId, async (tx) => { ... })`. The `tx` is the locked transaction client; pass it down to repository methods that need to see/write under the lock.

Exceptions (no lock needed) per spec:
- `POST /matches/:id/messages` (chat — no slot/status mutation)
- `POST /matches` (creation — no id yet)
- `GET *` (reads)

### Migrations

Prisma migrations only — no hand-rolled SQL except inside `$queryRaw` for the advisory lock and similar Postgres-specific operations. Migration names follow `YYYYMMDDHHMM_short_slug` (Prisma default).

---

## 9. Auth

### Auth.js v5 setup

Single provider: Google OAuth. JWT session strategy with `maxAge = 333 days` (spec). Configuration in `src/auth/infrastructure/auth-config.ts`. Initialized once, exported from `src/auth/infrastructure/auth.ts`.

### `requireAuth()` helper

The canonical way to get the current session in any Route Handler / Server Component:

```ts
// src/auth/application/require-auth.ts
export async function requireAuth(req?: NextRequest): Promise<Session> {
  const session = await getServerSession();  // Auth.js v5
  if (!session) throw new UnauthorizedError("no_session");

  // Spec: "Session invalidation via users.banned / users.deleted_at" (global.md)
  const user = await userRepository.findById(session.userId);
  if (!user) throw new UnauthorizedError("user_not_found");
  if (user.banned) throw new UnauthorizedError("banned");
  if (user.deletedAt) throw new UnauthorizedError("deleted");

  return session;
}
```

**Every protected endpoint calls `requireAuth()` first.** No "trust the JWT" — the DB column check is the invalidation mechanism (spec, "Session invalidation").

Admin-only endpoints additionally call `requireAdmin()` which extends `requireAuth()` with an `is_admin` check.

### Onboarding guard

Middleware (`middleware.ts` at repo root) intercepts protected routes. If `session.userId` exists but the user has not completed onboarding (`User` row absent for this `google_sub`) → redirect to `/welcome`. See spec → "Onboarding guard".

---

## 10. Polling endpoints

Two poll endpoints per spec:

| Route | Where used | Frequency |
|---|---|---|
| `GET /api/updates/state?since={ISO}` | Every signed-in page (root layout `<PollingProvider>`) | 15s foreground / 60s background |
| `GET /api/matches/:id/state?since={ISO}` | `/matches/:id` page only | same |

Implementation pattern: client-side React hook `usePolling(endpoint, intervalMs)` in `src/ui/hooks/use-polling.ts` that:
- Tracks `document.visibilityState` (foreground vs background).
- Stores `since` cursor in component state.
- On `401` response → calls signOut and redirects per spec ("Auth on ban / account deletion").
- On `5xx` → exponential backoff (max 60s), shows toast after 3 failures.

Payload shapes are fully specified in [global.md](./spec/pitchup-spec-global.md) → "Polling sync" and [match.md](./spec/pitchup-spec-match.md) → "Polling for match state". Mirror them exactly in Zod schemas (under `src/notifications/application/dto/` and `src/match_lifecycle/application/dto/`).

---

## 11. UI

### Server vs Client Components

**Default: Server Component.** Add `'use client'` only when needed:
- Local state (`useState`, `useReducer`)
- Effects / polling (`useEffect`, `usePolling`)
- Browser-only APIs (`localStorage`, `Notification`)
- Interactive form controls beyond `<form action>`
- shadcn/ui components that internally rely on Radix UI (most of them — wrap once, mark client)

A page (`page.tsx`) starts as Server Component, fetches data via service calls, and passes data into client components where needed (typical "RSC shell + client islands" pattern).

### Design tokens

Tailwind theme tokens (`tailwind.config.ts`) and CSS variables (`globals.css`) are extracted from the **anchor mockup**: [`mockups/match.html`](../mockups/match.html). The full token list lives in the `<style>` comment header at the top of that file — treat it as the source of truth. New anchor mockups (auth area, Create Match wizard, etc.) must inherit this token set; nothing else is canonical.

Principles:
- **Container: max-width 375px** (iPhone-standard), centered, mobile safe-area padding via `viewport-fit=cover`.
- **Typography:** Inter from Google Fonts; sizes per match.html (`h1 22/700`, `h2 13/600/uppercase/0.06em`, body `15/400`, label `13/400`, caption `12/400`).
- **Spacing:** page horizontal `16px`, card padding `16px`, card gap `12px`, section gap `20px`. Tailwind defaults otherwise.
- **Never invent a color, radius, or spacing value.** If the anchor doesn't show it, escalate to human.

**Canonical token list (extracted from `mockups/match.html` header comment, 2026-05-24):**

```ts
// src/ui/tokens.ts  (excerpt — full list lives in tailwind.config.ts as CSS vars)
export const tokens = {
  // Surfaces
  bgBase:         "#F5F0E8",  // warm cream — page background
  bgSurface:      "#EDE8DC",  // slightly darker cream — surface, dividers, input bg
  bgCard:         "#FFFFFF",  // card background
  bgCardDim:      "#F9F7F4",  // dimmed card (skeleton, disabled area)

  // Primary accent (dark green)
  greenDark:      "#0E5C2F",  // buttons, icons, active states, focus ring
  greenMid:       "#176B38",  // hover state for greenDark

  // Secondary accent (lime CTA)
  lime:           "#C5E63C",  // CTA "Join", active badge, highlights
  limeDark:       "#A8C82E",  // hover state for lime
  limeText:       "#2D3A00",  // text on lime background

  // Text
  textPrimary:    "#1A1A1A",  // body text
  textSecondary:  "#6B7280",  // labels, captions
  textMuted:      "#9CA3AF",  // placeholder, disabled
  textInverted:   "#FFFFFF",  // text on dark backgrounds

  // Slot / status
  statusOpen:     "#0E5C2F",  // plenty of spots
  statusAlmost:   "#D97706",  // ≤2 spots left (amber-600)
  statusFull:     "#DC2626",  // match full (red-600)
  statusInProgress:"#6B7280",

  // Structure
  border:         "#E0DAD0",  // default border
  borderStrong:   "#C7C0B3",  // stronger border — chip outline, switch track, checkbox border (added 2026-05-24 from create-match.html)
  borderFocus:    "#0E5C2F",  // input focus ring
  destructive:    "#DC2626",
  destructiveBg:  "#FEE2E2",
};
```

**Radii** (named, not raw):
- `--radius-card 16px` — cards
- `--radius-btn 12px` — buttons
- `--radius-chip 24px` — pill chips
- `--radius-badge 6px` — small badges

**Shadows:**
- `--shadow-card 0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.05)`
- `--shadow-btn 0 2px 8px rgba(14,92,47,0.25)` — primary green button only

**Animations** (port to `globals.css` or Tailwind config):
- `.skeleton` — `animation: pulse 1.5s ease-in-out infinite`, background pulses between `--bg-card-dim` and `--bg-surface` (light-theme appropriate; **don't** use the old `zinc-800` value).
- `.sheet` — `transform` transition `0.3s cubic-bezier(0.32, 0.72, 0, 1)` (bottom-sheet).
- `.sheet-overlay` — `opacity` transition `0.25s ease`.

**Chip / day-cell state classes** (componentize, don't copy raw):
- `chip-active` / `chip-inactive` — multi-select filter chips
- `day-cell-active` / `day-cell-inactive` — day picker strip cells

If a future mockup or spec introduces a new token — **add it here first**, then use it. Don't inline raw hex anywhere outside `tokens.ts` and `tailwind.config.ts`.


### Component catalog (removed)

The Layer-0 live component catalog (`app/design/page.tsx`, served at `/design`) was a dev-only page rendering every UI kit primitive in the v1 light theme. It was removed once the app went live (2026-05-31) — every primitive is now exercised by a real feature screen, so the standalone catalog had no remaining consumers. New components go straight into `src/ui/components/` and are verified in the screen that uses them (or via live preview).

### shadcn/ui

Components from `shadcn/ui` are copied (not npm-installed) into `src/ui/components/` per shadcn convention. Edit freely. Each component file carries the standard file header.

---

## 12. Testing

**Stack:** Vitest. Playwright deferred to v1.1 (manual smoke testing for now via live preview).

**Scope:**

| Layer | Coverage target | Strategy |
|---|---|---|
| `domain/` | 90%+ | Pure unit tests — fast, no I/O. |
| `application/` | 80%+ | Inject fake repositories. Cover happy path + every error branch in the per-endpoint checklist. **Race scenarios from match.md → "Race scenarios matrix" each get a test.** |
| `infrastructure/` | smoke | Repository tests against a real Postgres via Docker (slow, run on demand and in CI). |
| `app/` route handlers | smoke | One test per route covering happy + one error. Most logic is in services. |
| UI components | none in v1 | Visual checks via live preview. |

Test files mirror `src/` structure under `tests/` (CODING_STANDARDS §2.8).

---

## 13. Configuration

All env vars validated at startup via Zod. One file:

```ts
// src/shared/config/env.ts
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_GOOGLE_ID: z.string(),
  AUTH_GOOGLE_SECRET: z.string(),
  ALLOWED_ORIGINS: z.string().transform((s) => s.split(",")),
  // ...
});

export const env = EnvSchema.parse(process.env);
```

Imported lazily where needed; never accessed via raw `process.env` outside this file. `.env.example` lists every variable with a placeholder. CI fails if `EnvSchema` rejects.

---

## 14. Git workflow

Per CODING_STANDARDS §11:
- Branches: `feat/<slug>` / `fix/<slug>` / `chore/<slug>` / `refactor/<slug>`.
- Conventional Commits with bounded-context scope: `feat(match_lifecycle): add join flow`.
- One logical change per commit. Refactors separate from features.
- `main` is the default branch; PRs only, no direct pushes.
- Force-push only on feature branches the author owns.

Pre-commit hook (Husky + lint-staged): `prettier --write` + `eslint --fix` on staged TS files. CI runs `pnpm typecheck`, `pnpm lint`, `pnpm test`.

---

## 15. ADRs (Architecture Decision Records)

`docs/adr/NNNN-short-slug.md` for any decision that:
- Affects multiple bounded contexts
- Changes a pattern in this file
- Introduces a new external dependency
- Picks one of multiple defensible options (so the next agent knows *why*, not just *what*)

Format per CODING_STANDARDS §2.7: Context / Decision / Consequences / References.

This file (`ARCHITECTURE.md`) captures the **current state** of patterns. Major changes flow through an ADR first, then update this file.

Initial ADRs (written 2026-05-24):
- [ADR-0001 — REST Route Handlers as the default for mutations](./adr/0001-rest-routes-over-server-actions.md)
- [ADR-0002 — Throw typed exceptions from an `AppError` hierarchy](./adr/0002-throw-with-app-error-hierarchy.md)
- [ADR-0003 — Repository ports in `domain/` with Prisma adapters in `infrastructure/`](./adr/0003-repository-port-pattern-with-prisma.md)

---

## 16. Open questions (decide when relevant)

These are intentionally deferred — solving them before they come up wastes design time. Each will be answered by a one-paragraph ADR when the first concrete need arises.

| Topic | Trigger to revisit |
|---|---|
| Email sender provider (Resend vs Postmark vs SES) | When sending the first transactional email (Approve flow). |
| Browser push payload library (`web-push` vs Notification API only) | When implementing browser notifications post-MVP (v1 uses Notification API directly per spec — no service worker). |
| Image storage for venue covers | None in v1 — covers are static assets. Revisit if user-uploaded covers ever land. |
| MapLibre tile provider (OSM direct vs Maptiler vs self-hosted) | When traffic justifies caching / when free OSM hits rate limit. |
| Caching strategy (none in v1 explicitly) | When a query shows up as a hot spot in production. |
| Background job runner (currently: Vercel Cron / VPS cron only) | When a job needs retries / queues. |
| Observability (logs only in v1 vs Sentry / Axiom) | When the first production bug needs investigation. |

---

## 17. When you're stuck

In priority order:
1. **The spec is the source of truth for behavior.** [docs/spec/pitchup-spec-INDEX.md](./spec/pitchup-spec-INDEX.md).
2. **This file is the source of truth for code patterns.**
3. **[CODING_STANDARDS.md](../CODING_STANDARDS.md) is the source of truth for universal principles** (naming, file headers, errors, anchors).
4. **Mockups are the source of truth for visual design.** `mockups/*.html`.
5. **If two sources disagree** — flag it in Russian to the human. Don't pick a side silently.
6. **If none of the four cover your case** — flag it in Russian to the human. Don't invent a pattern.
