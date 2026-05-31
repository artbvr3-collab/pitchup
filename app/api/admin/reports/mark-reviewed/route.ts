/**
 * MODULE: app.api.admin.reports.mark-reviewed.route
 * PURPOSE: `POST /api/admin/reports/mark-reviewed` — flip every `new` report on
 *          a target to `reviewed`. Called by the `/admin/reports` Review modal
 *          right AFTER a successful destructive action (Ban / Cancel / Delete)
 *          on that target. The action itself reuses the existing admin
 *          endpoints (spec personal.md §348 — "no duplicated logic"); this
 *          endpoint owns only the report-status side effect.
 * LAYER: interfaces
 * INVARIANTS:
 *   - `requireAdmin()` — 401/403 for non-admins. `reviewed_by` = the acting
 *     admin's id (from the gate, never the body).
 *   - Idempotent: a target with no `new` reports updates 0 rows and still 200s
 *     (the destructive action may have already flipped them on a prior click).
 *   - Hide-text toggles do NOT call this (spec §342 — hiding text does not
 *     change report status).
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/reports" → Review.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/src/auth/composition";
import { reportRepository } from "@/src/moderation/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MarkReviewedSchema = z.object({
  type: z.enum(["match", "player"]),
  target_id: z.string().min(1, "target_required"),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    const { type, target_id } = MarkReviewedSchema.parse(await request.json());

    const reviewed = await reportRepository.markAllNewReviewed(
      type,
      target_id,
      admin.userId,
      new Date(),
    );

    return NextResponse.json({ reviewed }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
