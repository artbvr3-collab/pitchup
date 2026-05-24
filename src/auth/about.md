# bounded context: auth

**Purpose.** Google OAuth login, session lifecycle, onboarding gate, ban / soft-delete enforcement.

**Core entities (planned).** `User`, `Session` (Auth.js v5 JWT), `OnboardingState`.

**Key use cases.** `requireAuth(req)`, `requireAdmin(req)`, onboarding middleware redirecting unfinished users to `/welcome`.

**External dependencies (ports, planned).** `UserRepository` (Prisma), `AuthProvider` (Auth.js v5 / Google).

**Status.** Empty — populated starting at Layer 1 (see `docs/ROADMAP.md`).

**Related docs.** `docs/spec/pitchup-spec-global.md` → "Authentication", `docs/ARCHITECTURE.md` §9.
