/**
 * MODULE: app.admin.users.admin-users-filters
 * PURPOSE: Search + admin + status filter controls for `/admin/users`. Writes
 *          the filter state into the URL (`?q=&admin=&status=`) via
 *          `router.replace` — the RSC re-renders the table from the new params.
 *          Search is debounced; the two selects apply immediately.
 * LAYER: interfaces (client island)
 * DEPENDENCIES: next/navigation, src/ui/components/input, src/ui/lib/cn
 * CONSUMED BY: app/admin/users/page.tsx
 * INVARIANTS:
 *   - `router.replace` (not push) — filter tweaks must not pollute history.
 *   - Empty / "all" values are removed from the query string entirely.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/users" → Search,
 *               Filters.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/src/ui/components/input";

const SELECT_CLASS =
  "h-10 rounded-lg border-[1.5px] border-border bg-bg-card px-2 text-[13px] text-text-primary";

export function AdminUsersFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build a new query string from the current params with one key overridden,
  // dropping empty / "all" values, and navigate (replace).
  function apply(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "" || value === "all") params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => apply("q", value.trim()), 300);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <Input
        type="search"
        placeholder="Search by name or email"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search users"
      />
      <div className="flex gap-2">
        <label className="flex flex-1 items-center gap-1.5 text-[12px] text-text-secondary">
          Admin
          <select
            className={SELECT_CLASS}
            value={searchParams.get("admin") ?? "all"}
            onChange={(e) => apply("admin", e.target.value)}
            aria-label="Filter by admin"
          >
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-1 items-center gap-1.5 text-[12px] text-text-secondary">
          Status
          <select
            className={SELECT_CLASS}
            value={searchParams.get("status") ?? "all"}
            onChange={(e) => apply("status", e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
          </select>
        </label>
      </div>
    </div>
  );
}
