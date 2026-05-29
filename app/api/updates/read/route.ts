/**
 * MODULE: app.api.updates.read.route
 * PURPOSE: HTTP entry for `POST /api/updates/read`. Marks ALL of the caller's
 *          unread notifications as read — called when the Updates panel opens.
 *          Clears the 🔔 red dot; other tabs see it cleared on their next
 *          `GET /api/updates/state` poll (spec global.md → "Multi-tab
 *          consistency").
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAuth),
 *               src/notifications/infrastructure/repositories,
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAuth()` first — 401 on banned / deleted / missing.
 *   - `userId` comes from the session, NEVER the request body — a user can
 *     only mark THEIR OWN notifications read.
 *   - `markAllRead` updates every `read_at IS NULL` row (no LIMIT) — the red
 *     dot must clear completely, including items beyond the top-20 panel
 *     window (spec global.md → "Mark-as-read"). No advisory lock (per-user,
 *     single writer, last-write-wins).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Notifications" (Mark-as-read),
 *     "Polling sync" (Multi-tab consistency)
 */
import { NextResponse } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { notificationRepository } from "@/src/notifications/infrastructure/repositories";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    await notificationRepository.markAllRead(session.userId);
    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}
