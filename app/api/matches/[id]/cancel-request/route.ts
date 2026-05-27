/**
 * MODULE: app.api.matches.id.cancel-request.route
 * PURPOSE: HTTP entry for `POST /api/matches/:id/cancel-request`. Thin:
 *          requireAuth → service (advisory-locked) → 200.
 * LAYER: interfaces
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Per-endpoint checklist"
 *               → POST /matches/:id/cancel-request, "Cancel request flow"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { cancelJoinRequestService } from "@/src/match_lifecycle/composition";
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

    const result = await cancelJoinRequestService.execute({
      matchId,
      userId: session.userId,
    });

    return NextResponse.json({ status: result.status }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
