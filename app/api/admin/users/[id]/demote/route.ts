/**
 * MODULE: app.api.admin.users.[id].demote.route
 * PURPOSE: HTTP entry — admin revokes admin rights. `requireAdmin` → Zod
 *          (reason required) → `DemoteUserService` (self-mod + last-admin
 *          guards) → `toHttpResponse`.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAdmin),
 *               src/moderation/composition (demoteUserService),
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAdmin()` first.
 *   - Reason required (spec Promote/Demote confirm modal) → audit log.
 *   - 409 `last_admin` when demoting the sole active admin; 403
 *     `self_modification` on the own row — both backstops for desynced UI.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "Admin role management
 *               & safety".
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/src/auth/composition";
import { demoteUserService } from "@/src/moderation/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const { reason } = BodySchema.parse(await req.json());
    const result = await demoteUserService.execute({
      actorAdminId: admin.userId,
      targetUserId: id,
      reason,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toHttpResponse(err);
  }
}
