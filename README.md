# PITCHUP

> Pickup football matchmaking for Prague. Captain creates a match → players find it → captain approves → they play.

## What this is

A small web app (PWA later) for organising pickup football games in Prague. Solo + AI development project — not a startup, not (yet) a business. See [docs/spec/pitchup-spec-INDEX.md](./docs/spec/pitchup-spec-INDEX.md) for what the product actually does.

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind + shadcn/ui · Postgres + Prisma · Auth.js v5 (Google) · MapLibre + OSM · Zod · Vitest.

Full architecture: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Quick start

```bash
# 0. Get pnpm on PATH (one-time)
#    If `pnpm --version` works — skip. Otherwise, either:
corepack enable && corepack prepare pnpm@9.15.4 --activate
#    or run every pnpm command below as `npx pnpm@9.15.4 ...`.

# 1. Install
pnpm install

# 2. Bootstrap env
cp .env.example .env.local
# Replace placeholders in DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET.

# 3. Database
pnpm prisma migrate dev

# 4. Run
pnpm dev
```

Open http://localhost:3000.

## Key commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start dev server (Next.js + Turbopack). |
| `pnpm build` | Production build. |
| `pnpm start` | Run production build locally. |
| `pnpm typecheck` | `tsc --noEmit` across the project. |
| `pnpm lint` | ESLint over `app/`, `src/`. |
| `pnpm test` | Vitest run. |
| `pnpm test:watch` | Vitest watch mode. |
| `pnpm prisma migrate dev` | Apply pending migrations + regenerate client. |
| `pnpm prisma studio` | Open Prisma Studio (DB browser). |

## Where things live

- **`app/`** — Next.js routes (pages + Route Handlers). This is the interfaces layer.
- **`src/<bounded_context>/`** — domain logic. Each context has `domain/` + `application/` + `infrastructure/`. See [docs/ARCHITECTURE.md §2](./docs/ARCHITECTURE.md).
- **`src/shared/`** — cross-cutting (errors, config, db helpers, logger).
- **`src/ui/`** — UI kit (components + design tokens).
- **`prisma/`** — schema + migrations.
- **`docs/spec/`** — functional spec (source of truth for behavior). Start at [INDEX](./docs/spec/pitchup-spec-INDEX.md).
- **`docs/adr/`** — Architecture Decision Records.
- **`mockups/`** — HTML design anchors.

For a find-by-concept index: [NAVIGATION.md](./NAVIGATION.md).

## For AI agents working on this codebase

**Required reading before any code, in this order:**

1. [CODING_STANDARDS.md](./CODING_STANDARDS.md) — universal principles (naming, file headers, errors, anchors). §0 and §1 are non-negotiable.
2. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — concrete patterns for *this* project (folder layout, mutations, errors, validation, persistence, auth).
3. [docs/spec/CLAUDE.md](./docs/spec/CLAUDE.md) — rules for working with the spec (EN-only in `docs/spec/`, `ru/` is a frozen archive — do not read).
4. [docs/spec/pitchup-spec-INDEX.md](./docs/spec/pitchup-spec-INDEX.md) — spec entry point.
5. [AGENTS.md](./AGENTS.md) — quick-reference for current conventions and gotchas.

**One-liner contract:** code is English. Chat replies are Russian. Spec is the source of truth for *what* the system does; ARCHITECTURE for *how* we code it. Mockups (`mockups/*.html`) are the source of truth for visual design. If two sources disagree, stop and ask the human in Russian.

## License

Private. Not open source (yet).
