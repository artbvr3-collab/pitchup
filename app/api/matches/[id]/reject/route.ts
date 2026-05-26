/**
 * MODULE: app.api.matches.id.reject.route
 * PURPOSE: HTTP entry for `POST /api/matches/:id/reject` (captain). Thin:
 *          requireAuth → Zod parse → service (advisory-locked) → 200.
 *          UI label is "Decline" (glossary §9); the endpoint stays /reject.
 * LAYER: interfaces
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Per-endpoint checklist"
 *               → POST /matches/:id/reject, "Reject / Kick / Leave flows"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { rejectJoinRequestService } from "@/src/match_lifecycle/composition";
import { RequestIdApiSchema } from "@/src/match_lifecycle/application/dto/approve-reject-input";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId } = await params;
    const body = RequestIdApiSchema.parse(await request.json());

    const result = await rejectJoinRequestService.execute(
      {
        matchId,
        captainId: session.userId,
        requestId: body.request_id,
      },
      new Date(),
    );

    return NextResponse.json({ status: result.status }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
