/**
 * MODULE: app.(public).map.map-view
 * PURPOSE: Full-screen client island for `/map`. Renders the MapLibre GL map,
 *          venue pins, sticky filter bar, info-chip strip, location button,
 *          and orchestrates the Location modal + Pick-location mode.
 *          Fetches `GET /api/matches/map` on mount and on filter/location
 *          changes. Groups matches by venue for pin rendering.
 * LAYER: interfaces (client island)
 * DEPENDENCIES: maplibre-gl, next/navigation, ./location-modal, ./venue-sheet,
 *               app/(public)/games/filter-bar, app/(public)/games/more-filters-sheet,
 *               src/ui/lib/saved-location
 * INVARIANTS:
 *   - MapLibre initialises only on mount (no SSR). CSS imported here.
 *   - Each venue renders one Marker. Pin number = free slots of the nearest
 *     upcoming match at that venue; red background = that match is Full.
 *   - Tapping a pin opens the VenueSheet (not navigates).
 *   - ?pickLocation=true → autoOpenLocationModal prop → Location modal opens.
 *   - Pick-location mode: map pans freely; a fixed crosshair in the center;
 *     [Use this location] captures map.getCenter() and saves to localStorage.
 *   - Sheet filters update the URL (router.replace) and re-fetch the API.
 *   - "Next" info chip shows the earliest startTime across all visible matches.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map".
 */
"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import type { MatchStatus } from "@/src/match_lifecycle/domain/match-status";
import { FilterBar } from "@/app/(public)/games/filter-bar";
import {
  MoreFiltersSheet,
  type SheetAppliedState,
} from "@/app/(public)/games/more-filters-sheet";
import { parseSavedLocation, SAVED_LOCATION_KEY, type SavedLocation } from "@/src/ui/lib/saved-location";

import { LocationModal } from "./location-modal";
import { VenueSheet } from "./venue-sheet";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MapMatch {
  readonly id: string;
  readonly startTime: string; // ISO
  readonly duration: number;
  readonly surface: string;
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly price: number;
  readonly coverId: string;
  readonly slots: { readonly filled: number; readonly capacity: number; readonly free: number };
  readonly status: MatchStatus;
}

export interface MapVenue {
  readonly venueId: string;
  readonly venueName: string;
  readonly venueAddress: string;
  readonly venuePhotoUrl: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly matches: readonly MapMatch[];
}

interface SheetFilterState {
  distanceKm: SheetAppliedState["distanceKm"];
  timeOfDay: SheetAppliedState["timeOfDay"];
  gameSize: SheetAppliedState["gameSize"];
  spotsLeft: SheetAppliedState["spotsLeft"];
  freeOnly: boolean;
  fieldBookedOnly: boolean;
}

export interface MapViewProps {
  readonly initialFilters: SheetFilterState;
  readonly autoOpenLocationModal: boolean;
}

// ── Prague center default ────────────────────────────────────────────────────
const PRAGUE_CENTER: [number, number] = [14.4378, 50.0755];
const DEFAULT_ZOOM = 12;

// ── Status colours ──────────────────────────────────────────────────────────
const PIN_BG: Record<MatchStatus, string> = {
  open: "#0E5C2F",
  almostFull: "#D97706",
  full: "#DC2626",
  inProgress: "#6B7280",
  ended: "#6B7280",
  cancelled: "#6B7280",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNextChip(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  // Use Prague TZ formatting.
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hour12: false };
  const todayStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const matchStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const timeStr = new Intl.DateTimeFormat("en-GB", opts).format(d);
  if (todayStr === matchStr) return `Next ${timeStr}`;
  const dayStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", weekday: "short", day: "numeric", month: "short" }).format(d);
  return `Next ${dayStr}, ${timeStr}`;
}

function buildApiUrl(
  filters: SheetFilterState,
  location: SavedLocation | null,
  search: string,
): string {
  const params = new URLSearchParams();
  if (filters.distanceKm !== null) params.set("distance", String(filters.distanceKm));
  if (filters.timeOfDay.length > 0) params.set("time", filters.timeOfDay.join(","));
  if (filters.gameSize.length > 0) params.set("size", filters.gameSize.map(String).join(","));
  if (filters.spotsLeft !== null) params.set("spots", filters.spotsLeft);
  if (filters.freeOnly) params.set("free", "1");
  if (filters.fieldBookedOnly) params.set("booked", "1");
  if (search.trim()) params.set("q", search.trim());
  if (location && filters.distanceKm !== null) {
    params.set("lat", String(location.lat));
    params.set("lng", String(location.lng));
  }
  const qs = params.toString();
  return qs ? `/api/matches/map?${qs}` : "/api/matches/map";
}

// ── Component ────────────────────────────────────────────────────────────────

export function MapView({ initialFilters, autoOpenLocationModal }: MapViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markersRef = React.useRef<Map<string, Marker>>(new Map());

  const [venues, setVenues] = React.useState<readonly MapVenue[]>([]);
  const [fetchError, setFetchError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const [selectedVenue, setSelectedVenue] = React.useState<MapVenue | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [locationModalOpen, setLocationModalOpen] = React.useState(autoOpenLocationModal);
  const [pickMode, setPickMode] = React.useState(false);

  // Saved location state (mirrors useSavedLocation but writable).
  const [savedLocation, setSavedLocation] = React.useState<SavedLocation | null>(null);
  React.useEffect(() => {
    try {
      setSavedLocation(parseSavedLocation(localStorage.getItem(SAVED_LOCATION_KEY)));
    } catch {
      setSavedLocation(null);
    }
  }, []);

  const [search, setSearch] = React.useState("");
  const [appliedFilters, setAppliedFilters] = React.useState<SheetFilterState>(initialFilters);

  const hasActiveFilters =
    appliedFilters.distanceKm !== null ||
    appliedFilters.timeOfDay.length > 0 ||
    appliedFilters.gameSize.length > 0 ||
    appliedFilters.spotsLeft !== null ||
    appliedFilters.freeOnly ||
    appliedFilters.fieldBookedOnly;

  // ── Read filters from URL (after MoreFiltersSheet Apply) ──
  React.useEffect(() => {
    const dist = searchParams.get("distance");
    const time = searchParams.get("time");
    const size = searchParams.get("size");
    const spots = searchParams.get("spots");
    setAppliedFilters({
      distanceKm: dist ? (Number(dist) as SheetFilterState["distanceKm"]) : null,
      timeOfDay: time ? (time.split(",") as SheetAppliedState["timeOfDay"]) : [],
      gameSize: size ? size.split(",").map(Number) : [],
      spotsLeft: spots as SheetAppliedState["spotsLeft"] ?? null,
      freeOnly: searchParams.get("free") === "1",
      fieldBookedOnly: searchParams.get("booked") === "1",
    });
  }, [searchParams]);

  // ── Fetch map data ──
  React.useEffect(() => {
    const url = buildApiUrl(appliedFilters, savedLocation, search);
    const controller = new AbortController();
    setLoading(true);
    setFetchError(false);

    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { venues: MapVenue[] }) => {
        setVenues(data.venues);
        setLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          setFetchError(true);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [appliedFilters, savedLocation, search]);

  // ── Init MapLibre ──
  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let map: MapLibreMap;
    // Dynamic import to avoid SSR issues.
    import("maplibre-gl").then(({ Map: MLMap }) => {
      map = new MLMap({
        container: mapContainerRef.current!,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: savedLocation
          ? [savedLocation.lng, savedLocation.lat]
          : PRAGUE_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
      });
      mapRef.current = map;
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render pins ──
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Wait until style is loaded.
    const renderPins = () => {
      // Remove stale markers.
      for (const [vid, marker] of markersRef.current) {
        if (!venues.find((v) => v.venueId === vid)) {
          marker.remove();
          markersRef.current.delete(vid);
        }
      }

      for (const venue of venues) {
        // Nearest match = first in sorted list (API returns ASC).
        const nearest = venue.matches[0];
        if (!nearest) continue;

        const freeSlots = nearest.slots.free;
        const isFull = nearest.status === "full";
        const bg = PIN_BG[nearest.status] ?? "#0E5C2F";

        const el = document.createElement("button");
        el.setAttribute("type", "button");
        el.setAttribute("aria-label", `${venue.venueName} — ${freeSlots} free spot${freeSlots !== 1 ? "s" : ""}`);
        el.style.cssText = `
          width: 36px; height: 36px;
          border-radius: 50%;
          background: ${bg};
          color: white;
          font-size: 14px;
          font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,.3);
          cursor: pointer;
        `;
        el.textContent = isFull ? "✕" : String(freeSlots);
        el.addEventListener("click", () => {
          setSelectedVenue(venue);
        });

        const existing = markersRef.current.get(venue.venueId);
        if (existing) {
          existing.remove();
        }

        import("maplibre-gl").then(({ Marker }) => {
          const marker = new Marker({ element: el, anchor: "center" })
            .setLngLat([venue.lng, venue.lat])
            .addTo(map);
          markersRef.current.set(venue.venueId, marker);
        });
      }
    };

    if (map.isStyleLoaded()) {
      renderPins();
    } else {
      map.once("load", renderPins);
    }
  }, [venues]);

  // ── Chip tap: fly to nearest match ──
  const nextMatch = React.useMemo<{ venueId: string; match: MapMatch } | null>(() => {
    let earliest: { venueId: string; match: MapMatch } | null = null;
    for (const venue of venues) {
      const first = venue.matches[0];
      if (!first) continue;
      if (!earliest || first.startTime < earliest.match.startTime) {
        earliest = { venueId: venue.venueId, match: first };
      }
    }
    return earliest;
  }, [venues]);

  const handleChipTap = () => {
    if (!nextMatch) return;
    const venue = venues.find((v) => v.venueId === nextMatch.venueId);
    if (!venue) return;
    mapRef.current?.flyTo({ center: [venue.lng, venue.lat], zoom: 15, duration: 300 });
    setSelectedVenue(venue);
  };

  // ── Location modal / pick-mode ──
  const handleLocationSaved = (loc: SavedLocation) => {
    setSavedLocation(loc);
    // Re-center map.
    mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 14 });
  };

  const handleLocationBtn = () => {
    if (savedLocation) {
      mapRef.current?.flyTo({ center: [savedLocation.lng, savedLocation.lat], zoom: 14 });
    } else {
      setLocationModalOpen(true);
    }
  };

  const handlePickOnMap = () => {
    setLocationModalOpen(false);
    // Push history entry for pick-location mode.
    history.pushState({ pickMode: true }, "");
    setPickMode(true);

    const handlePop = (e: PopStateEvent) => {
      if ((e.state as { pickMode?: boolean } | null)?.pickMode !== true) {
        setPickMode(false);
        window.removeEventListener("popstate", handlePop);
      }
    };
    window.addEventListener("popstate", handlePop);
  };

  const handleUseThisLocation = () => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    const loc: SavedLocation = { lat: center.lat, lng: center.lng, source: "manual" };
    try {
      localStorage.setItem(SAVED_LOCATION_KEY, JSON.stringify(loc));
    } catch {
      // ignore
    }
    setSavedLocation(loc);
    history.back(); // pop pick-mode entry
    setPickMode(false);
  };

  const handlePickCancel = () => {
    history.back();
    setPickMode(false);
  };

  const sheetApplied: SheetAppliedState = {
    distanceKm: appliedFilters.distanceKm,
    timeOfDay: appliedFilters.timeOfDay as SheetAppliedState["timeOfDay"],
    gameSize: appliedFilters.gameSize,
    spotsLeft: appliedFilters.spotsLeft,
    freeOnly: appliedFilters.freeOnly,
    fieldBookedOnly: appliedFilters.fieldBookedOnly,
  };

  return (
    // h-12 SignedInChrome header + h-14 BottomNav = 104px reserved chrome.
    // The chrome only renders for signed-in users on this public route; for
    // guests the header is absent, but reserving 48px there just trims 48px
    // of map (no visible bug) instead of having the map spill 48px under the
    // nav for signed-in users.
    <div className="relative flex flex-col" style={{ height: "calc(100dvh - 104px)" }}>
      {/* Map container — MapLibre forces position:relative on init, so use
          explicit h-full/w-full instead of absolute+inset-0 (which would
          require position:absolute to size). */}
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Overlay UI (above map) */}
      {!pickMode && (
        <>
          {/* Sticky top controls */}
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex flex-col">
            <div className="pointer-events-auto bg-bg-base/95 backdrop-blur-sm">
              <FilterBar
                initialSearch={search}
                hasActiveFilters={hasActiveFilters}
                onSearchChange={setSearch}
                onOpenFilters={() => setSheetOpen(true)}
              />
            </div>

            {/* Info chip strip */}
            {nextMatch && (
              <div className="pointer-events-auto flex px-4 pb-2 pt-0">
                <button
                  type="button"
                  onClick={handleChipTap}
                  className="flex items-center gap-1 rounded-full bg-bg-base px-3 py-1 text-[13px] font-medium text-text-primary shadow-md ring-1 ring-border"
                >
                  <span>⏰</span>
                  <span>{formatNextChip(nextMatch.match.startTime)}</span>
                </button>
              </div>
            )}
          </div>

          {/* Empty state overlays */}
          {!loading && venues.length === 0 && (
            <div className="pointer-events-auto absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-bg-base p-5 text-center shadow-lg">
              {fetchError ? (
                <p className="text-[14px] text-text-secondary">Could not load matches. Pull down to retry.</p>
              ) : hasActiveFilters ? (
                <>
                  <p className="mb-2 text-[14px] text-text-primary">No matches match your filters.</p>
                  <Link
                    href="/map"
                    className="text-[13px] font-semibold text-green-dark"
                    onClick={() => router.replace("/map")}
                  >
                    Reset filters
                  </Link>
                </>
              ) : (
                <p className="text-[14px] text-text-secondary">No upcoming matches.</p>
              )}
            </div>
          )}

          {/* Bottom-right: My location button + status chip */}
          <div className="pointer-events-auto absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
            {savedLocation && (
              <button
                type="button"
                onClick={() => setLocationModalOpen(true)}
                className="rounded-full bg-bg-base px-3 py-1 text-[12px] font-medium text-text-secondary shadow ring-1 ring-border"
                aria-label="Location source"
              >
                {savedLocation.source === "gps" ? "📍 GPS" : "📌 Manual"}
              </button>
            )}
            <button
              type="button"
              onClick={handleLocationBtn}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-base text-[22px] shadow-md ring-1 ring-border"
              aria-label="My location"
            >
              📍
            </button>
          </div>
        </>
      )}

      {/* Pick-location mode overlay */}
      {pickMode && (
        <>
          {/* Banner */}
          <div className="pointer-events-auto absolute left-0 right-0 top-0 z-10 bg-green-dark/90 py-2 text-center text-[13px] font-medium text-white">
            Pan to your area, then confirm
          </div>
          {/* Fixed crosshair */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-[32px]">
            ✛
          </div>
          {/* Footer */}
          <div className="pointer-events-auto absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-2 bg-bg-base p-4">
            <button
              type="button"
              onClick={handleUseThisLocation}
              className="h-12 w-full rounded-btn bg-green-dark text-[15px] font-semibold text-white shadow-btn"
            >
              📍 Use this location
            </button>
            <button
              type="button"
              onClick={handlePickCancel}
              className="h-10 w-full text-[14px] font-medium text-text-secondary"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Location modal */}
      <LocationModal
        open={locationModalOpen}
        onClose={() => setLocationModalOpen(false)}
        onPickOnMap={handlePickOnMap}
        onLocationSaved={handleLocationSaved}
      />

      {/* Venue sheet */}
      <VenueSheet venue={selectedVenue} onClose={() => setSelectedVenue(null)} />

      {/* More-filters sheet (reused from /games, pathname-aware) */}
      <MoreFiltersSheet
        open={sheetOpen}
        applied={sheetApplied}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
