/**
 * MODULE: match_lifecycle.domain.venue-repository
 * PURPOSE: Repository port for the Venue aggregate. Venues are admin-managed
 *          (Layer 9); match_lifecycle reads them when listing the Create-match
 *          venue picker and when validating + snapshotting `coverId` on
 *          `POST /api/matches`.
 * LAYER: domain
 * DEPENDENCIES: ./venue
 * CONSUMED BY: src/match_lifecycle/application/list-venues-service.ts,
 *              src/match_lifecycle/application/create-match-service.ts,
 *              src/match_lifecycle/infrastructure/prisma-venue-repository.ts
 * INVARIANTS:
 *   - `listActive()` returns only `active = true` venues, ordered by name
 *     (case-insensitive). The Create-match wizard depends on a stable order
 *     for the venue picker.
 *   - `findActiveById()` returns null when the venue does not exist OR when
 *     it is inactive. Callers distinguish (404 vs 409) via a separate
 *     `findById()` lookup if they need to — for Layer 3 they don't, since
 *     the wizard's picker only shows active venues and the only realistic
 *     race is admin deactivation between page load and submit (→ 409).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/new" → Step 1 → Venue
 *   - docs/spec/pitchup-spec-personal.md → "/admin/venues"
 */
import type { Venue, VenueId } from "./venue";

export interface VenueRepository {
  listActive(): Promise<readonly Venue[]>;
  findById(id: VenueId): Promise<Venue | null>;
}
