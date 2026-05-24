# ADR-0002: Throw typed exceptions from an `AppError` hierarchy

- **Status:** Accepted
- **Date:** 2026-05-24
- **Deciders:** Artem (solo) + Claude (architect)

## Context

Every mutating endpoint in the spec has a per-endpoint checklist enumerating concrete failure modes with a specific HTTP code and machine-readable error code: `match_locked` (409), `over_capacity` (409), `already_requested` (409), `captain_cannot_join` (400), `unauthorized` (401), etc. See [match.md](../spec/pitchup-spec-match.md) → "Per-endpoint checklist".

We need a single discipline for representing those failures end-to-end:

1. Raised inside `domain/` (pure logic — `OverCapacityError`, `MatchLockedError`).
2. Propagated through `application/` services without forcing every method to widen its return type.
3. Mapped to the spec'd HTTP response in `app/api/**/route.ts` — once, in one place.
4. Logged with structured context (matchId, userId, attempted vs capacity, …) per CODING_STANDARDS §8.

Constraints:
- TypeScript, `strict: true`, no `any`.
- Prisma already throws (`PrismaClientKnownRequestError` etc.) — we have to handle thrown errors regardless of our own style.
- Solo dev + AI executors — boilerplate at every call site hurts disproportionately.
- Polling endpoints and optimistic UI on the client need a stable `{ code, message }` JSON shape — the wire format is fixed, the internal style is not.

## Decision

**Throw typed exceptions inheriting from a base `AppError` class. Catch once at the HTTP boundary (`toHttpResponse(err)` inside each Route Handler's `try/catch`). Domain layer defines its own errors; one shared mapping table converts `AppError → HTTP`.**

Hierarchy lives as described in [ARCHITECTURE.md §6](../ARCHITECTURE.md#6-errors):

```
AppError
├── DomainError              (subclassed per bounded context: MatchLockedError, OverCapacityError, …)
├── ValidationError          (Zod parse failures, wrapped)
├── UnauthorizedError        (from requireAuth)
├── ForbiddenError
├── NotFoundError
└── InfrastructureError      (DB down, third-party failure)
```

Mapping table `ERROR_CODE_TABLE` in `src/shared/errors/http-mapping.ts`. Unknown errors → 500 `internal_error`, logged with stack.

Alternatives considered:

- **Option A — `Result<T, E>` (neverthrow / fp-ts Either):** ❌ rejected. Every call site needs `.map`/`.andThen`/`.match` plumbing; Prisma still throws so we'd have a dual discipline anyway; and async + Result composes awkwardly without buying real safety we don't already get from exhaustive `instanceof` checks at the boundary.
- **Option B — Throw plain `Error` with a `code` field on it:** ❌ rejected. Loses TypeScript's discriminated-union narrowing; the mapping table becomes string-based and silently drifts when codes are renamed.
- **Option C — Return discriminated-union `{ ok: true, value } | { ok: false, error }` from services:** ❌ rejected. Same boilerplate problem as Result; doesn't survive crossing Route Handler boundaries (the framework boundary still throws).
- **Option D — Throw from typed `AppError` hierarchy, catch once at HTTP boundary:** ✅ chosen. Domain errors stay close to the invariants that raise them; services don't change signatures; HTTP mapping is one file; Prisma errors get wrapped into `InfrastructureError` in the repository adapters and join the same pipeline.

### Discipline rules

- **`domain/` errors extend `DomainError`** and live in `src/<context>/domain/errors.ts`. They carry typed fields (not just a string message) — see `OverCapacityError(matchId, attemptedFilled, capacity)` example in ARCHITECTURE.md §6.
- **`application/` services do not catch domain errors** unless they have a recovery to perform. Default behavior: let them bubble.
- **`infrastructure/` adapters wrap third-party errors into `InfrastructureError`** with a `cause`. Prisma's `P2002` (unique violation) on a known-domain constraint can be re-thrown as the matching `DomainError` (e.g. `AlreadyRequestedError`) — that translation lives in the adapter, not in the service.
- **`app/api/**/route.ts` is the only catch site.** Every handler ends with `} catch (err) { return toHttpResponse(err); }`. No selective catches above that. If you find yourself adding a `try/catch` in a service, it's almost certainly wrong — flag it.
- **Every code in the spec must appear in `ERROR_CODE_TABLE`.** If you find a spec error code that's not in the table, **stop and add it explicitly** — don't generalize. (ARCHITECTURE §6 rule, restated for emphasis.)
- **HTTP response body is `{ code: string, message: string }`.** `message` is generic / user-safe (no stack, no internal IDs). Detailed context goes to logs only.

## Consequences

**Easier:**
- Service signatures stay clean: `Promise<JoinMatchResult>` instead of `Promise<Result<JoinMatchResult, JoinMatchError>>`. AI executors generate them correctly without scaffolding.
- One source of truth for HTTP codes — when the spec changes a code, one edit in `ERROR_CODE_TABLE`.
- Unit tests assert with `await expect(...).rejects.toThrow(OverCapacityError)` — readable and exhaustive.
- Prisma's existing throw-based contract slots in naturally via adapter wrapping.

**Harder / costs:**
- Throwing is invisible in the type system — a caller doesn't know which errors a service can raise without reading it. **Mitigation:** every service's file header lists possible errors in the `INVARIANTS` block (see ARCHITECTURE §4); the per-endpoint checklist in the spec is the canonical list.
- A missed `try/catch` at the Route Handler boundary leaks a 500 with a stack to the user. **Mitigation:** lint rule (TODO) that requires `route.ts` exports to end in `toHttpResponse(err)` — until then, the Route Handler skeleton in ARCHITECTURE §5 is the copy-paste source.
- Re-throwing across async boundaries can swallow the original stack if not done with `cause`. **Mitigation:** `InfrastructureError` constructor always takes `cause` as a second arg.

**New obligations:**
- `src/shared/errors/app-error.ts`, `src/shared/errors/domain-error.ts`, `src/shared/errors/http-mapping.ts` are part of the first scaffold PR — they unblock every endpoint.
- New domain errors are added in the bounded context that owns the invariant (not in `shared/`).
- `ERROR_CODE_TABLE` and the spec's per-endpoint checklist are kept in lockstep. If they diverge, the spec wins and the table is fixed in the same PR.

## References

- Spec sections this affects: [docs/spec/pitchup-spec-match.md](../spec/pitchup-spec-match.md) → "Per-endpoint checklist", [docs/spec/pitchup-spec-global.md](../spec/pitchup-spec-global.md) → "API surface"
- Code patterns: [docs/ARCHITECTURE.md §6](../ARCHITECTURE.md#6-errors), [CODING_STANDARDS.md §8](../../CODING_STANDARDS.md) (structured error context)
- Related ADRs: ADR-0001 (Route Handlers are the catch site), ADR-0003 (repository adapters wrap Prisma errors)
- External: [TC39 Error cause](https://github.com/tc39/proposal-error-cause), [Prisma — error reference](https://www.prisma.io/docs/orm/reference/error-reference)
