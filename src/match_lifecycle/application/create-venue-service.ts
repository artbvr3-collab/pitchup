/**
 * MODULE: match_lifecycle.application.create-venue-service
 * PURPOSE: Use case — an admin adds a venue via `POST /api/admin/venues`.
 *          Generates the venue id app-side (so the deterministic cover default
 *          is reproducible), NFC-normalises the text fields, applies the cover
 *          default when the admin didn't pick one, and persists.
 * LAYER: application
 * DEPENDENCIES (ports): VenueRepository; ../domain/covers
 * CONSUMED BY: src/match_lifecycle/composition.ts →
 *              app/api/admin/venues/route.ts (POST)
 * INVARIANTS:
 *   - Admin-only — the `requireAdmin()` gate lives at the route, NOT here (the
 *     service is auth-agnostic, same as `CreateMatchService`). No audit row:
 *     venue CRUD is content management, not moderation (spec /admin/venues
 *     does not mandate `admin_actions`, unlike /admin/users).
 *   - The id is generated here (`crypto.randomUUID`) and passed to
 *     `repository.create` — overriding the DB's `gen_random_uuid()` default —
 *     so `defaultCoverIdForVenue(id)` can run before INSERT.
 *   - `name` / `address` are `.normalize('NFC').trim()` (spec global.md →
 *     "Text field validation"). Structural caps are enforced at the Zod
 *     boundary; this is the canonical normalisation site.
 *   - `coverId` defaults to `defaultCoverIdForVenue(id)` when absent.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/venues"
 *   - docs/spec/pitchup-spec-global.md → "Cover venue", "Field surface"
 */
import { defaultCoverIdForVenue } from "../domain/covers";
import type { Surface, Venue } from "../domain/venue";
import type { VenueRepository } from "../domain/venue-repository";
import type { CreateVenueServiceInput } from "./dto/venue-input";

export class CreateVenueService {
  constructor(private readonly venueRepository: VenueRepository) {}

  async execute(input: CreateVenueServiceInput): Promise<Venue> {
    const id = globalThis.crypto.randomUUID();
    const coverId = input.coverId ?? defaultCoverIdForVenue(id);

    return this.venueRepository.create({
      id,
      name: input.name.normalize("NFC").trim(),
      address: input.address.normalize("NFC").trim(),
      lat: input.lat,
      lng: input.lng,
      googleMapsUrl: input.googleMapsUrl,
      photoUrl: input.photoUrl,
      surface: input.surface as readonly Surface[],
      coverId,
      active: input.active,
    });
  }
}
