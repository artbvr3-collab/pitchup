/**
 * MODULE: app.(public).games.distance-banner
 * PURPOSE: Inline banner shown when `?distance=` is set in the URL but no
 *          saved location exists in localStorage. The list renders as if the
 *          filter were absent (the SSR layer silently drops it); the banner
 *          gives the user a visible explanation + a way to fix it.
 * LAYER: interfaces (client island)
 * INVARIANTS:
 *   - Dismiss state is per-session memory only — not localStorage. Reappears
 *     on the next page load if the param is still in the URL and location
 *     is still unset (spec).
 *   - Renders nothing when `?distance` is absent or when a location is set.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games" → "States" →
 *               distance-ignored banner.
 */
"use client";

import Link from "next/link";
import * as React from "react";

import { useSavedLocation } from "./use-saved-location";

export interface DistanceBannerProps {
  readonly distanceFilterActive: boolean;
}

export function DistanceBanner(props: DistanceBannerProps) {
  const [dismissed, setDismissed] = React.useState(false);
  const savedLocation = useSavedLocation();

  if (!props.distanceFilterActive) return null;
  if (dismissed) return null;
  // While hydration runs we don't know — render nothing rather than flash a
  // stale banner.
  if (savedLocation === undefined) return null;
  if (savedLocation !== null) return null;

  return (
    <div className="mx-4 my-3 flex items-center gap-2 rounded-card border border-border bg-bg-card p-3 text-[12px] text-text-secondary">
      <span className="flex-1">
        Distance filter ignored — set your location to enable it.
      </span>
      <Link
        href="/map?pickLocation=true"
        className="shrink-0 rounded-chip border border-border-strong px-3 py-1 text-[12px] font-semibold text-green-dark"
      >
        Set location
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-[14px] text-text-secondary"
      >
        ×
      </button>
    </div>
  );
}
