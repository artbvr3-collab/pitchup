/**
 * MODULE: app.(public).map.location-modal
 * PURPOSE: Location modal overlaid on the map. Three options:
 *          [📍 Use my location] — GPS via navigator.geolocation.
 *          [📌 Place on map] — activates pick-location mode (caller handles).
 *          [Cancel] — close without changes.
 *          Also shows Location status chip when location is set.
 * LAYER: interfaces (client)
 * DEPENDENCIES: none (pure UI)
 * INVARIANTS:
 *   - iOS hidden: Notification API exists in WKWebView but GPS is per-spec
 *     still available. Modal is NOT hidden on iOS — geolocation works there.
 *   - Denial hint shown inline; modal stays open.
 *   - Saves {lat, lng, source: 'gps'} to localStorage key 'pitchup.location'.
 *   - Pushes a history entry on open so browser Back closes the modal.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map" → "Location modal".
 */
"use client";

import * as React from "react";

import { Button } from "@/src/ui/components/button";
import { SAVED_LOCATION_KEY, type SavedLocation } from "@/src/ui/lib/saved-location";

export interface LocationModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onPickOnMap: () => void;
  readonly onLocationSaved: (location: SavedLocation) => void;
}

export function LocationModal({
  open,
  onClose,
  onPickOnMap,
  onLocationSaved,
}: LocationModalProps) {
  const [loading, setLoading] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);

  // Reset hint when modal opens/closes.
  React.useEffect(() => {
    if (!open) setHint(null);
  }, [open]);

  // Push a history entry when the modal opens so browser Back closes it.
  React.useEffect(() => {
    if (!open) return;
    history.pushState({ locationModal: true }, "");
    const handlePop = () => onClose();
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [open, onClose]);

  const handleUseGps = () => {
    if (!navigator.geolocation) {
      setHint("GPS is not available in your browser. Try Place on map instead.");
      return;
    }
    setLoading(true);
    setHint(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false);
        const location: SavedLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "gps",
        };
        try {
          localStorage.setItem(SAVED_LOCATION_KEY, JSON.stringify(location));
        } catch {
          // localStorage unavailable — proceed in-memory.
        }
        onLocationSaved(location);
        history.back(); // pop the modal entry
        onClose();
      },
      () => {
        setLoading(false);
        setHint("GPS blocked — try Place on map, or enable location in browser settings.");
      },
      { timeout: 10_000 },
    );
  };

  const handlePickOnMap = () => {
    history.back(); // pop modal entry; pick-location mode pushes its own
    onPickOnMap();
  };

  const handleCancel = () => {
    history.back();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Set your location"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleCancel}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-screen rounded-t-2xl bg-bg-base px-4 pb-8 pt-4 shadow-xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <h2 className="mb-4 text-[17px] font-semibold text-text-primary">
          Set your location
        </h2>
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={loading}
            onClick={handleUseGps}
            className="w-full"
          >
            {loading ? "Getting location…" : "📍 Use my location"}
          </Button>
          {hint && (
            <p className="text-[13px] text-destructive">{hint}</p>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={loading}
            onClick={handlePickOnMap}
            className="w-full"
          >
            📌 Place on map
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={loading}
            onClick={handleCancel}
            className="w-full text-text-secondary"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
