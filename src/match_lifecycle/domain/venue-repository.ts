/**
 * MODULE: match_lifecycle.domain.venue-repository
 * PURPOSE: Repository port for the Venue aggregate. Venues are admin-managed
 *          (Layer 9b adds the write side); match_lifecycle reads them for the
 *          Create-match venue picker and validates + snapshots `coverId` on
 *          `POST /api/matches`.
 * LAYER: domain
 * DEPENDENCIES: ./venue
 * CONSUMED BY: src/match_lifecycle/application/list-venues-service.ts,
 *              src/match_lifecycle/application/create-match-service.ts,
 *              src/match_lifecycle/application/{create,update}-venue-service.ts,
 *              app/admin/venues/page.tsx (listAllForAdmin — direct read),
 *              src/match_lifecycle/infrastructure/prisma-venue-repository.ts
 * INVARIANTS:
 *   - `listActive()` returns only `active = true` venues, ordered by name
 *     (case-insensitive). The Create-match wizard depends on a stable order
 *     for the venue picker.
 *   - `findById()` returns null only when the venue does not exist (row
 *     absent) — it does NOT filter on `active`. Callers that need the
 *     active-only picker use `listActive()`.
 *   - `listAllForAdmin()` returns ALL venues (active + inactive — a venue is
 *     never soft-deleted), each decorated with `upcomingMatchCount` (the
 *     deactivation-guard input). The optional `status` filter narrows the set.
 *   - `create()` takes an app-generated `id` so the deterministic cover
 *     default (`defaultCoverIdForVenue`) is reproducible before INSERT.
 *   - `countUpcomingNonCancelledAtVenue()` counts matches with
 *     `start_time > now AND cancelled_at IS NULL` — the guard predicate.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/new" → Step 1 → Venue
 *   - docs/spec/pitchup-spec-personal.md → "/admin/venues"
 */
import type { Surface, Venue, VenueId } from "./venue";

/** Filters for the admin venue directory (`/admin/venues`). */
export interface AdminVenueListFilters {
  /** Narrow to `active` / `inactive`; omit for all venues. */
  readonly status?: "active" | "inactive";
  /** Reference time for the `upcomingMatchCount` decoration. */
  readonly now: Date;
}

/** A venue row for the admin table, decorated with the deactivation-guard count. */
export interface AdminVenueView extends Venue {
  /** Non-cancelled matches with `start_time > now` at this venue. */
  readonly upcomingMatchCount: number;
}

/** The full editable venue field set (create + update share the shape). */
export interface VenueWriteFields {
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly googleMapsUrl: string | null;
  readonly surface: readonly Surface[];
  readonly coverId: string;
  readonly active: boolean;
}

/** Create input — the editable fields plus an app-generated id. */
export interface CreateVenueInput extends VenueWriteFields {
  /** App-generated uuid (so the deterministic cover default is reproducible). */
  readonly id: string;
}

export interface VenueRepository {
  listActive(): Promise<readonly Venue[]>;
  findById(id: VenueId): Promise<Venue | null>;
  listAllForAdmin(
    filters: AdminVenueListFilters,
  ): Promise<readonly AdminVenueView[]>;
  create(input: CreateVenueInput): Promise<Venue>;
  update(id: VenueId, patch: VenueWriteFields): Promise<Venue>;
  countUpcomingNonCancelledAtVenue(id: VenueId, now: Date): Promise<number>;
}
