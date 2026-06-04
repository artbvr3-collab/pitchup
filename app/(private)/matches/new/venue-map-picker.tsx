/**
 * MODULE: app.(private).matches.new.venue-map-picker
 * PURPOSE: Embedded MapLibre venue picker — the "Map" mode of Step 1's venue
 *          field in the Create-Match wizard. Renders one pin per venue from the
 *          already-loaded `venues` array (no fetch); tapping a pin opens a
 *          preview card with a "Select" button that lifts the choice up via
 *          `onSelect`. The compact-card collapse + all selection side-effects
 *          live in the wizard (it passes its own `selectVenue` as `onSelect`).
 * LAYER: interfaces (client island)
 * DEPENDENCIES: maplibre-gl (runtime via dynamic import — never bundled into the
 *               wizard chunk; types only at module scope), src/ui/components/*,
 *               src/ui/lib/cover-style.
 * INVARIANTS:
 *   - MapLibre initialises only on mount (client-only). CSS imported here so it
 *     rides this lazily-loaded chunk, not the wizard's first-load CSS.
 *   - Loaded lazily by wizard.tsx via `next/dynamic(..., { ssr: false })`; this
 *     file is NEVER imported on the server.
 *   - One Marker per venue; the marker DOM element is kept alongside the Marker
 *     so the highlight effect restyles in place — markers are never recreated on
 *     selection/preview changes (no flicker, no dropped listeners).
 *   - Init guards an `alive` flag so an unmount mid-`import()` (React StrictMode
 *     double-invoke, rapid tab toggling) can't leak an orphan WebGL context.
 *   - fitBounds is skipped for 0/1 venues (degenerate bounds → bad zoom).
 *   - Attribution is disabled to match the existing /map surface.
 * RELATED DOCS: app/(public)/map/map-view.tsx (init/marker pattern, mirrored
 *               here with the cleanup race fixed).
 */
"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import * as React from "react";

import type { VenueView } from "@/src/match_lifecycle/application/list-venues-service";
import { Button } from "@/src/ui/components/button";
import { coverBackground, coverIcon } from "@/src/ui/lib/cover-style";

// ── Prague center default (mirrors map-view.tsx) ──
const PRAGUE_CENTER: [number, number] = [14.4378, 50.0755];
const DEFAULT_ZOOM = 12;

const PIN_ACTIVE_RING = "0 0 0 3px rgba(132,204,22,.45), 0 2px 6px rgba(0,0,0,.3)";
const PIN_REST_SHADOW = "0 2px 6px rgba(0,0,0,.3)";

export interface VenueMapPickerProps {
  readonly venues: readonly VenueView[];
  readonly selectedId: string | null;
  readonly onSelect: (v: VenueView) => void;
}

/** Center/zoom on first paint, guarding degenerate 0/1-venue bounds. */
function applyInitialView(map: MapLibreMap, venues: readonly VenueView[]) {
  const pts = venues.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  if (pts.length === 0) {
    map.jumpTo({ center: PRAGUE_CENTER, zoom: DEFAULT_ZOOM });
    return;
  }
  if (pts.length === 1) {
    map.jumpTo({ center: [pts[0]!.lng, pts[0]!.lat], zoom: 14 });
    return;
  }
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const v of pts) {
    minLng = Math.min(minLng, v.lng);
    maxLng = Math.max(maxLng, v.lng);
    minLat = Math.min(minLat, v.lat);
    maxLat = Math.max(maxLat, v.lat);
  }
  map.fitBounds(
    [[minLng, minLat], [maxLng, maxLat]],
    { padding: 48, maxZoom: 15, duration: 0 },
  );
}

export function VenueMapPicker({ venues, selectedId, onSelect }: VenueMapPickerProps) {
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markersRef = React.useRef<Map<string, { marker: Marker; el: HTMLSpanElement }>>(
    new Map(),
  );
  const [ready, setReady] = React.useState(false);
  const [previewId, setPreviewId] = React.useState<string | null>(null);

  const preview = React.useMemo(
    () => (previewId ? venues.find((v) => v.id === previewId) ?? null : null),
    [previewId, venues],
  );

  // ── Init MapLibre (alive-flag guards against unmount-mid-import leaks) ──
  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const markers = markersRef.current;
    let alive = true;
    let localMap: MapLibreMap | null = null;

    import("maplibre-gl").then(({ Map: MLMap }) => {
      if (!alive || !mapContainerRef.current) return; // unmounted before import resolved
      localMap = new MLMap({
        container: mapContainerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: PRAGUE_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
      });
      mapRef.current = localMap;
      // Tap empty map (not a pin) dismisses the preview card.
      localMap.on("click", () => setPreviewId(null));
      localMap.on("load", () => {
        if (!alive) return;
        localMap!.resize(); // belt-and-suspenders against a 0-size init
        applyInitialView(localMap!, venues);
        setReady(true);
      });
    });

    return () => {
      alive = false;
      // localMap and mapRef.current are the same instance — remove() exactly
      // once (a second remove() throws on the already-torn-down map).
      (mapRef.current ?? localMap)?.remove();
      mapRef.current = null;
      markers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keep the map sized to its (mobile, keyboard-prone) container ──
  React.useEffect(() => {
    const node = mapContainerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => mapRef.current?.resize());
    });
    ro.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // ── Render one marker per venue (once the style is loaded) ──
  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    for (const { marker } of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    let cancelled = false;
    import("maplibre-gl").then(({ Marker: MLMarker }) => {
      if (cancelled || !mapRef.current) return;
      for (const v of venues) {
        if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;

        // Root button is positioned by MapLibre (it owns `transform`), so the
        // circular visual lives in an inner span we can scale on highlight.
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `${v.name}, ${v.address}`);
        el.style.cssText = "width:36px;height:36px;padding:0;border:none;background:transparent;cursor:pointer;";

        const pin = document.createElement("span");
        pin.style.cssText = `
          display: block; width: 100%; height: 100%;
          border-radius: 50%;
          overflow: hidden;
          background: ${coverBackground(v.coverId)};
          border: 2px solid white;
          box-shadow: ${PIN_REST_SHADOW};
          transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
        `;
        // Show the venue photo in the circle; venues without a photo keep the
        // cover gradient as a plain coloured dot (no icon).
        if (v.photoUrl) {
          const img = document.createElement("img");
          img.src = v.photoUrl;
          img.alt = "";
          img.loading = "lazy";
          img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
          pin.appendChild(img);
        }
        el.appendChild(pin);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          setPreviewId(v.id);
          mapRef.current?.flyTo({
            center: [v.lng, v.lat],
            zoom: Math.max(mapRef.current.getZoom(), 14),
            offset: [0, -70], // lift the pin above the preview card
            duration: 350,
          });
        });

        const marker = new MLMarker({ element: el, anchor: "center" })
          .setLngLat([v.lng, v.lat])
          .addTo(mapRef.current);
        markersRef.current.set(v.id, { marker, el: pin });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ready, venues]);

  // ── Highlight selected/preview pins in place (no recreation) ──
  React.useEffect(() => {
    for (const [vid, { el }] of markersRef.current) {
      const active = vid === selectedId || vid === previewId;
      el.style.transform = active ? "scale(1.3)" : "scale(1)";
      el.style.borderColor = active ? "#84CC16" : "white"; // lime ring when active
      el.style.boxShadow = active ? PIN_ACTIVE_RING : PIN_REST_SHADOW;
      // Raise the active pin above its neighbours (z-index on the MapLibre root).
      if (el.parentElement) el.parentElement.style.zIndex = active ? "3" : "";
    }
  }, [previewId, selectedId, ready, venues]);

  return (
    <div className="relative h-[280px] w-full overflow-hidden rounded-card border border-border">
      <div ref={mapContainerRef} className="h-full w-full" />

      {preview && (
        <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-2.5 rounded-[14px] border border-border bg-bg-base p-2.5 shadow-card">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] text-[16px]"
            style={preview.photoUrl ? undefined : { background: coverBackground(preview.coverId) }}
          >
            {preview.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              coverIcon(preview.coverId)
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold leading-tight">{preview.name}</div>
            <div className="mt-0.5 truncate text-[12px] text-text-secondary">{preview.address}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {preview.surface.map((s) => (
                <span
                  key={s}
                  className="rounded-[4px] bg-bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary"
                >
                  {s === "grass" ? "Grass" : "Hard"}
                </span>
              ))}
            </div>
          </div>
          <Button
            variant="lime"
            onClick={() => onSelect(preview)}
            className="h-9 w-auto shrink-0 self-center px-4 text-[13px]"
          >
            Select
          </Button>
        </div>
      )}
    </div>
  );
}
