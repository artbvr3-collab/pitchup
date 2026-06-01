/**
 * MODULE: app.api.admin.venues.route
 * PURPOSE: HTTP entry — admin creates a venue. `requireAdmin` → Zod
 *          (VenueCreateApiSchema) → `CreateVenueService` → `toHttpResponse`.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAdmin),
 *               src/match_lifecycle/composition (createVenueService),
 *               src/match_lifecycle/application/dto/venue-input,
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - `requireAdmin()` first — 401 (no/invalid session) / 403 admin_required
 *     (signed-in non-admin) before any work.
 *   - The body is whitelist-parsed by Zod; `cover_id` may be omitted (the
 *     service applies the deterministic default).
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/venues".
 */
import { NextResponse } from "next/server";

import { requireAdmin } from "@/src/auth/composition";
import { VenueCreateApiSchema } from "@/src/match_lifecycle/application/dto/venue-input";
import { createVenueService } from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin();
    const body = VenueCreateApiSchema.parse(await req.json());
    const venue = await createVenueService.execute({
      name: body.name,
      address: body.address,
      lat: body.lat,
      lng: body.lng,
      googleMapsUrl: body.google_maps_url,
      photoUrl: body.photo_url ?? null,
      surface: body.surface,
      ...(body.cover_id ? { coverId: body.cover_id } : {}),
      active: body.active,
    });
    return NextResponse.json({ ok: true, venue }, { status: 201 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
