# cross-cutting: shared

**Purpose.** Truly cross-cutting infrastructure that doesn't belong to a single bounded context: Prisma client + advisory-lock helper, `AppError` hierarchy + HTTP mapping, Zod-validated env, structured logger.

**Layout.**
- `db/prisma.ts` — Prisma singleton. ✅ Added Layer 1 Etap A.
- `db/with-match-lock.ts` — advisory-lock helper. Pending Layer 4 (Join/Approve concurrency).
- `errors/app-error.ts` — base `AppError` + `UnauthorizedError` + `ValidationError`. ✅ Added Layer 1 Etap A. Remaining classes from ARCHITECTURE §6 (DomainError tree, NotFoundError, ForbiddenError, InfrastructureError) land when first thrown.
- `errors/http-mapping.ts` — `AppError → HTTP response`. Pending Layer 3 (first Route Handler mutation).
- `config/env.ts` — Zod-validated env (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`). ✅ Added Layer 1 Etap A. Schema grows as layers add variables — keep `.env.example` in sync.
- `logger/logger.ts` — structured JSON logger. Pending until first `warn+` log line is needed.

**Status.** Foundational shared module wired up at Layer 1. Add new files only when a feature genuinely needs them — no preemptive stubs (per CODING_STANDARDS §14.3).

**Related docs.** `docs/ARCHITECTURE.md` §3 (dependency direction), §6 (errors), §8 (db + lock), §13 (config).
