/**
 * MODULE: app.api.admin.users.[id].unban.route
 * PURPOSE: HTTP entry — admin lifts a ban. `requireAdmin` → `UnbanUserService`
 *          (flip banned=false, audit row) → `toHttpResponse`. No body.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAdmin),
 *               src/moderation/composition (unbanUserService),
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAdmin()` first.
 *   - No request body and no reason — the spec `[Unban]` action has no modal.
 *     Matches / profile are NOT restored, only the ability to sign in again.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/users" → Unban.
 */
import { NextResponse } from "next/server";

import { requireAdmin } from "@/src/auth/composition";
import { unbanUserService } from "@/src/moderation/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const result = await unbanUserService.execute({
      actorAdminId: admin.userId,
      targetUserId: id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toHttpResponse(err);
  }
}
