/**
 * MODULE: app.api.admin.matches.id.cancel.route
 * PURPOSE: `POST /api/admin/matches/:id/cancel` — admin cancels any match.
 *          Delegates to `AdminCancelMatchService` which resolves the match's
 *          captainId and reuses the existing `CancelMatchService` unchanged.
 * LAYER: interfaces
 * INVARIANTS:
 *   - `requireAdmin()` — 401/403 for non-admins.
 *   - Same business rules as captain cancel (start-time guard, idempotency,
 *     mass-reject pending, watch wipe, notification fan-out).
 *   - `cancel_reason` same validation as captain cancel (NFC + trim + 1..200).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → Cancel
 *   - src/match_lifecycle/application/cancel-match-service.ts
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/src/auth/composition";
import { adminCancelMatchService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CancelSchema = z.object({
  cancel_reason: z
    .string()
    .trim()
    .normalize("NFC")
    .min(1, "cancel_reason_required")
    .max(200, "cancel_reason_too_long"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { id: matchId } = await params;
    const { cancel_reason } = CancelSchema.parse(await request.json());

    const result = await adminCancelMatchService.execute(
      { matchId, cancelReason: cancel_reason },
      new Date(),
    );

    return NextResponse.json({ status: result.status }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
