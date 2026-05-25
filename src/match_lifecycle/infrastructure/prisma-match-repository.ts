/**
 * MODULE: match_lifecycle.infrastructure.prisma-match-repository
 * PURPOSE: Prisma adapter for the `MatchRepository` port. Translates Prisma
 *          row shapes (snake_case columns via @map, nested venue via include)
 *          into domain types (branded ids, readonly arrays).
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/match_lifecycle/infrastructure/repositories.ts
 * INVARIANTS:
 *   - Returns matches sorted by (startTime ASC, id ASC). Index on `start_time`
 *     supports the primary sort; id breaks ties deterministically.
 *   - Excludes cancelled matches and matches whose startTime < `now` from
 *     listUpcoming(). Public Discover never shows these.
 *   - Always joins venue — Discover cards require venue name/address/coords.
 *   - Maps `surface` text to the domain `Surface` union without runtime
 *     validation; values in the DB are constrained at write time (Layer 3).
 * RELATED DOCS: docs/ARCHITECTURE.md §8 (Persistence).
 */
import type {
  PrismaClient,
  Match as PrismaMatch,
  Venue as PrismaVenue,
} from "@prisma/client";
import { asUserId } from "@/src/auth/domain/user";
import { asMatchId, type MatchWithVenue } from "../domain/match";
import type {
  ListUpcomingOptions,
  MatchRepository,
} from "../domain/match-repository";
import { asVenueId, type Surface, type Venue } from "../domain/venue";

type PrismaMatchWithVenue = PrismaMatch & { venue: PrismaVenue };

export class PrismaMatchRepository implements MatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listUpcoming(
    options: ListUpcomingOptions,
  ): Promise<readonly MatchWithVenue[]> {
    const rows = await this.prisma.match.findMany({
      where: {
        cancelledAt: null,
        startTime: { gte: options.now },
      },
      include: { venue: true },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take: options.limit,
    });
    return rows.map(mapToDomain);
  }
}

function mapToDomain(row: PrismaMatchWithVenue): MatchWithVenue {
  return {
    id: asMatchId(row.id),
    captainId: asUserId(row.captainId),
    venueId: asVenueId(row.venueId),
    startTime: row.startTime,
    duration: row.duration,
    totalSpots: row.totalSpots,
    price: row.price,
    surface: row.surface as Surface,
    studsAllowed: row.studsAllowed,
    fieldBooked: row.fieldBooked,
    description: row.description,
    descriptionHidden: row.descriptionHidden,
    captainCrew: row.captainCrew,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    cancelReasonHidden: row.cancelReasonHidden,
    coverId: row.coverId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    venue: mapVenue(row.venue),
  };
}

function mapVenue(row: PrismaVenue): Venue {
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
