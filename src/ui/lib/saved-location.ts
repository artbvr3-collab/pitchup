/**
 * MODULE: ui.lib.saved-location
 * PURPOSE: Shared localStorage key + type for the user's saved location.
 *          Used by both the /games use-saved-location hook and the /map
 *          location modal writer. Single source of truth for the key name
 *          and the data shape.
 * LAYER: ui
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map" → "Geolocation".
 */
export const SAVED_LOCATION_KEY = "pitchup.location";

export interface SavedLocation {
  readonly lat: number;
  readonly lng: number;
  readonly source: "gps" | "manual";
}

export type SavedLocationState = SavedLocation | null | undefined;

export function parseSavedLocation(raw: string | null): SavedLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedLocation>;
    if (
      typeof parsed.lat === "number" &&
      typeof parsed.lng === "number" &&
      (parsed.source === "gps" || parsed.source === "manual")
    ) {
      return { lat: parsed.lat, lng: parsed.lng, source: parsed.source };
    }
  } catch {
    // malformed JSON
  }
  return null;
}
