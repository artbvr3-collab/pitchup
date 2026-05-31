/**
 * MODULE: app.api.admin.reports.id.dismiss.route
 * PURPOSE: `POST /api/admin/reports/:id/dismiss` — mark ONE report as
 *          `dismissed` ("reviewed, found no violation"). Only the currently
 *          open report flips; others on the same target are untouched (spec
 *          personal.md §322).
 * LAYER: interfaces
 * INVARIANTS:
 *   - `requireAdmin()` — 401/403 for non-admins. `reviewed_by` = acting admin.
 *   - 404 `report_not_found` when the id does not match a row (stale list /
 *     curl). Idempotent on an already-dismissed row (re-stamps, still 200).
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/reports".
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@/src/auth/composition";
import { reportRepository } from "@/src/moderation/composition";
import { ReportNotFoundError } from "@/src/moderation/domain/errors";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    const dismissed = await reportRepository.markDismissed(
      id,
      admin.userId,
      new Date(),
    );
    if (!dismissed) throw new ReportNotFoundError({ reportId: id });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
