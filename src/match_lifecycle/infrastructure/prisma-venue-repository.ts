/**
 * MODULE: match_lifecycle.infrastructure.prisma-venue-repository
 * PURPOSE: Prisma adapter for `VenueRepository`. Read-only at Layer 3 —
 *          admin-managed venues are write-side in Layer 9.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/venue, ../domain/venue-repository
 * CONSUMED BY: ./repositories.ts
 * INVARIANTS:
 *   - `listActive()` orders by `name ASC` (case-insensitive) so the wizard
 *     venue picker has a stable, predictable list.
 * RELATED DOCS: docs/ARCHITECTURE.md §8.
 */
import type { PrismaClient } from "@prisma/client";
import { asVenueId, type Surface, type Venue } from "../domain/venue";
import type { VenueRepository } from "../domain/venue-repository";

interface VenueRow {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  googleMapsUrl: string | null;
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

  async findById(id: ReturnType<typeof asVenueId>): Promise<Venue | null> {
    const row = await this.prisma.venue.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
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
    surface: row.surface as readonly Surface[],
    coverId: row.coverId,
    active: row.active,
  };
}
