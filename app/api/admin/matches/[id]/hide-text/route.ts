/**
 * MODULE: app.api.admin.matches.id.hide-text.route
 * PURPOSE: `PATCH /api/admin/matches/:id/hide-text` — toggle the
 *          `description_hidden` and/or `cancel_reason_hidden` flags for
 *          content moderation. No lock, available for ALL match statuses.
 * LAYER: interfaces
 * INVARIANTS:
 *   - `requireAdmin()` — 401/403 for non-admins.
 *   - Both flags are optional; omitting one means "don't touch".
 *   - Returns the new flag state so the client can update its local view.
 *   - No audit row in v1 (spec personal.md → "Hide text").
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → "Hide text"
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/src/auth/composition";
import { adminHideTextService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HideTextSchema = z.object({
  description_hidden: z.boolean().optional(),
  cancel_reason_hidden: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { id: matchId } = await params;
    const body = HideTextSchema.parse(await request.json());

    const result = await adminHideTextService.execute({
      matchId,
      ...(body.description_hidden !== undefined
        ? { descriptionHidden: body.description_hidden }
        : {}),
      ...(body.cancel_reason_hidden !== undefined
        ? { cancelReasonHidden: body.cancel_reason_hidden }
        : {}),
    });

    return NextResponse.json(
      {
        description_hidden: result.descriptionHidden,
        cancel_reason_hidden: result.cancelReasonHidden,
      },
      { status: 200 },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}
