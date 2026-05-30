/**
 * MODULE: auth.composition
 * PURPOSE: Composition root for the `auth` bounded context. Wires concrete
 *          adapters (Prisma repository, Auth.js session getter) into the
 *          application services that the rest of the app (Route Handlers,
 *          Server Components, middleware) consumes.
 * LAYER: composition (cross-layer wiring)
 * DEPENDENCIES: ./application/*, ./infrastructure/*
 * CONSUMED BY: app/(auth)/welcome/page.tsx, middleware.ts, Route Handlers.
 * INVARIANTS:
 *   - Imported only from `app/` and `middleware.ts`. Never from `domain/`
 *     or `application/` (would defeat the dependency direction).
 * RELATED DOCS: docs/ARCHITECTURE.md §3 (dependency direction).
 */
import { redirect } from "next/navigation";

import { cancelMatchService } from "@/src/match_lifecycle/composition";
import { matchRepository } from "@/src/match_lifecycle/infrastructure/repositories";

import { CompleteOnboardingService } from "./application/complete-onboarding-service";
import { DeleteAccountService } from "./application/delete-account-service";
import { requireAdminCore } from "./application/require-admin";
import { requireAuthCore, type AuthenticatedUser } from "./application/require-auth";
import { UpdateProfileService } from "./application/update-profile-service";
import { asGoogleSub } from "./domain/user";
import { auth } from "./infrastructure/auth";
import { userRepository } from "./infrastructure/repositories";

export const completeOnboardingService = new CompleteOnboardingService(userRepository);
export const updateProfileService = new UpdateProfileService(userRepository);

/**
 * Layer 7.5 — cross-context: takes user-side ports + the match_lifecycle
 * cancel service for the upcoming-match cascade. Importing concrete services
 * (not just ports) from a sibling context is allowed at the composition root.
 */
export const deleteAccountService = new DeleteAccountService(
  userRepository,
  matchRepository,
  cancelMatchService,
);

/** Layer 6 — surfaced for /me to render the read-only avatar + email. */
export { userRepository };

export function requireAuth(): Promise<AuthenticatedUser> {
  return requireAuthCore(auth, userRepository);
}

/**
 * Layer 9 — admin gate for the `app/api/admin/**` Route Handlers. Throws
 * `UnauthorizedError` (401) for an invalid session, `ForbiddenError`
 * ("admin_required", 403) for a signed-in non-admin. `isAdmin` is read from
 * the DB on every call (never the JWT) so promote/demote take effect with no
 * re-login.
 */
export function requireAdmin(): Promise<AuthenticatedUser> {
  return requireAdminCore(auth, userRepository);
}

/**
 * Layer 9 — admin gate for the admin Server Components (`app/admin/**`).
 * Unlike `requireAdmin`, this REDIRECTS instead of throwing, matching the
 * spec's access rules (personal.md → "/admin" → Access):
 *   - no/invalid session → `/login?callbackUrl=/admin`
 *   - signed-in non-admin → silent `/my-matches` (no 403 page — the panel's
 *     existence is not exposed to regular users)
 * The middleware already enforces both before the page renders; this is the
 * defence-in-depth backstop (and the source of the verified `AuthenticatedUser`
 * the page needs — e.g. the current admin's id for the `(you)` row).
 */
export async function requireAdminPage(): Promise<AuthenticatedUser> {
  let user: AuthenticatedUser;
  try {
    user = await requireAuth();
  } catch {
    redirect("/login?callbackUrl=/admin");
  }
  if (!user.isAdmin) {
    redirect("/my-matches");
  }
  return user;
}

/**
 * Non-throwing variant of `requireAuth` for Server Components that serve
 * BOTH guests and authenticated users (`/matches/:id`, `/games`). Returns
 * `null` for no-session / banned / deleted / not-yet-onboarded. Mirrors the
 * same DB-checked invalidation as `requireAuth` — the JWT alone is never
 * trusted (spec global.md → "Session invalidation").
 */
export async function optionalAuth(): Promise<AuthenticatedUser | null> {
  const session = await auth();
  if (!session?.googleSub) return null;
  const user = await userRepository.findByGoogleSub(
    asGoogleSub(session.googleSub),
  );
  if (!user) return null;
  if (user.banned || user.deletedAt !== null) return null;
  return {
    userId: user.id,
    googleSub: user.googleSub,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
  };
}
