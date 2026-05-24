# ADR-0003: Repository ports in `domain/` with Prisma adapters in `infrastructure/`

- **Status:** Accepted
- **Date:** 2026-05-24
- **Deciders:** Artem (solo) + Claude (architect)

## Context

The project uses Prisma as its ORM (locked in [ARCHITECTURE.md §1](../ARCHITECTURE.md#1-stack-locked)). Prisma already provides a typed, query-builder-style abstraction over raw SQL — calling it "the repository" is a common shortcut.

The folder layout (ARCHITECTURE §2–§3) is hexagonal: each bounded context has `domain/` (pure), `application/` (use cases), `infrastructure/` (adapters). The dependency rule is strict: `domain/` and `application/` may not import from `infrastructure/`, only depend on ports defined inside the context.

This raises the obvious question: if Prisma is already an abstraction, why add another layer of indirection (port interface in `domain/` + adapter class in `infrastructure/`)? The shortcut is to inject the Prisma client into services directly and skip the port.

Forces:
- The spec mandates concurrency control via `pg_advisory_xact_lock` on every match-mutating endpoint ([match.md](../spec/pitchup-spec-match.md) → "Concurrency & locking"). Services orchestrate this through `withMatchLock(matchId, async (tx) => { … })`. Repositories must accept the locked `tx` client.
- Several race scenarios from [match.md](../spec/pitchup-spec-match.md) → "Race scenarios matrix" need fast unit tests at the `application/` layer. Spinning up Postgres in Docker for each one is too slow for tight feedback loops.
- Prisma errors (`PrismaClientKnownRequestError` with codes like `P2002`) leak DB-shape concerns into anything that touches the client. ADR-0002 requires those to be wrapped into the `AppError` hierarchy.
- Solo + AI dev: clean service signatures matter — if a service constructor takes 6 Prisma-typed args, AI generation drifts.

Constraints:
- One database (Postgres), no plans to swap. "What if we change ORM" is a weak motivator on its own.
- v1 is small (~7 aggregates: User, Match, JoinRequest, Watch, Notification, Report, Message). Boilerplate cost is bounded.

## Decision

**Every aggregate has (a) a repository port interface in `src/<context>/domain/<aggregate>-repository.ts` and (b) a Prisma adapter class in `src/<context>/infrastructure/prisma-<aggregate>-repository.ts` implementing it. Services depend on the port only, wired via the per-context composition root.**

Alternatives considered:

- **Option A — Inject Prisma client directly into services (no port):** ❌ rejected. Application code couples to Prisma types; tests need a real DB; Prisma error translation gets scattered across services instead of localized in adapters.
- **Option B — Generic `Repository<T>` base interface (CRUD-shaped):** ❌ rejected. Our queries are use-case-shaped, not CRUD-shaped (`findByIdForUpdate(tx)`, `findUpcomingForUser(userId, cursor)`, `countActiveJoinRequestsForUser(userId)`). A generic CRUD interface forces unnatural method names and leaks the missing methods into ad-hoc Prisma calls.
- **Option C — Query objects / CQRS split (read models separate from write models):** ❌ rejected for v1. No read-side bottleneck yet, adds two more layers and a vocabulary tax. Re-evaluate if a hot read appears in production (see ARCHITECTURE §16).
- **Option D — Port interface in `domain/` + Prisma adapter in `infrastructure/`, one per aggregate:** ✅ chosen. Pays a bounded boilerplate cost for three concrete wins listed below.

### Shape

```ts
// src/match_lifecycle/domain/match-repository.ts
export interface MatchRepository {
  findById(id: string): Promise<Match | null>;
  findByIdForUpdate(id: string, tx: TransactionClient): Promise<Match | null>;
  save(match: Match, tx: TransactionClient): Promise<void>;
}

// src/match_lifecycle/infrastructure/prisma-match-repository.ts
export class PrismaMatchRepository implements MatchRepository { /* … */ }

// src/match_lifecycle/composition.ts
export const matchRepository: MatchRepository = new PrismaMatchRepository(prisma);
export const joinMatchService = new JoinMatchService(matchRepository, joinRequestRepository, …);
```

`TransactionClient` is a Prisma-typed alias exported from `src/shared/db/types.ts`. **This is the one place where a Prisma type appears in a port signature** — accepted because the locking model is Postgres-specific by spec, and pretending otherwise would be theatre.

### Discipline rules

- **One port = one aggregate.** Not one port per use case, not one giant `DbPort`. Aggregates: `User`, `Match`, `JoinRequest`, `Watch`, `Notification`, `Report`, `Message`.
- **Methods are use-case-shaped, named for intent.** `findByIdForUpdate(tx)` not `findOneWithLock(opts)`. New use case needing a new query → add a method; don't reach around the port.
- **Adapter is the only place Prisma is imported** outside `src/shared/db/`. Grep `from "@prisma/client"` should return only `infrastructure/*.ts` files plus `shared/db/prisma.ts`.
- **Adapters translate Prisma errors.** `P2002` on a known unique constraint → matching `DomainError` (e.g. `AlreadyRequestedError`). Unknown Prisma errors → `InfrastructureError` with `cause`. ADR-0002 catches the rest.
- **Transactions flow as parameters, not as ambient context.** `withMatchLock` opens the tx, the service threads it into repository calls. No `AsyncLocalStorage`, no global tx singleton.
- **Domain entities are not Prisma rows.** Adapter maps Prisma `match` row → `Match` domain object on the way out, and back on `save`. Mapping helpers (`toDomain`, `toPersistence`) live inside the adapter file.

## Consequences

**Easier:**
- `application/` services unit-test with in-memory fake repositories — no Docker, no migrations, runs in milliseconds. This is the lever that pays for the boilerplate: every race scenario in `match.md` becomes a fast test.
- Prisma error translation lives in one file per aggregate — invariants and HTTP codes don't leak across the codebase.
- Service constructor signatures stay readable: 2–4 ports, all with intention-revealing names.
- Adding a read-side projection later (CQRS split) means adding a second adapter that implements the same port — no service changes.

**Harder / costs:**
- ~15% more code per aggregate (port interface + adapter class + composition wiring). Bounded to ~7 aggregates in v1.
- Two places to edit when a query shape changes (port signature + adapter implementation). Mitigated by TypeScript: changing the port breaks the adapter at compile time.
- One Prisma-typed parameter (`TransactionClient`) lives in the port — pragmatic concession to the spec's Postgres-specific locking model. Don't grow this list without an ADR amendment.
- Mapping `Prisma row → domain entity` is hand-written. If aggregates grow past ~15 fields, consider a small mapper helper (not a generic library).

**New obligations:**
- First scaffold PR ships `src/shared/db/{prisma.ts,types.ts,with-match-lock.ts}` plus one example aggregate end-to-end (suggest: `Match`) so the pattern is concrete before the second context lands.
- Every new aggregate gets a port in `domain/`, an adapter in `infrastructure/`, and a wiring line in `composition.ts` — in the same PR that introduces it.
- If a service ever imports `@prisma/client` directly, that's a pattern break: stop and route through a port.

## References

- Spec sections this affects: [docs/spec/pitchup-spec-match.md](../spec/pitchup-spec-match.md) → "Concurrency & locking", "Race scenarios matrix"
- Code patterns: [docs/ARCHITECTURE.md §8](../ARCHITECTURE.md#8-persistence) (repository pattern, advisory locks), §12 (testing strategy)
- Related ADRs: ADR-0001 (services called from Route Handlers), ADR-0002 (adapters wrap Prisma errors into `AppError` hierarchy)
- External: [Prisma — error reference](https://www.prisma.io/docs/orm/reference/error-reference), [Postgres — advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
