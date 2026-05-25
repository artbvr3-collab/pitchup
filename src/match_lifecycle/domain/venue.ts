/**
 * MODULE: match_lifecycle.domain.venue
 * PURPOSE: Venue value object — physical pitch where matches are played.
 *          Read-only from match_lifecycle's perspective in Layer 2 (Discover);
 *          admin-managed elsewhere (Layer 9).
 * LAYER: domain
 * DEPENDENCIES: none
 * CONSUMED BY: src/match_lifecycle/domain/match-repository.ts,
 *              src/match_lifecycle/application/*, infrastructure adapters.
 * INVARIANTS:
 *   - `surface` is a non-empty subset of {grass, hard}; a venue may offer both.
 *   - `lat` / `lng` are WGS84 decimal degrees; required for Haversine distance.
 *   - `active === false` hides venue from new-match creation but does not
 *     affect existing matches.
 * RELATED DOCS: docs/spec/pitchup-app-map.md → "Venue",
 *               docs/spec/pitchup-spec-global.md → "Field surface", "Cover venue".
 */

declare const venueIdBrand: unique symbol;
export type VenueId = string & { readonly [venueIdBrand]: void };

export type Surface = "grass" | "hard";

export interface Venue {
  readonly id: VenueId;
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly googleMapsUrl: string | null;
  readonly surface: readonly Surface[];
  readonly coverId: string;
  readonly active: boolean;
}

export const asVenueId = (value: string): VenueId => value as VenueId;
