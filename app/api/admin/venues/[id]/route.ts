/**
 * MODULE: app.api.admin.venues.[id].route
 * PURPOSE: HTTP entry — admin edits a venue. `requireAdmin` → Zod
 *          (VenueUpdateApiSchema) → `UpdateVenueService` (deactivation guard)
 *          → `toHttpResponse`.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAdmin),
 *               src/match_lifecycle/composition (updateVenueService),
 *               src/match_lifecycle/application/dto/venue-input,
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAdmin()` first.
 *   - Next 15 async `params` — `const { id } = await params;`.
 *   - The deactivation guard (active → inactive with upcoming matches) is the
 *     service's job — it returns 409 `venue_has_upcoming_matches`. Unknown id
 *     → 404 `venue_not_found`.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/venues".
 */
import { NextResponse } from "next/server";

import { requireAdmin } from "@/src/auth/composition";
import { VenueUpdateApiSchema } from "@/src/match_lifecycle/application/dto/venue-input";
import { updateVenueService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = VenueUpdateApiSchema.parse(await req.json());
    const venue = await updateVenueService.execute(
      id,
      {
        name: body.name,
        address: body.address,
        lat: body.lat,
        lng: body.lng,
        googleMapsUrl: body.google_maps_url,
        surface: body.surface,
        coverId: body.cover_id,
        active: body.active,
      },
      new Date(),
    );
    return NextResponse.json({ ok: true, venue });
  } catch (err) {
    return toHttpResponse(err);
  }
}
