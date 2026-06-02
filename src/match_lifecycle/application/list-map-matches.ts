/**
 * MODULE: match_lifecycle.application.list-map-matches
 * PURPOSE: Use case for the `/map` page and `GET /api/matches/map` route
 *          handler. Fetches all non-cancelled, non-past matches within the
 *          21-day Prague horizon that pass the sheet filters, and decorates
 *          each row with canonical slot math + derived status. Only
 *          Open / AlmostFull / Full rows are surfaced (Cancelled / Ended are
 *          filtered out after status derivation).
 * LAYER: application
 * DEPENDENCIES: ../domain/*, ../../shared/time/prague, ./discover-filters
 * CONSUMED BY: src/match_lifecycle/composition.ts → app/api/matches/map/route.ts
 * INVARIANTS:
 *   - No pagination — the map renders all pins at once.
 *   - Status / slots are NEVER read from the DB; always computed here via the
 *     canonical formulas in slot-math.ts and match-status.ts.
 *   - Distance filter is silently dropped when `location` is null (same rule
 *     as ListDiscoverMatchesService; UI shows DistanceBanner when `?distance=`
 *     is in the URL but no location is saved).
 *   - Horizon = today_prague(now) through today_prague(now)+20, inclusive.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/map".
 */
import { addPragueDays, pragueDay, todayPrague } from "@/src/shared/time/prague";

import type { MatchId } from "../domain/match";
import type { DiscoverLocation, MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus, type MatchStatus } from "../domain/match-status";
import { computeSlots, type SlotInfo } from "../domain/slot-math";
import type { Surface, Venue, VenueId } from "../domain/venue";
import type { DiscoverFilters } from "./discover-filters";

export interface MapMatchView {
  readonly id: MatchId;
  readonly startTime: Date;
  readonly duration: number;
  readonly surface: Surface;
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly price: number;
  readonly coverId: string;
  readonly venue: Pick<Venue, "id" | "name" | "address" | "lat" | "lng" | "photoUrl">;
  readonly slots: SlotInfo;
  readonly status: MatchStatus;
}

export interface ListMapMatchesResult {
  readonly matches: readonly MapMatchView[];
}

export interface ListMapMatchesOptions {
  /** Sheet filters (date is ignored — map always shows the full horizon). */
  readonly filters: DiscoverFilters;
  readonly now?: Date;
  readonly location?: DiscoverLocation | null;
}

export class ListMapMatchesService {
  constructor(private readonly matches: MatchRepository) {}

  async execute(options: ListMapMatchesOptions): Promise<ListMapMatchesResult> {
    const now = options.now ?? new Date();
    const location = options.location ?? null;
    const filters = options.filters;

    // Horizon: today_prague(now) through today_prague(now)+20 (inclusive).
    const today = todayPrague(now);
    const lastDay = addPragueDays(today, 20);
    const horizonUtcEnd = pragueDay(lastDay).utcEnd;

    const result = await this.matches.findMapMatches({
      now,
      horizonUtcEnd,
      timeOfDay: filters.timeOfDay,
      gameSize: [...filters.gameSize],
      spotsLeft: filters.spotsLeft,
      freeOnly: filters.freeOnly,
      fieldBookedOnly: filters.fieldBookedOnly,
      venueSearch: filters.venueSearch,
      distanceKm: location ? filters.distanceKm : null,
      location,
    });

    const matches = result.rows
      .map((match): MapMatchView => {
        const slots = computeSlots(match, 0);
        const status = deriveMatchStatus(match, slots, now);
        return {
          id: match.id,
          startTime: match.startTime,
          duration: match.duration,
          surface: match.surface,
          studsAllowed: match.studsAllowed,
          fieldBooked: match.fieldBooked,
          price: match.price,
          coverId: match.coverId,
          venue: {
            id: match.venue.id as VenueId,
            name: match.venue.name,
            address: match.venue.address,
            lat: match.venue.lat,
            lng: match.venue.lng,
            photoUrl: match.venue.photoUrl,
          },
          slots,
          status,
        };
      })
      // Only show pins for live matches — same rule as /games.
      .filter((m) => m.status === "open" || m.status === "almostFull" || m.status === "full");

    return { matches };
  }
}
