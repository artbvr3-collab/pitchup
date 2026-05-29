/**
 * MODULE: app.api.updates.state.route
 * PURPOSE: HTTP entry for `GET /api/updates/state?since=<ISO>`. The GLOBAL poll
 *          (the second of the two poll endpoints — the per-match one is
 *          `/api/matches/:id/state`). Active on every signed-in page; drives the
 *          🔔 red dot, the Updates panel, browser notifications, and
 *          `matches_changed` list refreshes. Returns the wire payload assembled
 *          by `UpdatesStateService`.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAuth), src/notifications/composition
 *               (updatesStateService), src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAuth()` first — banned / deleted / missing → 401, which the
 *     client intercepts to redirect (`/login?error=banned` or `/login`). This
 *     is the session-invalidation mechanism for the polling layer (spec
 *     global.md → "Auth on ban / account deletion").
 *   - `?since=` is parsed leniently — missing / malformed → null (full current
 *     state), never a 400. Same convention as `/api/matches/:id/state` and the
 *     Discover URL parser (AGENTS gotchas).
 *   - `Cache-Control: no-store` — every poll hits the origin.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Polling sync" → "Global poll"
 *   - docs/ARCHITECTURE.md §10 (polling endpoints)
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { updatesStateService } from "@/src/notifications/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";
import { parseSince } from "@/src/shared/http/parse-since";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const since = parseSince(request.nextUrl.searchParams.get("since"));

    const payload = await updatesStateService.execute({
      userId: session.userId,
      since,
    });

    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return toHttpResponse(err);
  }
}
