/**
 * MODULE: app.(public).games.use-saved-location
 * PURPOSE: Read the user's saved location from localStorage on the client.
 *          Hydration-safe (SSR returns `undefined` until the effect runs).
 *          Layer 8 (`/map`) will be the place that *writes* this entry; for
 *          now Layer 2.5 only reads it so the Discover `distance` filter and
 *          its banner can react to whatever Layer 8 will eventually store.
 * LAYER: interfaces (client hook)
 * INVARIANTS:
 *   - Storage key: `pitchup.location` (single source — see Layer 8 plan).
 *   - Shape: `{ lat: number, lng: number, source: 'gps' | 'manual' }` per
 *     spec /map "Geolocation & location storage".
 *   - Returns `undefined` on first render (SSR + pre-effect), `null` if no
 *     entry, or `{lat,lng,source}` when present. Three states distinguished.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map" → "Geolocation".
 */
"use client";

import { useEffect, useState } from "react";

export const SAVED_LOCATION_KEY = "pitchup.location";

export interface SavedLocation {
  readonly lat: number;
  readonly lng: number;
  readonly source: "gps" | "manual";
}

export type SavedLocationState = SavedLocation | null | undefined;

export function useSavedLocation(): SavedLocationState {
  const [state, setState] = useState<SavedLocationState>(undefined);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_LOCATION_KEY);
      if (!raw) {
        setState(null);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<SavedLocation>;
      if (
        typeof parsed.lat === "number" &&
        typeof parsed.lng === "number" &&
        (parsed.source === "gps" || parsed.source === "manual")
      ) {
        setState({ lat: parsed.lat, lng: parsed.lng, source: parsed.source });
      } else {
        setState(null);
      }
    } catch {
      setState(null);
    }
  }, []);

  return state;
}
