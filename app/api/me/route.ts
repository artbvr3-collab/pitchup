/**
 * MODULE: app.api.me.route
 * PURPOSE: HTTP entry for self-service account actions. Currently DELETE only —
 *          soft-deletes the authenticated user and cascade-cancels every
 *          upcoming match they captain. Spec personal.md §170 + global.md
 *          "Ban / account deletion".
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAuth, deleteAccountService),
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAuth()` first. If the session is already invalid (banned /
 *     deleted-by-another-tab) → 401 propagates, client redirects to /login;
 *     this matches the spec's "session invalidation is column-based,
 *     enforced on every request" guarantee.
 *   - Success returns `204 No Content`. The client is responsible for the
 *     subsequent `signOut()` + redirect to `/` (the cookie deletion is a
 *     client-side Auth.js concern; even without sign-out, the next request
 *     from any tab will 401 because `users.deleted_at` is now non-null).
 *   - `409 last_admin` is the canonical backstop against UI drift — the
 *     `/me` page disables the button + shows blocking text, but a stale
 *     tab / direct curl reaches this branch. Client treats it as a toast +
 *     leaves the page intact.
 *   - No request body. A body would be a place to smuggle a different
 *     userId; the service ALWAYS deletes the caller's own account (taken
 *     from `session.userId`).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/me" → Section ACCOUNT ACTIONS
 *     → Delete account
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion",
 *     "Session invalidation"
 */
import { NextResponse } from "next/server";

import { deleteAccountService, requireAuth } from "@/src/auth/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    await deleteAccountService.execute(
      { userId: session.userId },
      new Date(),
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
