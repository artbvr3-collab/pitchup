/**
 * MODULE: match_lifecycle.application.list-discover-matches
 * PURPOSE: Use case for the public Discover page (`/games`). Pulls upcoming
 *          matches from the repository and decorates each with the canonical
 *          slot math + derived status, returning a view model ready for the
 *          Server Component to render. Layer 2 scope is read-only and
 *          unfiltered — filters / cursor pagination land in Layer 2.5.
 * LAYER: application
 * DEPENDENCIES: ../domain/*
 * CONSUMED BY: src/match_lifecycle/composition.ts → app/(public)/games/page.tsx
 * INVARIANTS:
 *   - Status / slots are NEVER read from the DB; always computed here so a
 *     single canonical formula is enforced.
 *   - `acceptedSlots` is hardcoded to 0 until Layer 4 (JoinRequest) adds the
 *     accepted-requests query.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games".
 */
import type { MatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus, type MatchStatus } from "../domain/match-status";
import { computeSlots, type SlotInfo } from "../domain/slot-math";
import type { Surface, VenueId } from "../domain/venue";

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

export interface ListDiscoverMatchesOptions {
  readonly limit?: number;
  /** Injectable for tests; defaults to `new Date()` in production callers. */
  readonly now?: Date;
}

export class ListDiscoverMatchesService {
  constructor(private readonly matches: MatchRepository) {}

  async execute(
    options: ListDiscoverMatchesOptions = {},
  ): Promise<readonly DiscoverMatchView[]> {
    const now = options.now ?? new Date();
    const limit = options.limit ?? 50;

    const rows = await this.matches.listUpcoming({ now, limit });

    return rows.map((match): DiscoverMatchView => {
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
  }
}
