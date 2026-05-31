/**
 * MODULE: app.admin.reports.admin-reports-filters
 * PURPOSE: Client island for the `/admin/reports` filter bar — type (All /
 *          Match / Player) + aggregated status (All / New / Reviewed /
 *          Dismissed). Updates `?type=` and `?status=` via router.replace so
 *          the RSC re-fetches.
 * LAYER: interfaces (client)
 * DEPENDENCIES: next/navigation
 * CONSUMED BY: app/admin/reports/page.tsx
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/reports" → Filter.
 */
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

import type { ReportStatus, ReportType } from "@/src/moderation/domain/report";

const TYPE_OPTIONS: { value: ReportType | ""; label: string }[] = [
  { value: "", label: "All types" },
  { value: "match", label: "Match" },
  { value: "player", label: "Player" },
];

const STATUS_OPTIONS: { value: ReportStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "dismissed", label: "Dismissed" },
];

interface AdminReportsFiltersProps {
  readonly currentType: ReportType | null;
  readonly currentStatus: ReportStatus | null;
}

export function AdminReportsFilters({
  currentType,
  currentStatus,
}: AdminReportsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  const apply = useCallback(
    (type: string, status: string) => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname],
  );

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <select
        value={currentType ?? ""}
        onChange={(e) => apply(e.target.value, currentStatus ?? "")}
        className="h-9 rounded-lg border border-border bg-bg-base px-2 text-sm outline-none focus:border-primary"
        aria-label="Filter by type"
      >
        {TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={currentStatus ?? ""}
        onChange={(e) => apply(currentType ?? "", e.target.value)}
        className="h-9 rounded-lg border border-border bg-bg-base px-2 text-sm outline-none focus:border-primary"
        aria-label="Filter by status"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
