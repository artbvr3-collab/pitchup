# ADR-0001: REST Route Handlers as the default for mutations

- **Status:** Accepted
- **Date:** 2026-05-24
- **Deciders:** Artem (solo) + Claude (architect)

## Context

Next.js 15 App Router gives us two viable transports for state-changing operations:

1. **REST Route Handlers** under `app/api/**/route.ts` — explicit HTTP, called via `fetch` from client components.
2. **Server Actions** — server functions invoked through form submissions or direct calls from client/server components, transport handled by the framework.

The functional spec is already written in REST terms: every mutation has a documented endpoint (`POST /api/matches/:id/join`, `POST /api/matches/:id/approve`, `DELETE /api/matches/:id/leave`, …) with per-endpoint checklists in [match.md](../spec/pitchup-spec-match.md) → "Per-endpoint checklist". We also have two **polling endpoints** (`GET /api/updates/state`, `GET /api/matches/:id/state`) that have to be REST regardless — Server Actions don't fit a polling cursor model.

Several screens (match page, my-matches list) need **optimistic UI** with manual rollback on server error — the client owns the optimistic state and needs first-class access to the response/error.

Constraints:
- Solo dev + AI executors (DeepSeek via Cursor). One default transport is easier to teach than two.
- Mutations must be testable as HTTP requests (integration smoke tests in §12 of [ARCHITECTURE.md](../ARCHITECTURE.md)).
- Two forms exist where there is no polling and no optimistic UI: **`/welcome`** onboarding and **`/me → Edit profile`**. For these, Server Actions are ergonomic (no client `fetch` boilerplate, native `<form action>` progressive enhancement).

## Decision

**All mutations are REST Route Handlers under `app/api/**/route.ts`. Server Actions are used only for `/welcome` and `/me → Edit profile`.**

Alternatives considered:

- **Option A — Server Actions everywhere:** ❌ rejected. Conflicts with the spec's REST contract, doesn't pair with polling endpoints, makes optimistic UI awkward (the client needs the response object, not a form submission lifecycle).
- **Option B — REST Route Handlers everywhere (including onboarding):** ❌ rejected. Two simple forms don't justify the `fetch` + loading-state + error-toast boilerplate; Server Actions there are objectively shorter without losing anything.
- **Option C — REST default, Server Actions for two named exceptions:** ✅ chosen. Default is uniform with the spec; exceptions are explicit and bounded.
- **Option D — tRPC / GraphQL:** ❌ rejected. New dependency, no scale benefit at solo + Prague-only. Re-evaluate if we ever expose a public API.

### Where the boundary lives

- **REST (default):** every endpoint listed in [match.md](../spec/pitchup-spec-match.md), [discovery.md](../spec/pitchup-spec-discovery.md), [global.md](../spec/pitchup-spec-global.md) → "API surface". Route Handler skeleton is in [ARCHITECTURE.md §5](../ARCHITECTURE.md#5-mutations-route-handlers-default).
- **Server Actions (exceptions):** `app/(auth)/welcome/actions.ts`, `app/(private)/me/actions.ts`. Each action file delegates to a service in `src/<context>/application/` exactly like a Route Handler would — the only difference is the transport.

Adding a third Server Action requires a follow-up ADR (or amending this one). Resist case-by-case drift.

## Consequences

**Easier:**
- One mental model for mutations: parse → validate (Zod) → call service → map error via `toHttpResponse`.
- Polling endpoints, optimistic UI, and webhook-style integrations all use the same transport.
- HTTP-level integration tests are trivial (`fetch` against a test server).
- Spec ↔ code traceability: every `POST /api/...` line in the spec maps to a `route.ts` file with the same path.

**Harder / costs:**
- Onboarding two transports instead of one — but bounded to two named pages, so the cost is one-time.
- Server Actions for `/welcome` and `/me` still need the same service layer underneath; no shortcut on the application/domain side.
- Client `fetch` boilerplate for simple forms is duplicated in a few places (acceptable; revisit only if we get more than ~6 such forms).

**New obligations:**
- The two Server Action files (`app/(auth)/welcome/actions.ts`, `app/(private)/me/actions.ts`) must carry the standard file header and a one-line comment explaining *why* they are the exception (link back to this ADR).
- If a future mutation is unsure which side it belongs on: default to REST. Server Actions require justification, not the reverse.

## References

- Spec sections this affects: [docs/spec/pitchup-spec-global.md](../spec/pitchup-spec-global.md) → "API surface", [docs/spec/pitchup-spec-match.md](../spec/pitchup-spec-match.md) → "Per-endpoint checklist"
- Code patterns: [docs/ARCHITECTURE.md §5](../ARCHITECTURE.md#5-mutations-route-handlers-default) (Route Handler skeleton), §10 (polling)
- Related ADRs: ADR-0002 (error hierarchy used by `toHttpResponse`), ADR-0003 (repository ports the services depend on)
- External: [Next.js — Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers), [Next.js — Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
