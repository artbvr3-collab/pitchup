/**
 * MODULE: match_lifecycle.application.list-discover-matches
 * PURPOSE: Use case for the public Discover page (`/games`) and the
 *          `GET /api/matches/discover` route handler. Resolves the parsed
 *          filter DTO into a repository query (Prague-day → UTC window,
 *          distance-without-location guard), runs the page query, and
 *          decorates each row with canonical slot math + derived status.
 * LAYER: application
 * DEPENDENCIES: ../domain/*, ../../shared/time/prague, ./discover-filters
 * CONSUMED BY: src/match_lifecycle/composition.ts → app/(public)/games/page.tsx
 *              and app/api/matches/discover/route.ts
 * INVARIANTS:
 *   - Status / slots are NEVER read from the DB; always computed here so the
 *     canonical formulas in slot-math.ts and match-status.ts are the only
 *     source.
 *   - `acceptedSlots` is hardcoded to 0 until Layer 4 (JoinRequest) adds the
 *     accepted-requests query.
 *   - `distanceKm` is silently dropped when no `location` is provided (per
 *     spec: SSR ignores `?distance=` without location; UI shows a banner).
 *   - Returned `nextCursor` is an opaque DTO; the route handler/server
 *     component re-encodes via `encodeCursor()` before passing to the URL.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games".
 */
import { pragueDay } from "@/src/shared/time/prague";

import type { MatchId } from "../domain/match";
import type {
  DiscoverCursorInput,
  DiscoverLocation,
  MatchRepository,
} from "../domain/match-repository";
import { deriveMatchStatus, type MatchStatus } from "../domain/match-status";
import { computeSlots, type SlotInfo } from "../domain/slot-math";
import type { Surface, VenueId } from "../domain/venue";
import type { DiscoverFilters } from "./discover-filters";

export interface DiscoverMatchView {
  readonly id: MatchId;
  readonly startTime: Date;
  readonly duration: number;
  readonly surface: Surface;
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly price: number;
  readonly coverId: string;
  readonly venue: {
    readonly id: VenueId;
    readonly name: string;
    readonly address: string;
  };
  readonly slots: SlotInfo;
  readonly status: MatchStatus;
}

export interface DiscoverPage {
  readonly rows: readonly DiscoverMatchView[];
  readonly nextCursor: DiscoverCursorInput | null;
}

export interface ListDiscoverMatchesOptions {
  readonly filters: DiscoverFilters;
  /** Page size; spec default = 50. */
  readonly limit?: number;
  /** Injectable for tests; defaults to `new Date()` in production callers. */
  readonly now?: Date;
  /** Optional saved location for the distance filter (client localStorage). */
  readonly location?: DiscoverLocation | null;
}

export class ListDiscoverMatchesService {
  constructor(private readonly matches: MatchRepository) {}

  async execute(options: ListDiscoverMatchesOptions): Promise<DiscoverPage> {
    const now = options.now ?? new Date();
    const limit = options.limit ?? 50;
    const filters = options.filters;
    const location = options.location ?? null;
    const day = pragueDay(filters.date);

    const page = await this.matches.findDiscoverPage({
      now,
      dayUtcStart: day.utcStart,
      dayUtcEnd: day.utcEnd,
      limit,
      cursor: filters.cursor,
      timeOfDay: filters.timeOfDay,
      gameSize: [...filters.gameSize],
      spotsLeft: filters.spotsLeft,
      freeOnly: filters.freeOnly,
      fieldBookedOnly: filters.fieldBookedOnly,
      venueSearch: filters.venueSearch,
      // Drop distance filter when no location is saved (spec).
      distanceKm: location ? filters.distanceKm : null,
      location,
    });

    const rows = page.rows.map((match): DiscoverMatchView => {
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
          id: match.venue.id,
          name: match.venue.name,
          address: match.venue.address,
        },
        slots,
        status,
      };
    });

    return { rows, nextCursor: page.nextCursor };
  }
}
