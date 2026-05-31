/**
 * MODULE: app.(public).games.discover-shell
 * PURPOSE: Top-level client island for `/games`. Holds the rendered rows +
 *          cursor as state (seeded from SSR), runs ephemeral venue-name
 *          search, and fires the client fetch to
 *          `GET /api/matches/discover` for "Show more" and for live search.
 *          Hosts the sticky FilterBar + DayPicker, the MoreFiltersSheet,
 *          and the empty / distance-banner / list layout.
 * LAYER: interfaces (client island)
 * DEPENDENCIES: ./filter-bar, ./day-picker, ./more-filters-sheet,
 *               ./distance-banner, ./use-saved-location, src/ui/components/*
 * INVARIANTS:
 *   - SSR rendered the first page with the **applied** URL filters; client
 *     state is initialized from that. Any URL filter change (day, sheet
 *     Apply) goes through router.replace and re-runs the Server Component
 *     for the first page — the shell re-mounts via the `key` prop.
 *   - Search and Show more do NOT touch the URL; they re-fetch in-place via
 *     the API and replace/append `rows`.
 *   - When the saved location is available, it's appended as `lat&lng` on
 *     API fetches so the distance filter actually applies; SSR can't see
 *     it (localStorage is client-only).
 *   - On filter Apply or day change the cursor is reset; on search change
 *     the cursor is reset too (handled by the fetch shape — search re-issues
 *     the page-1 query).
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games".
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/src/ui/components/button";
import { MatchCard } from "@/src/ui/components/match-card";

import { DayPicker } from "./day-picker";
import { DistanceBanner } from "./distance-banner";
import type { DiscoverInitialState, DiscoverRow } from "./discover-types";
import { FilterBar } from "./filter-bar";
import { MoreFiltersSheet, type SheetAppliedState } from "./more-filters-sheet";
import { useSavedLocation } from "./use-saved-location";

export interface DiscoverShellProps {
  readonly initial: DiscoverInitialState;
}

interface ListState {
  readonly rows: readonly DiscoverRow[];
  readonly nextCursor: string | null;
  readonly status: "idle" | "loading" | "error";
}

const longDayLabel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
});

function dayLabel(date: string, today: string): string {
  if (date === today) return "today";
  const [ty, tm, td] = today.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  const diff = Math.round(
    (Date.UTC(y!, m! - 1, d!) - Date.UTC(ty!, tm! - 1, td!)) / 86_400_000,
  );
  if (diff === 1) return "tomorrow";
  return `on ${longDayLabel.format(new Date(Date.UTC(y!, m! - 1, d!)))}`;
}

export function DiscoverShell(props: DiscoverShellProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [list, setList] = React.useState<ListState>({
    rows: props.initial.page.rows,
    nextCursor: props.initial.page.nextCursor,
    status: "idle",
  });
  const savedLocation = useSavedLocation();

  // Track if user typed a search since mount — drives whether we trust SSR
  // rows or refetched rows.
  const searchActive = search.trim().length > 0;
  const applied: SheetAppliedState = {
    distanceKm: props.initial.distanceKm,
    timeOfDay: props.initial.timeOfDay,
    gameSize: props.initial.gameSize,
    spotsLeft: props.initial.spotsLeft,
    freeOnly: props.initial.freeOnly,
    fieldBookedOnly: props.initial.fieldBookedOnly,
  };
  const hasActiveFilters =
    applied.distanceKm !== null ||
    applied.timeOfDay.length > 0 ||
    applied.gameSize.length > 0 ||
    applied.spotsLeft !== null ||
    applied.freeOnly ||
    applied.fieldBookedOnly;

  const buildBaseParams = React.useCallback(
    (q: string): URLSearchParams => {
      const params = new URLSearchParams();
      params.set("date", props.initial.date);
      if (applied.distanceKm !== null)
        params.set("distance", String(applied.distanceKm));
      if (applied.timeOfDay.length > 0)
        params.set("time", applied.timeOfDay.join(","));
      if (applied.gameSize.length > 0)
        params.set("size", applied.gameSize.join(","));
      if (applied.spotsLeft !== null) params.set("spots", applied.spotsLeft);
      if (applied.freeOnly) params.set("free", "1");
      if (applied.fieldBookedOnly) params.set("booked", "1");
      if (q) params.set("q", q);
      if (savedLocation) {
        params.set("lat", String(savedLocation.lat));
        params.set("lng", String(savedLocation.lng));
      }
      return params;
    },
    [
      applied.distanceKm,
      applied.fieldBookedOnly,
      applied.freeOnly,
      applied.gameSize,
      applied.spotsLeft,
      applied.timeOfDay,
      props.initial.date,
      savedLocation,
    ],
  );

  const fetchPage = React.useCallback(
    async (q: string, cursor: string | null): Promise<void> => {
      const params = buildBaseParams(q);
      if (cursor) params.set("cursor", cursor);
      setList((prev) => ({ ...prev, status: "loading" }));
      try {
        const res = await fetch(`/api/matches/discover?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          rows: DiscoverRow[];
          nextCursor: string | null;
        };
        setList((prev) => ({
          rows: cursor ? [...prev.rows, ...data.rows] : data.rows,
          nextCursor: data.nextCursor,
          status: "idle",
        }));
      } catch {
        setList((prev) => ({ ...prev, status: "error" }));
      }
    },
    [buildBaseParams],
  );

  // Re-issue page-1 when search text changes (debounced upstream in
  // FilterBar). Skip on initial mount when search is empty — SSR is fine.
  const lastSearchRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (lastSearchRef.current === null && search === "") {
      lastSearchRef.current = "";
      return;
    }
    if (lastSearchRef.current === search) return;
    lastSearchRef.current = search;
    void fetchPage(search.trim(), null);
  }, [search, fetchPage]);

  // If a saved location appears after mount AND the URL has ?distance=, the
  // SSR result was rendered with the filter dropped. Refetch once to apply
  // it. Only fire when search is empty (active search will trigger its own
  // fetch with lat/lng already included).
  const distanceFilterActive = applied.distanceKm !== null;
  const locationJustApplied = React.useRef(false);
  React.useEffect(() => {
    if (!distanceFilterActive) return;
    if (savedLocation === undefined || savedLocation === null) return;
    if (searchActive) return;
    if (locationJustApplied.current) return;
    locationJustApplied.current = true;
    void fetchPage("", null);
  }, [distanceFilterActive, savedLocation, searchActive, fetchPage]);

  const clearAllFilters = (): void => {
    const params = new URLSearchParams();
    params.set("date", props.initial.date);
    router.replace(`/games?${params.toString()}`, { scroll: false });
  };

  const matchCount = list.rows.length;
  const headerCount = (() => {
    if (list.status === "loading" && list.rows.length === 0) return "Loading…";
    const label = dayLabel(props.initial.date, props.initial.today);
    if (matchCount === 0) return null;
    return `${matchCount}${list.nextCursor ? "+" : ""} ${matchCount === 1 ? "match" : "matches"} ${label}`;
  })();

  return (
    <>
      <div className="sticky top-0 z-30 bg-bg-base">
        <FilterBar
          initialSearch={search}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={setSearch}
          onOpenFilters={() => setSheetOpen(true)}
        />
        <DayPicker
          value={props.initial.date}
          today={props.initial.today}
          horizon={props.initial.horizonDates}
        />
      </div>

      <DistanceBanner distanceFilterActive={distanceFilterActive} />

      <main className="px-4 pb-8">
        {headerCount !== null && (
          <p className="py-3 text-[12px] text-text-secondary">{headerCount}</p>
        )}

        {list.rows.length === 0 && list.status !== "loading" ? (
          <EmptyState
            date={props.initial.date}
            today={props.initial.today}
            showClearAll={hasActiveFilters || searchActive}
            onClearAll={() => {
              if (searchActive) setSearch("");
              if (hasActiveFilters) clearAllFilters();
            }}
          />
        ) : (
          <ul className="space-y-3">
            {list.rows.map((row) => (
              <li key={row.id}>
                <MatchCard
                  href={`/matches/${row.id}`}
                  coverId={row.coverId}
                  venueName={row.venue.name}
                  venueAddress={row.venue.address}
                  startTime={new Date(row.startTime)}
                  duration={row.duration}
                  surface={row.surface}
                  studsAllowed={row.studsAllowed}
                  fieldBooked={row.fieldBooked}
                  price={row.price}
                  status={row.status}
                  slots={{
                    filled: row.slots.filled,
                    capacity: row.slots.capacity,
                    free: row.slots.free,
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {list.nextCursor && (
          <div className="pt-4">
            <Button
              variant="ghost"
              type="button"
              disabled={list.status === "loading"}
              onClick={() => fetchPage(search.trim(), list.nextCursor)}
            >
              {list.status === "loading" ? "Loading…" : "Show more"}
            </Button>
          </div>
        )}

        {list.status === "error" && (
          <p className="pt-3 text-center text-[12px] text-destructive">
            Couldn’t load. Tap Show more to retry.
          </p>
        )}
      </main>

      <MoreFiltersSheet
        open={sheetOpen}
        applied={applied}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

function EmptyState(props: {
  date: string;
  today: string;
  showClearAll: boolean;
  onClearAll: () => void;
}) {
  const label = (() => {
    if (props.date === props.today) return "today";
    const [ty, tm, td] = props.today.split("-").map(Number);
    const [y, m, d] = props.date.split("-").map(Number);
    const diff = Math.round(
      (Date.UTC(y!, m! - 1, d!) - Date.UTC(ty!, tm! - 1, td!)) / 86_400_000,
    );
    if (diff === 1) return "tomorrow";
    return longDayLabel.format(new Date(Date.UTC(y!, m! - 1, d!)));
  })();
  return (
    <div className="space-y-3 rounded-card border border-border bg-bg-card p-6 text-center">
      <p className="text-[14px] text-text-primary">
        No matches {label === "today" || label === "tomorrow" ? label : `on ${label}`}.
      </p>
      <p className="text-[12px] text-text-secondary">Try another day →</p>
      <div className="flex flex-col gap-2 pt-2">
        <Link
          href="/matches/new"
          className="inline-flex h-12 w-full items-center justify-center rounded-btn bg-green-dark text-[15px] font-semibold text-text-inverted shadow-btn"
        >
          + New match
        </Link>
        {props.showClearAll && (
          <button
            type="button"
            onClick={props.onClearAll}
            className="text-[12px] font-semibold text-green-dark hover:underline"
          >
            Clear all filters
          </button>
        )}
      </div>
    </div>
  );
}
