/**
 * MODULE: app.admin.matches.admin-matches-filters
 * PURPOSE: Client island for `/admin/matches` search + status filter bar.
 *          Updates `?q=` and `?status=` via router.replace so the RSC
 *          re-fetches with the new filter values.
 * LAYER: interfaces (client)
 * DEPENDENCIES: next/navigation
 * CONSUMED BY: app/admin/matches/page.tsx
 */
"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useState } from "react";

import type { AdminMatchStatus } from "@/src/match_lifecycle/composition";

const STATUS_OPTIONS: { value: AdminMatchStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "almostFull", label: "Almost full" },
  { value: "full", label: "Full" },
  { value: "inProgress", label: "In progress" },
  { value: "ended", label: "Ended" },
  { value: "cancelled", label: "Cancelled" },
];

interface AdminMatchesFiltersProps {
  readonly currentSearch: string;
  readonly currentStatus: AdminMatchStatus | undefined;
}

export function AdminMatchesFilters({
  currentSearch,
  currentStatus,
}: AdminMatchesFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(currentSearch);

  const apply = useCallback(
    (newQ: string, newStatus: string) => {
      const params = new URLSearchParams();
      if (newQ.trim()) params.set("q", newQ.trim());
      if (newStatus) params.set("status", newStatus);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname],
  );

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply(q, currentStatus ?? "");
        }}
        placeholder="Search venue or captain…"
        className="h-9 flex-1 rounded-lg border border-border bg-bg-base px-3 text-sm outline-none focus:border-primary"
      />
      <select
        value={currentStatus ?? ""}
        onChange={(e) => apply(q, e.target.value)}
        className="h-9 rounded-lg border border-border bg-bg-base px-2 text-sm outline-none focus:border-primary"
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
