/**
 * MODULE: app.admin.venues.admin-venues-filters
 * PURPOSE: Status filter for `/admin/venues` (all / active / inactive). Writes
 *          `?status=` into the URL via `router.replace` — the RSC re-renders
 *          the table from the new param.
 * LAYER: interfaces (client island)
 * DEPENDENCIES: next/navigation
 * CONSUMED BY: app/admin/venues/page.tsx
 * INVARIANTS:
 *   - `router.replace` (not push) — filter tweaks must not pollute history.
 *   - "all" removes the param entirely.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/venues" → Filter.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const SELECT_CLASS =
  "h-10 rounded-lg border-[1.5px] border-border bg-bg-card px-2 text-[13px] text-text-primary";

export function AdminVenuesFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function apply(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("status");
    else params.set("status", value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
        Status
        <select
          className={SELECT_CLASS}
          value={searchParams.get("status") ?? "all"}
          onChange={(e) => apply(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
    </div>
  );
}
