/**
 * MODULE: app.api.admin.matches.id.route
 * PURPOSE: Admin-level match mutations.
 *   - `DELETE /api/admin/matches/:id` — hard delete the match + all child
 *     data. Records a tombstone first so the global poll can emit
 *     `admin_deleted` to affected users for 24 h.
 *   - `PATCH /api/admin/matches/:id` — admin edit, same fields as captain
 *     edit. Bypasses `NotCaptainError` by resolving the match's actual
 *     `captainId` before delegating to `EditMatchService`.
 * LAYER: interfaces
 * INVARIANTS:
 *   - `requireAdmin()` on both verbs — 401/403 for non-admins.
 *   - DELETE returns 204 (no content) on success.
 *   - PATCH mirrors `PATCH /api/matches/:id` field whitelist + OCC semantics.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → Delete / Edit
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@/src/auth/composition";
import {
  EditMatchApiSchema,
  buildPatchFromApiBody,
} from "@/src/match_lifecycle/application/dto/edit-match-input";
import {
  adminDeleteMatchService,
  editMatchService,
  matchRepository,
} from "@/src/match_lifecycle/composition";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { id: matchId } = await params;
    await adminDeleteMatchService.execute(matchId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toHttpResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { id: matchId } = await params;
    const body = EditMatchApiSchema.parse(await request.json());

    // Unlocked pre-read to resolve captainId — captainId is immutable after
    // INSERT, so reading it without the lock is safe. EditMatchService re-reads
    // the match under the advisory lock; the captain check passes because we
    // supply the actual captain's id.
    const match = await matchRepository.findById(asMatchId(matchId));
    if (!match) return toHttpResponse(new MatchNotFoundError({ matchId }));

    const result = await editMatchService.execute(
      {
        matchId,
        captainId: match.captainId,
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
