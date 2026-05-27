/**
 * MODULE: app.api.matches.id.cancel.route
 * PURPOSE: HTTP entry for `POST /api/matches/:id/cancel` (captain destructive).
 *          Thin: requireAuth → Zod parse + NFC normalise + trim →
 *          service (advisory-locked) → 200.
 * LAYER: interfaces
 * INVARIANTS:
 *   - `cancel_reason` is normalised at the boundary (NFC + trim) per spec
 *     global.md "Text field validation & sanitization". Empty after trim
 *     rejected at parse time (Zod `.min(1)`); max 200 chars enforced both
 *     in UI (counter) and here as the canonical backstop. Captain sheet
 *     also disables `[Confirm cancel]` on empty/overflow (spec §276).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST
 *     /matches/:id/cancel, "Reject / Kick / Leave flows" → "Match
 *     cancellation"
 *   - docs/spec/pitchup-spec-global.md → "Text field validation &
 *     sanitization" → cancel_reason 200 chars
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/src/auth/composition";
import { cancelMatchService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CancelMatchApiSchema = z.object({
  cancel_reason: z
    .string()
    .transform((s) => s.normalize("NFC").trim())
    .pipe(
      z
        .string()
        .min(1, "cancel_reason_required")
        .max(200, "cancel_reason_too_long"),
    ),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId } = await params;
    const body = CancelMatchApiSchema.parse(await request.json());

    const result = await cancelMatchService.execute(
      {
        matchId,
        captainId: session.userId,
        cancelReason: body.cancel_reason,
      },
      new Date(),
    );

    return NextResponse.json(
      {
        status: result.status,
        rejected_pending_count: result.rejectedPendingCount,
        watch_rows_deleted: result.watchRowsDeleted,
      },
      { status: 200 },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}
