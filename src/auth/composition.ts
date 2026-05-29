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
import { cancelMatchService } from "@/src/match_lifecycle/composition";
import { matchRepository } from "@/src/match_lifecycle/infrastructure/repositories";

import { CompleteOnboardingService } from "./application/complete-onboarding-service";
import { DeleteAccountService } from "./application/delete-account-service";
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
