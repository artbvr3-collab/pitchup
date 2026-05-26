/**
 * MODULE: match_lifecycle.application.list-venues-service
 * PURPOSE: Lists all admin-active venues for the Create-match wizard's venue
 *          picker. Read-only, no auth check — venues are public data; the
 *          Server Component that wraps the wizard handles the captain gate.
 * LAYER: application
 * DEPENDENCIES (ports): VenueRepository
 * CONSUMED BY: app/(private)/matches/new/page.tsx (RSC),
 *              app/api/venues/route.ts (optional client refresh)
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "/matches/new" → Step 1.
 */
import type { Venue } from "../domain/venue";
import type { VenueRepository } from "../domain/venue-repository";

export interface VenueView {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly surface: readonly ("grass" | "hard")[];
  readonly coverId: string;
}

export class ListVenuesService {
  constructor(private readonly venueRepository: VenueRepository) {}

  async execute(): Promise<readonly VenueView[]> {
    const venues = await this.venueRepository.listActive();
    return venues.map(toView);
  }
}

function toView(venue: Venue): VenueView {
  return {
    id: venue.id,
    name: venue.name,
    address: venue.address,
    lat: venue.lat,
    lng: venue.lng,
    surface: venue.surface,
    coverId: venue.coverId,
  };
}
