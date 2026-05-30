/**
 * MODULE: app.api.admin.users.[id].promote.route
 * PURPOSE: HTTP entry — admin grants admin rights. `requireAdmin` → Zod
 *          (reason required) → `PromoteUserService` → `toHttpResponse`.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAdmin),
 *               src/moderation/composition (promoteUserService),
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAdmin()` first.
 *   - Reason required (spec Promote/Demote confirm modal) → audit log.
 *   - Self-modification guard lives in the service (actor = session.userId).
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/users" → Promote.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/src/auth/composition";
import { promoteUserService } from "@/src/moderation/composition";
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
    const result = await promoteUserService.execute({
      actorAdminId: admin.userId,
      targetUserId: id,
      reason,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toHttpResponse(err);
  }
}
