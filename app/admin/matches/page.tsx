/**
 * MODULE: app.admin.matches.page
 * PURPOSE: `/admin/matches` Server Component. Fetches the match list (≤200)
 *          with optional search and status filter, derives on-read status, and
 *          renders a status-filter client island + the matches table island.
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (requireAdminPage),
 *               src/match_lifecycle/composition (listAdminMatchesService),
 *               ./admin-matches-table
 * INVARIANTS:
 *   - Admin-only via `requireAdminPage()` (middleware already gated; backstop).
 *   - `?q=` and `?status=` are whitelist-parsed — unknown values fall back
 *     gracefully (same lenient convention as Discover / /admin/users).
 *   - Status filter uses domain values ("open", "almostFull", etc.), not UI
 *     labels. The table island maps them to human-readable strings.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/matches".
 */
import { requireAdminPage } from "@/src/auth/composition";
import { listAdminMatchesService, type AdminMatchStatus } from "@/src/match_lifecycle/composition";

import { AdminMatchesFilters } from "./admin-matches-filters";
import { AdminMatchesTable, type AdminMatchTableRow } from "./admin-matches-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const VALID_STATUSES = new Set<AdminMatchStatus>([
  "open", "almostFull", "full", "inProgress", "ended", "cancelled",
]);

type RawSearchParams = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AdminMatchesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdminPage();
  const sp = await searchParams;

  const search = (one(sp.q) ?? "").trim();
  const rawStatus = one(sp.status) ?? "";
  const statusFilter = rawStatus
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AdminMatchStatus => VALID_STATUSES.has(s as AdminMatchStatus));

  const matches = await listAdminMatchesService.execute({
    search,
    statusFilter,
    now: new Date(),
  });

  const rows: AdminMatchTableRow[] = matches.map((m) => ({
    id: m.id,
    venueName: m.venueName,
    captainName: m.captainName,
    captainId: m.captainId,
    dateLabel: DATE_FORMAT.format(m.startTime),
    status: m.status,
    participants: m.participants,
    totalSpots: m.totalSpots,
    descriptionHidden: m.descriptionHidden,
    cancelReasonHidden: m.cancelReasonHidden,
    hasDescription: m.description !== null && m.description.trim().length > 0,
    hasCancelReason: m.cancelReason !== null && m.cancelReason.trim().length > 0,
    updatedAt: m.updatedAt.toISOString(),
  }));

  return (
    <div className="flex flex-col">
      <AdminMatchesFilters currentSearch={search} currentStatus={statusFilter[0]} />
      <AdminMatchesTable rows={rows} />
    </div>
  );
}
