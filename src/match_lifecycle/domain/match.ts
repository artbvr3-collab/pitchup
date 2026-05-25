/**
 * MODULE: match_lifecycle.domain.match
 * PURPOSE: Match entity — persistence-shape, no derived fields. Status and
 *          slot counts are computed on-read (see match-status.ts, slot-math.ts);
 *          never store them.
 * LAYER: domain
 * DEPENDENCIES: ./venue (only for VenueId), src/auth/domain/user (UserId)
 * CONSUMED BY: src/match_lifecycle/domain/match-repository.ts,
 *              src/match_lifecycle/application/*, infrastructure adapters.
 * INVARIANTS:
 *   - `captainCrew` is NEVER null (default '[]'); `.length` is always safe.
 *   - `coverId` is a snapshot of the venue's coverId at INSERT time and is
 *     immutable thereafter — changing venue.coverId does not propagate here.
 *   - `cancelledAt !== null` ⇒ status is Cancelled regardless of time/slots.
 *   - `surface` is one of {grass, hard}; validated at app boundary, not DB.
 *   - `duration` is in minutes; ended-at = startTime + duration*60_000 ms.
 *   - `price` is in CZK (Kč), integer; 0 means free.
 *   - Match.captainId cannot also be in JoinRequests as joiner — enforced
 *     server-side at join time, not in this type (see spec match.md).
 * RELATED DOCS: docs/spec/pitchup-app-map.md → "Match",
 *               docs/spec/pitchup-spec-match.md → "Match states".
 */
import type { UserId } from "@/src/auth/domain/user";
import type { Surface, Venue, VenueId } from "./venue";

declare const matchIdBrand: unique symbol;
export type MatchId = string & { readonly [matchIdBrand]: void };

export interface Match {
  readonly id: MatchId;
  readonly captainId: UserId;
  readonly venueId: VenueId;
  readonly startTime: Date;
  readonly duration: number; // minutes
  readonly totalSpots: number;
  readonly price: number; // CZK, integer
  readonly surface: Surface;
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly description: string | null;
  readonly descriptionHidden: boolean;
  readonly captainCrew: readonly string[];
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly cancelReasonHidden: boolean;
  readonly coverId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Read-model returned by Discover queries. The venue join is mandatory for
 * any list/detail rendering — keeping it as a separate type forces callers
 * to ask for it explicitly and lets the bare Match interface stay pure.
 */
export interface MatchWithVenue extends Match {
  readonly venue: Venue;
}

export const asMatchId = (value: string): MatchId => value as MatchId;
