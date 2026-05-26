/**
 * MODULE: app.api.venues.route
 * PURPOSE: HTTP entry for `GET /api/venues` — list active venues for the
 *          Create-match wizard. Public read (the Server Component already
 *          fetches the same list on first paint; this endpoint exists for
 *          potential client refresh and parity).
 * LAYER: interfaces
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "/matches/new" → Step 1.
 */
import { NextResponse } from "next/server";

import { listVenuesService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const venues = await listVenuesService.execute();
    return NextResponse.json({ venues });
  } catch (err) {
    return toHttpResponse(err);
  }
}
