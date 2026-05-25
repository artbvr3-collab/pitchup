# bounded context: auth

**Purpose.** Google OAuth login, session lifecycle, onboarding gate, ban / soft-delete enforcement.

**Core entities.** `User` (`domain/user.ts`) — branded `UserId` / `GoogleSub`, snapshot fields (`name` / `email` / `avatarUrl` frozen at onboarding). `Session` is Auth.js v5's JWT — see `infrastructure/auth-config.ts`.

**Key use cases.**
- `CompleteOnboardingService.execute()` — INSERT user on `[Get started →]`, idempotent on the parallel-tab race.
- `requireAuthCore()` (bound as `requireAuth()` in `composition.ts`) — DB-backed session validation; throws `UnauthorizedError` with `no_session | user_not_found | banned | deleted`.
- `requireAdmin()` — pending Layer 9.
- Onboarding middleware redirecting unfinished users to `/welcome` — pending Etap D.

**Ports.** `UserRepository` (`domain/user-repository.ts`) — `findByGoogleSub`, idempotent `create`. Adapter: `PrismaUserRepository`.

**Status.** Layer 1 complete (A — Prisma + shared / B — Auth.js v5 / C — domain + use cases / D — middleware / E — `/login` + `/welcome` + `/my-matches` stub / F — Vitest tests). Not yet exercised against a live database or real Google OAuth credentials.

**Related docs.** `docs/spec/pitchup-spec-global.md` → "Authentication", `docs/ARCHITECTURE.md` §9.
