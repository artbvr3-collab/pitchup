/**
 * MODULE: app.api.reports.route
 * PURPOSE: `POST /api/reports` — a signed-in user submits an abuse report on a
 *          match or a player. Thin: requireAuth → Zod parse → service → 200.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition, src/moderation/composition,
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - Reporter = the authenticated session; the body never carries reporter_id.
 *   - A duplicate report on the same target returns **200** with no new row
 *     (silent dedup — spec personal.md "Submission modal"). `deduped` is echoed
 *     for clients/tests but the UI shows the same success toast either way.
 *   - 401 (no session) is the standard guest path → the client opens the
 *     Sign-in flow before reaching here.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "Submission modal".
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { submitReportService } from "@/src/moderation/composition";
import { SubmitReportApiSchema } from "@/src/moderation/application/dto/submit-report-input";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const body = SubmitReportApiSchema.parse(await request.json());

    const result = await submitReportService.execute({
      reporterId: session.userId,
      type: body.type,
      targetId: body.target_id,
      comment: body.comment,
    });

    return NextResponse.json({ ok: true, deduped: result.deduped }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
