/**
 * MODULE: auth.application.require-auth
 * PURPOSE: Canonical "is the caller a valid, unbanned, non-deleted, onboarded
 *          user?" gate for Route Handlers, Server Components, and Server
 *          Actions. Pure use-case logic — receives a session-getter and the
 *          UserRepository via parameters. Composition root provides the
 *          concrete binding (see src/auth/composition.ts).
 * LAYER: application
 * DEPENDENCIES: src/shared/errors/app-error.ts, ../domain/user,
 *               ../domain/user-repository
 * CONSUMED BY: src/auth/composition.ts → middleware.ts, Route Handlers.
 * INVARIANTS:
 *   - Hits the DB on every call to fetch `banned` / `deletedAt` — these are
 *     the spec's invalidation columns (spec: "Session invalidation").
 *     Caching them in the JWT would defeat the mechanism.
 *   - The four `UnauthorizedError` discriminants (no_session / user_not_found
 *     / banned / deleted) drive the client redirect logic; they are part of
 *     the API contract.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "Authentication" →
 *               "Session invalidation", docs/ARCHITECTURE.md §9.
 */
import { UnauthorizedError } from "@/src/shared/errors/app-error";
import { asGoogleSub, type GoogleSub, type UserId } from "../domain/user";
import type { UserRepository } from "../domain/user-repository";

export interface AuthenticatedUser {
  readonly userId: UserId;
  readonly googleSub: GoogleSub;
  readonly email: string;
  readonly name: string;
  readonly isAdmin: boolean;
}

interface MinimalSession {
  readonly googleSub?: string | undefined;
}

export async function requireAuthCore(
  getSession: () => Promise<MinimalSession | null>,
  userRepository: UserRepository,
): Promise<AuthenticatedUser> {
  const session = await getSession();
  if (!session?.googleSub) {
    throw new UnauthorizedError("no_session");
  }

  const user = await userRepository.findByGoogleSub(asGoogleSub(session.googleSub));
  if (!user) throw new UnauthorizedError("user_not_found");
  if (user.banned) throw new UnauthorizedError("banned");
  if (user.deletedAt !== null) throw new UnauthorizedError("deleted");

  return {
    userId: user.id,
    googleSub: user.googleSub,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
  };
}
