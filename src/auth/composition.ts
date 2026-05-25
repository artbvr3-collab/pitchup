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
import { CompleteOnboardingService } from "./application/complete-onboarding-service";
import { requireAuthCore, type AuthenticatedUser } from "./application/require-auth";
import { auth } from "./infrastructure/auth";
import { userRepository } from "./infrastructure/repositories";

export const completeOnboardingService = new CompleteOnboardingService(userRepository);

export function requireAuth(): Promise<AuthenticatedUser> {
  return requireAuthCore(auth, userRepository);
}
