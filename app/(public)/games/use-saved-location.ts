/**
 * MODULE: app.(public).games.use-saved-location
 * PURPOSE: Read the user's saved location from localStorage on the client.
 *          Hydration-safe (SSR returns `undefined` until the effect runs).
 *          The shared key + type are defined in src/ui/lib/saved-location.ts;
 *          this module re-exports them for backwards-compatibility and adds
 *          the React hook.
 * LAYER: interfaces (client hook)
 * INVARIANTS:
 *   - Returns `undefined` on first render (SSR + pre-effect), `null` if no
 *     entry, or `{lat,lng,source}` when present. Three states distinguished.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map" → "Geolocation".
 */
"use client";

import { useEffect, useState } from "react";

import {
  parseSavedLocation,
  SAVED_LOCATION_KEY,
  type SavedLocation,
  type SavedLocationState,
} from "@/src/ui/lib/saved-location";

// Re-export so existing callers (more-filters-sheet, distance-banner) don't break.
export { SAVED_LOCATION_KEY, type SavedLocation, type SavedLocationState };

export function useSavedLocation(): SavedLocationState {
  const [state, setState] = useState<SavedLocationState>(undefined);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_LOCATION_KEY);
      setState(parseSavedLocation(raw));
    } catch {
      setState(null);
    }
  }, []);

  return state;
}
