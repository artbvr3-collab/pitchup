/**
 * MODULE: auth.application.require-admin
 * PURPOSE: Admin gate for the `app/api/admin/**` Route Handlers. Builds on
 *          `requireAuthCore` (valid, unbanned, non-deleted, onboarded user)
 *          and additionally asserts `isAdmin`. Pure use-case logic — receives
 *          the session-getter + UserRepository via parameters; the composition
 *          root provides the concrete binding.
 * LAYER: application
 * DEPENDENCIES: ./require-auth, ../domain/user-repository,
 *               src/shared/errors/app-error
 * CONSUMED BY: src/auth/composition.ts → app/api/admin/**\/route.ts
 * INVARIANTS:
 *   - `isAdmin` is read from the DB (inside `requireAuthCore`), NEVER from the
 *     JWT — promote/demote take effect on the next request with no re-login
 *     (spec global.md → "`is_admin` not in JWT").
 *   - Throws `ForbiddenError("admin_required")` (403) for a non-admin caller.
 *     This is the API surface only; the admin *pages* are gated by the
 *     middleware silent-redirect to `/my-matches` (no 403 page — the spec
 *     hides the panel's existence from regular users) plus the
 *     `requireAdminPage` RSC backstop in composition.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin" → Access
 *   - docs/spec/pitchup-spec-global.md → "`is_admin` not in JWT"
 */
import { ForbiddenError } from "@/src/shared/errors/app-error";

import {
  requireAuthCore,
  type AuthenticatedUser,
} from "./require-auth";
import type { UserRepository } from "../domain/user-repository";

interface MinimalSession {
  readonly googleSub?: string | undefined;
}

export async function requireAdminCore(
  getSession: () => Promise<MinimalSession | null>,
  userRepository: UserRepository,
): Promise<AuthenticatedUser> {
  const user = await requireAuthCore(getSession, userRepository);
  if (!user.isAdmin) {
    throw new ForbiddenError("admin_required");
  }
  return user;
}
