/**
 * MODULE: app.api.matches.id.leave.route
 * PURPOSE: HTTP entry for `POST /api/matches/:id/leave`. Thin: requireAuth
 *          → service (advisory-locked + notify-watching fan-out) → 200.
 * LAYER: interfaces
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Per-endpoint checklist"
 *               → POST /matches/:id/leave, "Leave flow", "Race scenarios"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { leaveMatchService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId } = await params;

    const result = await leaveMatchService.execute(
      { matchId, userId: session.userId },
      new Date(),
    );

    return NextResponse.json(
      { status: result.status, notified: result.notifiedWatcherCount },
      { status: 200 },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}
