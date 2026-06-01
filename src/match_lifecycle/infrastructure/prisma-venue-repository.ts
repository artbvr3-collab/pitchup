/**
 * MODULE: match_lifecycle.infrastructure.prisma-venue-repository
 * PURPOSE: Prisma adapter for `VenueRepository`. Read side (Layer 2/3 — Discover
 *          picker + match validation) plus the Layer 9b admin write side
 *          (create / update / list-for-admin / deactivation-guard count).
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/venue, ../domain/venue-repository
 * CONSUMED BY: ./repositories.ts
 * INVARIANTS:
 *   - `listActive()` orders by `name ASC` so the wizard venue picker is stable.
 *   - `listAllForAdmin()` decorates each row with `upcomingMatchCount` via a
 *     filtered Prisma relation count (`_count.select.matches` with
 *     `startTime > now AND cancelledAt = null`) — one query, no N+1.
 *   - No advisory lock on create/update — the Venue aggregate has no
 *     concurrent mutators (admin single-tab).
 * RELATED DOCS: docs/ARCHITECTURE.md §8; docs/spec/pitchup-spec-personal.md
 *               → "/admin/venues".
 */
import type { PrismaClient } from "@prisma/client";
import { asVenueId, type Surface, type Venue, type VenueId } from "../domain/venue";
import type {
  AdminVenueListFilters,
  AdminVenueView,
  CreateVenueInput,
  VenueRepository,
  VenueWriteFields,
} from "../domain/venue-repository";

interface VenueRow {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  googleMapsUrl: string | null;
  photoUrl: string | null;
  surface: string[];
  coverId: string;
  active: boolean;
}

export class PrismaVenueRepository implements VenueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listActive(): Promise<readonly Venue[]> {
    const rows = await this.prisma.venue.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    return rows.map(toDomain);
  }

  async findById(id: VenueId): Promise<Venue | null> {
    const row = await this.prisma.venue.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async listAllForAdmin(
    filters: AdminVenueListFilters,
  ): Promise<readonly AdminVenueView[]> {
    const rows = await this.prisma.venue.findMany({
      where:
        filters.status === undefined
          ? {}
          : { active: filters.status === "active" },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            matches: {
              where: { startTime: { gt: filters.now }, cancelledAt: null },
            },
          },
        },
      },
    });
    return rows.map((row) => ({
      ...toDomain(row),
      upcomingMatchCount: row._count.matches,
    }));
  }

  async create(input: CreateVenueInput): Promise<Venue> {
    const row = await this.prisma.venue.create({
      data: {
        id: input.id,
        name: input.name,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        googleMapsUrl: input.googleMapsUrl,
        photoUrl: input.photoUrl,
        surface: input.surface as Surface[],
        coverId: input.coverId,
        active: input.active,
      },
    });
    return toDomain(row);
  }

  async update(id: VenueId, patch: VenueWriteFields): Promise<Venue> {
    const row = await this.prisma.venue.update({
      where: { id },
      data: {
        name: patch.name,
        address: patch.address,
        lat: patch.lat,
        lng: patch.lng,
        googleMapsUrl: patch.googleMapsUrl,
        photoUrl: patch.photoUrl,
        surface: patch.surface as Surface[],
        coverId: patch.coverId,
        active: patch.active,
      },
    });
    return toDomain(row);
  }

  async countUpcomingNonCancelledAtVenue(
    id: VenueId,
    now: Date,
  ): Promise<number> {
    return this.prisma.match.count({
      where: { venueId: id, startTime: { gt: now }, cancelledAt: null },
    });
  }
}

function toDomain(row: VenueRow): Venue {
  return {
    id: asVenueId(row.id),
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    googleMapsUrl: row.googleMapsUrl,
    photoUrl: row.photoUrl,
    surface: row.surface as readonly Surface[],
    coverId: row.coverId,
    active: row.active,
  };
}
