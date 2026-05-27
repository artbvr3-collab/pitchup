/**
 * MODULE: app.api.matches.id.watch.route
 * PURPOSE: HTTP entries for `POST /api/matches/:id/watch` and
 *          `DELETE /api/matches/:id/watch`. POST takes the advisory lock
 *          (Watch must be created on a full match — re-checks under lock);
 *          DELETE is idempotent and runs without a lock per spec (see
 *          UnwatchMatchService file header).
 * LAYER: interfaces
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Per-endpoint checklist"
 *               → POST /watch + DELETE /watch, "Watching logic"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import {
  unwatchMatchService,
  watchMatchService,
} from "@/src/match_lifecycle/composition";
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

    const result = await watchMatchService.execute(
      { matchId, userId: session.userId },
      new Date(),
    );

    return NextResponse.json({ outcome: result.outcome }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId } = await params;

    const result = await unwatchMatchService.execute({
      matchId,
      userId: session.userId,
    });

    return NextResponse.json({ status: result.status }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
