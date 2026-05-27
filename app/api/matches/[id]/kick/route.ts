/**
 * MODULE: app.api.matches.id.kick.route
 * PURPOSE: HTTP entry for `POST /api/matches/:id/kick` (captain destructive).
 *          Thin: requireAuth → Zod parse → service (advisory-locked +
 *          notify-watching fan-out) → 200.
 * LAYER: interfaces
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST
 *     /matches/:id/kick, "Reject / Kick / Leave flows", "notify watching"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { RequestIdApiSchema } from "@/src/match_lifecycle/application/dto/approve-reject-input";
import { kickPlayerService } from "@/src/match_lifecycle/composition";
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

    const result = await kickPlayerService.execute(
      {
        matchId,
        captainId: session.userId,
        requestId: body.request_id,
      },
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
