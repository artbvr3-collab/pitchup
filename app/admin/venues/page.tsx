/**
 * MODULE: app.admin.venues.page
 * PURPOSE: `/admin/venues` Server Component. Reads the (optionally status-
 *          filtered) venue list decorated with the upcoming-match count, maps
 *          rows to a serialisable shape, and renders the status-filter island +
 *          the table island (which owns Add/Edit modals + row actions).
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (requireAdminPage),
 *               src/match_lifecycle/composition (venueRepository),
 *               ./admin-venues-filters, ./admin-venues-table
 * INVARIANTS:
 *   - Admin-only via `requireAdminPage()` (middleware already gated; backstop).
 *   - `?status=` is whitelist-parsed — unknown values fall back to "all" (never
 *     4xx; same lenient convention as Discover / /admin/users).
 *   - `upcomingMatchCount` per row drives the form's deactivation-guard toggle
 *     disable + hint; the API re-checks (409 backstop).
 *   - Row cap is not enforced — venue volume is tiny. // TODO(scale)
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/venues".
 */
import { requireAdminPage } from "@/src/auth/composition";
import { venueRepository } from "@/src/match_lifecycle/composition";

import { AdminVenuesFilters } from "./admin-venues-filters";
import { AdminVenuesTable, type AdminVenueRow } from "./admin-venues-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminVenuesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdminPage();
  const sp = await searchParams;

  const statusRaw = one(sp.status);
  const status =
    statusRaw === "active" || statusRaw === "inactive" ? statusRaw : undefined;

  const venues = await venueRepository.listAllForAdmin({
    ...(status ? { status } : {}),
    now: new Date(),
  });

  const rows: AdminVenueRow[] = venues.map((v) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    lat: v.lat,
    lng: v.lng,
    googleMapsUrl: v.googleMapsUrl,
    surface: [...v.surface],
    coverId: v.coverId,
    active: v.active,
    upcomingMatchCount: v.upcomingMatchCount,
  }));

  return (
    <div className="flex flex-col">
      <AdminVenuesFilters />
      <AdminVenuesTable rows={rows} />
    </div>
  );
}
