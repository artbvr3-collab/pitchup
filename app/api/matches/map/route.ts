/**
 * MODULE: app.api.matches.map
 * PURPOSE: `GET /api/matches/map` — returns all non-cancelled, non-past
 *          matches within the 21-day Prague horizon that pass the sheet
 *          filters (same params as /api/matches/discover minus ?date= and
 *          ?cursor=). Accessible to guests. Used by the `/map` client island
 *          to render venue pins.
 * LAYER: interfaces (Route Handler)
 * DEPENDENCIES: match_lifecycle/composition, match_lifecycle/application/discover-filters
 * INVARIANTS:
 *   - No auth required — public endpoint.
 *   - `?distance=` without `?lat=&lng=` is silently ignored.
 *   - Invalid query params fall back gracefully (same whitelist rules as
 *     /api/matches/discover — never 400 on bad params).
 *   - Location passed via `?lat=&lng=` query params (client reads from
 *     localStorage and appends to the request URL, same pattern as discover).
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map".
 */
import { type NextRequest, NextResponse } from "next/server";

import { parseDiscoverFilters } from "@/src/match_lifecycle/application/discover-filters";
import { listMapMatchesService } from "@/src/match_lifecycle/composition";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const now = new Date();

  const filters = parseDiscoverFilters(sp, { now });

  // Client appends ?lat=&lng= from localStorage when a location is saved.
  const lat = parseFloat(sp.get("lat") ?? "");
  const lng = parseFloat(sp.get("lng") ?? "");
  const location =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  const result = await listMapMatchesService.execute({ filters, now, location });

  // Group matches by venue for the client to render one pin per venue.
  const venueMap = new Map<
    string,
    {
      venueId: string;
      venueName: string;
      venueAddress: string;
      lat: number;
      lng: number;
      matches: (typeof result.matches[number])[];
    }
  >();

  for (const match of result.matches) {
    const vid = match.venue.id as string;
    if (!venueMap.has(vid)) {
      venueMap.set(vid, {
        venueId: vid,
        venueName: match.venue.name,
        venueAddress: match.venue.address,
        lat: match.venue.lat,
        lng: match.venue.lng,
        matches: [],
      });
    }
    venueMap.get(vid)!.matches.push(match);
  }

  const venues = Array.from(venueMap.values()).map((v) => ({
    venueId: v.venueId,
    venueName: v.venueName,
    venueAddress: v.venueAddress,
    lat: v.lat,
    lng: v.lng,
    matches: v.matches.map((m) => ({
      id: m.id as string,
      startTime: m.startTime.toISOString(),
      duration: m.duration,
      surface: m.surface,
      studsAllowed: m.studsAllowed,
      fieldBooked: m.fieldBooked,
      price: m.price,
      coverId: m.coverId,
      slots: m.slots,
      status: m.status,
    })),
  }));

  return NextResponse.json({ venues });
}
