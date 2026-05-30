/**
 * MODULE: app.(public).map.venue-sheet
 * PURPOSE: Bottom-sheet that opens when the user taps a venue pin on the map.
 *          Shows all upcoming matches at that venue (sorted by start_time ASC).
 *          Tapping a MatchCard navigates to /matches/:id.
 * LAYER: interfaces (client)
 * DEPENDENCIES: src/ui/components/sheet, src/ui/components/match-card
 * INVARIANTS:
 *   - Sorted by startTime ASC (nearest match at the top — API guarantees).
 *   - Only Open / AlmostFull / Full matches are shown (API already filters).
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map" → "Pins".
 */
"use client";

import * as React from "react";

import { MatchCard } from "@/src/ui/components/match-card";
import { Sheet } from "@/src/ui/components/sheet";

import type { MapVenue } from "./map-view";

export interface VenueSheetProps {
  readonly venue: MapVenue | null;
  readonly onClose: () => void;
}

export function VenueSheet({ venue, onClose }: VenueSheetProps) {
  return (
    <Sheet open={venue !== null} onClose={onClose} ariaLabel={venue?.venueName ?? "Venue matches"}>
      {venue && (
        <div className="flex flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-[15px] font-semibold text-text-primary">{venue.venueName}</p>
              <p className="text-[12px] text-text-secondary">{venue.venueAddress}</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="text-[18px] text-text-secondary"
            >
              ✕
            </button>
          </header>
          <ul className="divide-y divide-border overflow-y-auto">
            {venue.matches.map((match) => (
              <li key={match.id}>
                <MatchCard
                  href={`/matches/${match.id}`}
                  venueName={venue.venueName}
                  venueAddress={venue.venueAddress}
                  startTime={new Date(match.startTime)}
                  duration={match.duration}
                  surface={match.surface as "grass" | "hard"}
                  studsAllowed={match.studsAllowed}
                  fieldBooked={match.fieldBooked}
                  price={match.price}
                  status={match.status}
                  slots={{
                    filled: match.slots.filled,
                    capacity: match.slots.capacity,
                    free: match.slots.free,
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
