/**
 * MODULE: match_lifecycle.domain.match-repository
 * PURPOSE: Repository port for the Match aggregate. Domain owns the contract;
 *          infrastructure provides the Prisma-backed adapter.
 *          Layer 2 scope: read-only Discover. listUpcoming() returns matches
 *          starting from `now` onwards (Cancelled matches are excluded —
 *          public Discover hides them, per spec).
 * LAYER: domain
 * DEPENDENCIES: ./match
 * CONSUMED BY: src/match_lifecycle/application/*,
 *              src/match_lifecycle/infrastructure/prisma-match-repository.ts
 * INVARIANTS:
 *   - Sort order is `startTime ASC, id ASC` — stable for cursor pagination
 *     when filters arrive in Layer 2.5.
 *   - Cancelled matches (cancelledAt IS NOT NULL) are not returned by
 *     listUpcoming(). They surface only on the captain's "My matches > Past"
 *     view (Layer 6).
 *   - Past matches (startTime < now) are excluded from public Discover —
 *     they live only in personal views.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games",
 *               docs/ARCHITECTURE.md §8, ADR-0003.
 */
import type { MatchWithVenue } from "./match";

export interface ListUpcomingOptions {
  /** Reference time; matches with startTime < now are excluded. */
  readonly now: Date;
  /** Page size. Spec: 50. Defaults are caller-provided to keep this pure. */
  readonly limit: number;
}

export interface MatchRepository {
  listUpcoming(options: ListUpcomingOptions): Promise<readonly MatchWithVenue[]>;
}
