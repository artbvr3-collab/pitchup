/**
 * MODULE: match_lifecycle.infrastructure.prisma-match-repository
 * PURPOSE: Prisma adapter for the `MatchRepository` port. Implements
 *          `findDiscoverPage` with: half-open Prague-day window, Prague-TZ
 *          hour buckets for time-of-day, total_spots bands for game size,
 *          a derived `free_slots` expression for spots-left + implicit
 *          hide-full, case-insensitive ILIKE venue search, Haversine
 *          distance, and keyset cursor pagination on `(start_time, id)`.
 *          Uses `$queryRaw` rather than Prisma's `where` builder because
 *          three of those filters (Prague-TZ extract, Haversine, tuple
 *          cursor) aren't expressible through Prisma's typed query API.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/match_lifecycle/infrastructure/repositories.ts
 * INVARIANTS:
 *   - Sort: `(start_time ASC, id ASC)`. The matches.id is a UUID so id-ordering
 *     is byte-lex; that's stable across requests, which is all the cursor
 *     contract needs (no requirement on insertion order).
 *   - Returns at most `limit` rows; one extra is fetched internally to
 *     compute `nextCursor` without a second query.
 *   - Excludes cancelled and past matches.
 *   - `slots_left` derivation uses `acceptedSlots = 0` until Layer 4 adds
 *     a JOIN against `join_requests` — keep the formula in sync with
 *     `computeSlots()` then.
 *   - ILIKE search escapes `%` and `_` to prevent inadvertent wildcard
 *     expansion from user input.
 * RELATED DOCS: docs/ARCHITECTURE.md §8, docs/spec/pitchup-spec-discovery.md.
 */
import { Prisma, type Match as MatchRow, type PrismaClient } from "@prisma/client";
import { asUserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";
import { asMatchId, type Match, type MatchId, type MatchWithVenue } from "../domain/match";
import type {
  CreateMatchPersistenceInput,
  DiscoverTimeOfDay,
  FindDiscoverPageOptions,
  FindDiscoverPageResult,
  FindMapMatchesOptions,
  FindMapMatchesResult,
  MatchRepository,
  UpdateMatchPatch,
} from "../domain/match-repository";
import { asVenueId, type Surface, type Venue } from "../domain/venue";

interface RawRow {
  id: string;
  captain_id: string;
  venue_id: string;
  start_time: Date;
  duration: number;
  total_spots: number;
  price: number;
  surface: string;
  studs_allowed: boolean;
  field_booked: boolean;
  description: string | null;
  description_hidden: boolean;
  captain_crew: string[];
  cancelled_at: Date | null;
  cancel_reason: string | null;
  cancel_reason_hidden: boolean;
  cover_id: string;
  created_at: Date;
  updated_at: Date;
  v_id: string;
  v_name: string;
  v_address: string;
  v_lat: number;
  v_lng: number;
  v_google_maps_url: string | null;
  v_surface: string[];
  v_cover_id: string;
  v_active: boolean;
}

const TIME_BUCKETS: Record<DiscoverTimeOfDay, [number, number]> = {
  morning: [6, 11],
  afternoon: [12, 17],
  evening: [18, 22],
};

export class PrismaMatchRepository implements MatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findDiscoverPage(
    options: FindDiscoverPageOptions,
  ): Promise<FindDiscoverPageResult> {
    const startTimeMin = new Date(
      Math.max(options.now.getTime(), options.dayUtcStart.getTime()),
    );

    const conditions: Prisma.Sql[] = [
      Prisma.sql`m.cancelled_at IS NULL`,
      Prisma.sql`m.start_time >= ${startTimeMin}`,
      Prisma.sql`m.start_time < ${options.dayUtcEnd}`,
    ];

    if (options.cursor) {
      conditions.push(
        Prisma.sql`(m.start_time, m.id) > (${options.cursor.startTime}, ${options.cursor.id}::uuid)`,
      );
    }

    if (options.timeOfDay.length > 0) {
      const bucketSql = options.timeOfDay.map((tod) => {
        const [from, to] = TIME_BUCKETS[tod];
        return Prisma.sql`EXTRACT(HOUR FROM (m.start_time AT TIME ZONE 'Europe/Prague')) BETWEEN ${from} AND ${to}`;
      });
      conditions.push(
        Prisma.sql`(${Prisma.join(bucketSql, ` OR `)})`,
      );
    }

    if (options.gameSize.length > 0) {
      // Chip N a side ⇒ total_spots ∈ {2N, 2N+1}. Flatten and use IN.
      const spotsValues = options.gameSize.flatMap((n) => [2 * n, 2 * n + 1]);
      conditions.push(
        Prisma.sql`m.total_spots IN (${Prisma.join(spotsValues)})`,
      );
    }

    if (options.spotsLeft) {
      // free_slots formula must mirror computeSlots() with acceptedSlots=0.
      // COALESCE handles the Postgres quirk that array_length(empty,1) IS NULL.
      const freeSlots = Prisma.sql`(m.total_spots - 1 - COALESCE(array_length(m.captain_crew, 1), 0))`;
      switch (options.spotsLeft) {
        case "1":
          conditions.push(Prisma.sql`${freeSlots} = 1`);
          break;
        case "2-3":
          conditions.push(Prisma.sql`${freeSlots} BETWEEN 2 AND 3`);
          break;
        case "4+":
          conditions.push(Prisma.sql`${freeSlots} >= 4`);
          break;
      }
    }

    if (options.freeOnly) {
      conditions.push(Prisma.sql`m.price = 0`);
    }

    if (options.fieldBookedOnly) {
      conditions.push(Prisma.sql`m.field_booked = TRUE`);
    }

    if (options.venueSearch.trim().length > 0) {
      const escaped = escapeIlike(options.venueSearch.trim());
      conditions.push(Prisma.sql`v.name ILIKE ${`%${escaped}%`}`);
    }

    if (options.distanceKm !== null && options.location) {
      const { lat, lng } = options.location;
      conditions.push(Prisma.sql`
        (2 * 6371 * asin(sqrt(
          power(sin(radians((v.lat - ${lat}) / 2)), 2) +
          cos(radians(${lat})) * cos(radians(v.lat)) *
          power(sin(radians((v.lng - ${lng}) / 2)), 2)
        ))) <= ${options.distanceKm}
      `);
    }

    const whereSql = Prisma.join(conditions, ` AND `);
    const fetchLimit = options.limit + 1;

    const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT
        m.id, m.captain_id, m.venue_id, m.start_time, m.duration,
        m.total_spots, m.price, m.surface, m.studs_allowed, m.field_booked,
        m.description, m.description_hidden, m.captain_crew, m.cancelled_at,
        m.cancel_reason, m.cancel_reason_hidden, m.cover_id, m.created_at,
        m.updated_at,
        v.id AS v_id, v.name AS v_name, v.address AS v_address,
        v.lat AS v_lat, v.lng AS v_lng,
        v.google_maps_url AS v_google_maps_url, v.surface AS v_surface,
        v.cover_id AS v_cover_id, v.active AS v_active
      FROM matches m
      JOIN venues v ON v.id = m.venue_id
      WHERE ${whereSql}
      ORDER BY m.start_time ASC, m.id ASC
      LIMIT ${fetchLimit}
    `);

    let pageRows = rows;
    let nextCursor: FindDiscoverPageResult["nextCursor"] = null;
    if (rows.length > options.limit) {
      pageRows = rows.slice(0, options.limit);
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = { startTime: last.start_time, id: last.id };
    }

    return {
      rows: pageRows.map(mapToDomain),
      nextCursor,
    };
  }

  async create(input: CreateMatchPersistenceInput): Promise<MatchId> {
    const row = await this.prisma.match.create({
      data: {
        captainId: input.captainId,
        venueId: input.venueId,
        startTime: input.startTime,
        duration: input.duration,
        totalSpots: input.totalSpots,
        price: input.price,
        surface: input.surface,
        studsAllowed: input.studsAllowed,
        fieldBooked: input.fieldBooked,
        description: input.description,
        captainCrew: [...input.captainCrew],
        coverId: input.coverId,
      },
      select: { id: true },
    });
    return asMatchId(row.id);
  }

  async findById(id: MatchId, tx?: TransactionClient): Promise<Match | null> {
    const client = tx ?? this.prisma;
    const row = await client.match.findUnique({ where: { id } });
    return row ? matchRowToDomain(row) : null;
  }

  async findCaptainMatches(
    userId: string,
  ): Promise<readonly MatchWithVenue[]> {
    const rows = await this.prisma.match.findMany({
      where: { captainId: userId },
      include: { venue: true },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
    });
    return rows.map(matchWithVenueRowToDomain);
  }

  async findByIds(
    ids: readonly MatchId[],
  ): Promise<readonly MatchWithVenue[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.match.findMany({
      where: { id: { in: ids as unknown as string[] } },
      include: { venue: true },
    });
    return rows.map(matchWithVenueRowToDomain);
  }

  async update(
    id: MatchId,
    patch: UpdateMatchPatch,
    tx: TransactionClient,
  ): Promise<Date> {
    // Only include keys explicitly present in the patch. `undefined` means
    // "don't touch"; Prisma also treats `undefined` as no-op but we guard
    // explicitly so the shape of `data` matches the spec's whitelist intent.
    const data: Record<string, unknown> = {};
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.totalSpots !== undefined) data.totalSpots = patch.totalSpots;
    if (patch.captainCrew !== undefined) {
      data.captainCrew = [...patch.captainCrew];
    }
    if (patch.surface !== undefined) data.surface = patch.surface;
    if (patch.studsAllowed !== undefined) {
      data.studsAllowed = patch.studsAllowed;
    }
    if (patch.price !== undefined) data.price = patch.price;
    if (patch.fieldBooked !== undefined) data.fieldBooked = patch.fieldBooked;

    const row = await tx.match.update({
      where: { id },
      data,
      select: { updatedAt: true },
    });
    return row.updatedAt;
  }

  async cancel(
    id: MatchId,
    cancelReason: string,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.match.update({
      where: { id },
      data: {
        cancelledAt: new Date(),
        cancelReason,
      },
    });
  }

  async findUpcomingByCaptain(
    userId: string,
    now: Date,
  ): Promise<readonly Match[]> {
    // No advisory lock + no venue join — the cascade only needs match ids
    // and the /me modal only needs `.length`. Ordering by startTime ASC is
    // not required by either caller, but it keeps the DELETE flow's debug
    // logs readable (oldest match cancelled first).
    const rows = await this.prisma.match.findMany({
      where: {
        captainId: userId,
        cancelledAt: null,
        startTime: { gt: now },
      },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
    });
    return rows.map(matchRowToDomain);
  }

  async findMatchIdsWithPendingStartedBefore(
    now: Date,
  ): Promise<readonly MatchId[]> {
    // Relation filter compiles to a JOIN + DISTINCT (or EXISTS subquery)
    // shape — either uses matches(start_time) + join_requests(match_id,
    // status) indexes. `select` keeps the payload narrow.
    const rows = await this.prisma.match.findMany({
      where: {
        startTime: { lte: now },
        joinRequests: { some: { status: "pending" } },
      },
      select: { id: true },
    });
    return rows.map((r) => asMatchId(r.id));
  }

  async findActiveStartingInWindow(
    start: Date,
    end: Date,
  ): Promise<readonly Match[]> {
    const rows = await this.prisma.match.findMany({
      where: {
        startTime: { gte: start, lt: end },
        cancelledAt: null,
      },
    });
    return rows.map(matchRowToDomain);
  }

  async findMapMatches(
    options: FindMapMatchesOptions,
  ): Promise<FindMapMatchesResult> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`m.cancelled_at IS NULL`,
      Prisma.sql`m.start_time >= ${options.now}`,
      Prisma.sql`m.start_time < ${options.horizonUtcEnd}`,
    ];

    if (options.timeOfDay.length > 0) {
      const bucketSql = options.timeOfDay.map((tod) => {
        const [from, to] = TIME_BUCKETS[tod];
        return Prisma.sql`EXTRACT(HOUR FROM (m.start_time AT TIME ZONE 'Europe/Prague')) BETWEEN ${from} AND ${to}`;
      });
      conditions.push(Prisma.sql`(${Prisma.join(bucketSql, ` OR `)})`);
    }

    if (options.gameSize.length > 0) {
      const spotsValues = options.gameSize.flatMap((n) => [2 * n, 2 * n + 1]);
      conditions.push(Prisma.sql`m.total_spots IN (${Prisma.join(spotsValues)})`);
    }

    if (options.spotsLeft) {
      const freeSlots = Prisma.sql`(m.total_spots - 1 - COALESCE(array_length(m.captain_crew, 1), 0))`;
      switch (options.spotsLeft) {
        case "1":
          conditions.push(Prisma.sql`${freeSlots} = 1`);
          break;
        case "2-3":
          conditions.push(Prisma.sql`${freeSlots} BETWEEN 2 AND 3`);
          break;
        case "4+":
          conditions.push(Prisma.sql`${freeSlots} >= 4`);
          break;
      }
    }

    if (options.freeOnly) {
      conditions.push(Prisma.sql`m.price = 0`);
    }

    if (options.fieldBookedOnly) {
      conditions.push(Prisma.sql`m.field_booked = TRUE`);
    }

    if (options.venueSearch.trim().length > 0) {
      const escaped = escapeIlike(options.venueSearch.trim());
      conditions.push(Prisma.sql`v.name ILIKE ${`%${escaped}%`}`);
    }

    if (options.distanceKm !== null && options.location) {
      const { lat, lng } = options.location;
      conditions.push(Prisma.sql`
        (2 * 6371 * asin(sqrt(
          power(sin(radians((v.lat - ${lat}) / 2)), 2) +
          cos(radians(${lat})) * cos(radians(v.lat)) *
          power(sin(radians((v.lng - ${lng}) / 2)), 2)
        ))) <= ${options.distanceKm}
      `);
    }

    const whereSql = Prisma.join(conditions, ` AND `);

    const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT
        m.id, m.captain_id, m.venue_id, m.start_time, m.duration,
        m.total_spots, m.price, m.surface, m.studs_allowed, m.field_booked,
        m.description, m.description_hidden, m.captain_crew, m.cancelled_at,
        m.cancel_reason, m.cancel_reason_hidden, m.cover_id, m.created_at,
        m.updated_at,
        v.id AS v_id, v.name AS v_name, v.address AS v_address,
        v.lat AS v_lat, v.lng AS v_lng,
        v.google_maps_url AS v_google_maps_url, v.surface AS v_surface,
        v.cover_id AS v_cover_id, v.active AS v_active
      FROM matches m
      JOIN venues v ON v.id = m.venue_id
      WHERE ${whereSql}
      ORDER BY m.start_time ASC, m.id ASC
    `);

    return { rows: rows.map(mapToDomain) };
  }
}

type MatchWithVenueRow = MatchRow & {
  venue: {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    googleMapsUrl: string | null;
    surface: string[];
    coverId: string;
    active: boolean;
  };
};

function matchWithVenueRowToDomain(row: MatchWithVenueRow): MatchWithVenue {
  return {
    ...matchRowToDomain(row),
    venue: {
      id: asVenueId(row.venue.id),
      name: row.venue.name,
      address: row.venue.address,
      lat: row.venue.lat,
      lng: row.venue.lng,
      googleMapsUrl: row.venue.googleMapsUrl,
      surface: row.venue.surface as readonly Surface[],
      coverId: row.venue.coverId,
      active: row.venue.active,
    },
  };
}

function matchRowToDomain(row: MatchRow): Match {
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
  };
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function mapToDomain(row: RawRow): MatchWithVenue {
  return {
    id: asMatchId(row.id),
    captainId: asUserId(row.captain_id),
    venueId: asVenueId(row.venue_id),
    startTime: row.start_time,
    duration: row.duration,
    totalSpots: row.total_spots,
    price: row.price,
    surface: row.surface as Surface,
    studsAllowed: row.studs_allowed,
    fieldBooked: row.field_booked,
    description: row.description,
    descriptionHidden: row.description_hidden,
    captainCrew: row.captain_crew,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    cancelReasonHidden: row.cancel_reason_hidden,
    coverId: row.cover_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    venue: mapVenue(row),
  };
}

function mapVenue(row: RawRow): Venue {
  return {
    id: asVenueId(row.v_id),
    name: row.v_name,
    address: row.v_address,
    lat: row.v_lat,
    lng: row.v_lng,
    googleMapsUrl: row.v_google_maps_url,
    surface: row.v_surface as readonly Surface[],
    coverId: row.v_cover_id,
    active: row.v_active,
  };
}
