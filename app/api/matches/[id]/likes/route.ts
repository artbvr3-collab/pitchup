/**
 * MODULE: app.api.matches.id.likes.route
 * PURPOSE: POST /api/matches/:id/likes — like a teammate after the match ended.
 * LAYER: interfaces (Route Handler)
 * DEPENDENCIES: requireAuth, likeTeammateService, Zod
 * CONSUMED BY: Like modal on the match page
 * INVARIANTS:
 *   - requireAuth first (401 if no session).
 *   - Body validated with Zod ({ target_id }).
 *   - Next 15 async params.
 *   - Idempotent: a repeat like returns 200 (service maps both insert/existed).
 *   - Errors via toHttpResponse (409 match_not_ended / 403 not_a_participant /
 *     404 target_not_found).
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Post-match likes",
 *               "Per-endpoint checklist" → POST /matches/:id/likes
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/src/auth/composition";
import { asUserId } from "@/src/auth/domain/user";
import { likeTeammateService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ target_id: z.string().uuid() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId } = await params;
    const body = bodySchema.parse(await request.json());

    const result = await likeTeammateService.execute(
      {
        matchId,
        giverId: asUserId(session.userId),
        targetId: body.target_id,
      },
      new Date(),
    );

    return NextResponse.json({ outcome: result.outcome }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
