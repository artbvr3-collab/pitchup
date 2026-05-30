/**
 * MODULE: app.api.admin.users.[id].ban.route
 * PURPOSE: HTTP entry — admin bans a user. `requireAdmin` → Zod (reason
 *          required) → `BanUserService` (self-mod + last-admin guards, upcoming-
 *          match cascade, audit row) → `toHttpResponse`.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAdmin), src/moderation/composition
 *               (banUserService), src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAdmin()` first — 401 (no/invalid session) / 403 admin_required
 *     (signed-in non-admin) before any work.
 *   - The actor id is the admin's own `session.userId` (never from the body) —
 *     the self-modification guard compares it against the path `:id`.
 *   - Reason is required (textarea required in the spec ban modal). It is
 *     written to the audit log ONLY; players see the canonical
 *     "Organizer account was removed" cancel reason, not this text.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/users" → Ban.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/src/auth/composition";
import { banUserService } from "@/src/moderation/composition";
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
    const result = await banUserService.execute(
      { actorAdminId: admin.userId, targetUserId: id, reason },
      new Date(),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toHttpResponse(err);
  }
}
