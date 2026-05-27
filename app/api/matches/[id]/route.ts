/**
 * MODULE: app.api.matches.id.route
 * PURPOSE: HTTP entry for `PATCH /api/matches/:id` (captain edit). Thin:
 *          requireAuth → Zod parse (field whitelist + optimistic-concurrency
 *          `updated_at`) → buildPatchFromApiBody → service (advisory-locked)
 *          → 200 with the freshly-bumped `updated_at` echoed back so the
 *          client can chain another edit without a re-read.
 * LAYER: interfaces
 * INVARIANTS:
 *   - The field whitelist lives in `EditMatchApiSchema`, NOT in the service.
 *     Spec match.md §647 — unknown keys (start_time, duration, venue_id,
 *     cancelled_at, cancel_reason, …) are silently dropped on parse.
 *   - `updated_at` is required (ISO with offset). Zod transforms it to a
 *     `Date` so the service compares via `getTime()` rather than fragile
 *     ISO-string equality.
 *   - PATCH is the captain-only edit endpoint; admin Edit lands in Layer 9
 *     via `/admin/matches`. Same service can be re-used then by swapping
 *     the auth gate for `requireAdmin()`.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → PATCH
 *     /matches/:id, "/matches/:id/edit", "Backend validation errors on
 *     edit save"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import {
  EditMatchApiSchema,
  buildPatchFromApiBody,
} from "@/src/match_lifecycle/application/dto/edit-match-input";
import { editMatchService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId } = await params;
    const body = EditMatchApiSchema.parse(await request.json());

    const result = await editMatchService.execute(
      {
        matchId,
        captainId: session.userId,
        updatedAt: body.updated_at,
        patch: buildPatchFromApiBody(body),
      },
      new Date(),
    );

    return NextResponse.json(
      {
        status: result.status,
        updated_at: result.updatedAt.toISOString(),
        notified: result.notifiedWatcherCount,
      },
      { status: 200 },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}
