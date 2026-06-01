/**
 * MODULE: match_lifecycle.application.update-venue-service
 * PURPOSE: Use case — an admin edits a venue via `PATCH /api/admin/venues/:id`.
 *          Full-field overwrite (the modal is a complete form, no partial
 *          patch). Enforces the deactivation guard: a venue cannot flip
 *          active → inactive while it still has upcoming non-cancelled matches.
 * LAYER: application
 * DEPENDENCIES (ports): VenueRepository
 * CONSUMED BY: src/match_lifecycle/composition.ts →
 *              app/api/admin/venues/[id]/route.ts (PATCH)
 * INVARIANTS:
 *   - Admin-only — `requireAdmin()` gate at the route, not here.
 *   - Unknown id → `VenueNotFoundError` (404).
 *   - **Deactivation guard.** When the current row is `active` and the patch
 *     sets `active = false`, `countUpcomingNonCancelledAtVenue(id, now) > 0`
 *     → `VenueHasUpcomingMatchesError` (409) carrying the count. The form
 *     disables the toggle + blocks Save with the same count; this is the
 *     curl / stale-tab backstop (spec personal.md → "Guard against
 *     deactivation"). No advisory lock — the Venue aggregate has no concurrent
 *     mutators (admin edits are single-tab), same rationale as
 *     `UserRepository.updateProfile`.
 *   - `name` / `address` are NFC-normalised + trimmed here (the canonical
 *     site); structural caps enforced at the Zod boundary.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/venues"
 *   - docs/spec/pitchup-spec-global.md → "Field surface"
 */
import {
  VenueHasUpcomingMatchesError,
  VenueNotFoundError,
} from "../domain/errors";
import { asVenueId, type Surface, type Venue } from "../domain/venue";
import type { VenueRepository } from "../domain/venue-repository";
import type { UpdateVenueServiceInput } from "./dto/venue-input";

export class UpdateVenueService {
  constructor(private readonly venueRepository: VenueRepository) {}

  async execute(
    venueId: string,
    input: UpdateVenueServiceInput,
    now: Date,
  ): Promise<Venue> {
    const id = asVenueId(venueId);

    const existing = await this.venueRepository.findById(id);
    if (existing === null) {
      throw new VenueNotFoundError({ venueId });
    }

    // Deactivation guard — only when actually flipping active → inactive.
    if (existing.active && !input.active) {
      const upcomingMatchCount =
        await this.venueRepository.countUpcomingNonCancelledAtVenue(id, now);
      if (upcomingMatchCount > 0) {
        throw new VenueHasUpcomingMatchesError({ upcomingMatchCount });
      }
    }

    return this.venueRepository.update(id, {
      name: input.name.normalize("NFC").trim(),
      address: input.address.normalize("NFC").trim(),
      lat: input.lat,
      lng: input.lng,
      googleMapsUrl: input.googleMapsUrl,
      photoUrl: input.photoUrl,
      surface: input.surface as readonly Surface[],
      coverId: input.coverId,
      active: input.active,
    });
  }
}
