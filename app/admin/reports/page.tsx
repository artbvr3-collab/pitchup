/**
 * MODULE: app.admin.reports.page
 * PURPOSE: `/admin/reports` Server Component. Fetches reports grouped by target
 *          (≤500 scanned), with optional type + aggregated-status filters, and
 *          renders the filter island + the reports table island.
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (requireAdminPage),
 *               src/moderation/composition (listAdminReportsService),
 *               ./admin-reports-filters, ./admin-reports-table
 * INVARIANTS:
 *   - Admin-only via `requireAdminPage()` (middleware already gated; backstop).
 *   - `?type=` and `?status=` are whitelist-parsed — unknown values fall back
 *     to "no filter" (same lenient convention as Discover / other admin tabs).
 *   - Domain objects (Date, branded ids) are mapped to a fully-serialisable
 *     row DTO here; the client island never receives a Date.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/reports".
 */
import { requireAdminPage } from "@/src/auth/composition";
import { listAdminReportsService } from "@/src/moderation/composition";
import type { ReportStatus, ReportType } from "@/src/moderation/domain/report";

import { AdminReportsFilters } from "./admin-reports-filters";
import {
  AdminReportsTable,
  type AdminReportTableRow,
} from "./admin-reports-table";

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

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  almostFull: "Almost full",
  full: "Full",
  inProgress: "In progress",
  ended: "Ended",
  cancelled: "Cancelled",
};

const VALID_TYPES = new Set<ReportType>(["match", "player"]);
const VALID_STATUSES = new Set<ReportStatus>(["new", "reviewed", "dismissed"]);

type RawSearchParams = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdminPage();
  const sp = await searchParams;

  const rawType = one(sp.type) ?? "";
  const rawStatus = one(sp.status) ?? "";
  const typeFilter: ReportType | null = VALID_TYPES.has(rawType as ReportType)
    ? (rawType as ReportType)
    : null;
  const statusFilter: ReportStatus | null = VALID_STATUSES.has(
    rawStatus as ReportStatus,
  )
    ? (rawStatus as ReportStatus)
    : null;

  const { groups } = await listAdminReportsService.execute(
    { typeFilter, statusFilter },
    new Date(),
  );

  const rows: AdminReportTableRow[] = groups.map((g) => ({
    key:
      g.targetId !== null
        ? `${g.type}:${g.targetId}`
        : `${g.type}:orphan:${g.reports[0]!.id}`,
    type: g.type,
    targetId: g.targetId,
    reportCount: g.reportCount,
    aggregatedStatus: g.aggregatedStatus,
    lastReportLabel: DATE_FORMAT.format(g.lastReportAt),
    lastReporterName: g.reports[0]!.reporterName,
    player:
      g.target.kind === "player"
        ? {
            userId: g.target.userId,
            name: g.target.name,
            removed: g.target.removed,
          }
        : null,
    match:
      g.target.kind === "match"
        ? {
            matchId: g.target.matchId,
            venueName: g.target.venueName,
            dateLabel: g.target.startTime
              ? DATE_FORMAT.format(g.target.startTime)
              : null,
            statusLabel: g.target.status
              ? (STATUS_LABEL[g.target.status] ?? g.target.status)
              : null,
            isLive: g.target.isLive,
            hasDescription: g.target.hasDescription,
            descriptionHidden: g.target.descriptionHidden,
            hasCancelReason: g.target.hasCancelReason,
            cancelReasonHidden: g.target.cancelReasonHidden,
            isCancelled: g.target.isCancelled,
          }
        : null,
    reports: g.reports.map((r) => ({
      id: r.id,
      reporterName: r.reporterName,
      comment: r.comment,
      dateLabel: DATE_FORMAT.format(r.createdAt),
      status: r.status,
    })),
  }));

  return (
    <div className="flex flex-col">
      <AdminReportsFilters currentType={typeFilter} currentStatus={statusFilter} />
      <AdminReportsTable rows={rows} />
    </div>
  );
}
