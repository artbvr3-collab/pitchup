/**
 * MODULE: app.api.matches.id.join.route
 * PURPOSE: HTTP entry for `POST /api/matches/:id/join`. Thin: requireAuth →
 *          Zod parse → service (advisory-locked) → 200 / mapped error.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition, src/match_lifecycle/composition,
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - User = the authenticated session. Payload does NOT carry user_id.
 *   - 200 with `{ request_id, outcome }` on success (created vs revived).
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Per-endpoint checklist"
 *               → POST /matches/:id/join
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { joinMatchService } from "@/src/match_lifecycle/composition";
import { JoinMatchApiSchema } from "@/src/match_lifecycle/application/dto/join-match-input";
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
    const body = JoinMatchApiSchema.parse(await request.json());

    const result = await joinMatchService.execute(
      {
        matchId,
        userId: session.userId,
        guestCount: body.guest_count,
        message: body.message ?? null,
      },
      new Date(),
    );

    return NextResponse.json(
      { request_id: result.requestId, outcome: result.outcome },
      { status: 200 },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}
