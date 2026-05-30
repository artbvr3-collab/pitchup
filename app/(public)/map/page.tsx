/**
 * MODULE: app.(public).map.page
 * PURPOSE: RSC shell for the `/map` full-screen match-map page. Parses URL
 *          sheet filters server-side and passes them to the MapView client
 *          island. No SSR data fetch — the map fetches `/api/matches/map`
 *          on the client after hydration (location comes from localStorage,
 *          so SSR can't pre-filter by distance anyway).
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/match_lifecycle/application/discover-filters, ./map-view
 * INVARIANTS:
 *   - Accessible to guests; middleware whitelists `/map`.
 *   - ?date= is ignored on /map — the map always shows the 21-day horizon.
 *   - ?pickLocation=true triggers automatic opening of the Location modal.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map".
 */
import { parseDiscoverFilters } from "@/src/match_lifecycle/application/discover-filters";

import { MapView } from "./map-view";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MapPage(props: PageProps) {
  const sp = await props.searchParams;
  const now = new Date();
  const filters = parseDiscoverFilters(sp, { now });

  const pickLocation =
    (typeof sp.pickLocation === "string" ? sp.pickLocation : sp.pickLocation?.[0]) === "true";

  return (
    <MapView
      initialFilters={{
        distanceKm: filters.distanceKm,
        timeOfDay: [...filters.timeOfDay],
        gameSize: [...filters.gameSize],
        spotsLeft: filters.spotsLeft,
        freeOnly: filters.freeOnly,
        fieldBookedOnly: filters.fieldBookedOnly,
      }}
      autoOpenLocationModal={pickLocation}
    />
  );
}
