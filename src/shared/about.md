# cross-cutting: shared

**Purpose.** Truly cross-cutting infrastructure that doesn't belong to a single bounded context: Prisma client + advisory-lock helper, `AppError` hierarchy + HTTP mapping, Zod-validated env, structured logger.

**Planned layout (populated as layers land — see `docs/ROADMAP.md`).**
- `db/prisma.ts`, `db/with-match-lock.ts` — Layer 2 (Discover) and Layer 4 (Join/Approve concurrency).
- `errors/app-error.ts`, `errors/http-mapping.ts` — Layer 1 (first protected endpoint).
- `config/env.ts` — Layer 1 (Auth.js secrets) or earlier if needed.
- `logger/logger.ts` — Layer 1 onwards.

**Status.** Empty by design at Layer 0. Files appear when a feature genuinely needs them — no preemptive stubs (per CODING_STANDARDS §14.3).

**Related docs.** `docs/ARCHITECTURE.md` §3 (dependency direction), §6 (errors), §8 (db + lock), §13 (config).
