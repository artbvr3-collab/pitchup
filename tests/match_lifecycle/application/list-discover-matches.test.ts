/**
 * MODULE: tests.match_lifecycle.application.list-discover-matches
 * PURPOSE: Verify that the use case wires the parsed filter DTO into the
 *          repository, drops `distanceKm` when no location is supplied,
 *          threads cursor + limit through, and decorates each row with the
 *          canonical slot math + derived status.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/list-discover-matches.ts
 * MOCKS: MatchRepository port replaced with a hand-rolled fake (per
 *        CODING_STANDARDS §9 "no mocks of code you own beyond ports").
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games".
 */
import { describe, it, expect } from "vitest";

import { asUserId } from "@/src/auth/domain/user";
import {
  parseDiscoverFilters,
  type DiscoverFilters,
} from "@/src/match_lifecycle/application/discover-filters";
import { ListDiscoverMatchesService } from "@/src/match_lifecycle/application/list-discover-matches";
import { asMatchId, type MatchWithVenue } from "@/src/match_lifecycle/domain/match";
import type {
  CreateMatchPersistenceInput,
  FindDiscoverPageOptions,
  FindDiscoverPageResult,
  MatchRepository,
} from "@/src/match_lifecycle/domain/match-repository";
import { asVenueId, type Surface } from "@/src/match_lifecycle/domain/venue";

class FakeMatchRepository implements MatchRepository {
  public calls: FindDiscoverPageOptions[] = [];
  private rows: readonly MatchWithVenue[] = [];
  private nextCursor: FindDiscoverPageResult["nextCursor"] = null;

  seed(
    rows: readonly MatchWithVenue[],
    nextCursor: FindDiscoverPageResult["nextCursor"] = null,
  ): void {
    this.rows = rows;
    this.nextCursor = nextCursor;
  }

  async findDiscoverPage(
    options: FindDiscoverPageOptions,
  ): Promise<FindDiscoverPageResult> {
    this.calls.push(options);
    return { rows: this.rows, nextCursor: this.nextCursor };
  }

  async create(_input: CreateMatchPersistenceInput): Promise<never> {
    throw new Error("not implemented in FakeMatchRepository for discover tests");
  }

  async findById(): Promise<null> {
    return null;
  }

  async findCaptainMatches(): Promise<readonly never[]> {
    return [];
  }

  async findByIds(): Promise<readonly never[]> {
    return [];
  }

  async update(): Promise<Date> {
    throw new Error("update() not used in list-discover tests");
  }

  async cancel(): Promise<void> {
    throw new Error("cancel() not used in list-discover tests");
  }

  async findUpcomingByCaptain(): Promise<readonly never[]> {
    return [];
  }
}

const NOW = new Date("2026-05-26T10:00:00Z"); // Prague 2026-05-26

function defaultFilters(): DiscoverFilters {
  return parseDiscoverFilters(new URLSearchParams(""), { now: NOW });
}

function makeMatch(overrides: Partial<MatchWithVenue> = {}): MatchWithVenue {
  const base: MatchWithVenue = {
    id: asMatchId("m1"),
    captainId: asUserId("u1"),
    venueId: asVenueId("v1"),
    startTime: new Date("2026-05-26T16:00:00Z"),
    duration: 90,
    totalSpots: 14,
    price: 200,
    surface: "grass" as Surface,
    studsAllowed: true,
    fieldBooked: true,
    description: null,
    descriptionHidden: false,
    captainCrew: [],
    cancelledAt: null,
    cancelReason: null,
    cancelReasonHidden: false,
    coverId: "cover-001",
    createdAt: NOW,
    updatedAt: NOW,
    venue: {
      id: asVenueId("v1"),
      name: "Strahov — Field 3",
      address: "Vaníčkova 2, Praha 6",
      lat: 50.0793,
      lng: 14.3879,
      googleMapsUrl: null,
      surface: ["grass"],
      coverId: "cover-001",
      active: true,
    },
  };
  return { ...base, ...overrides };
}

describe("ListDiscoverMatchesService.execute", () => {
  it("translates the Prague-day filter into a UTC half-open window", async () => {
    const repo = new FakeMatchRepository();
    const service = new ListDiscoverMatchesService(repo);

    await service.execute({ filters: defaultFilters(), now: NOW, limit: 50 });

    const call = repo.calls[0]!;
    // Prague 2026-05-26 in summer = UTC 2026-05-25T22:00 → 2026-05-26T22:00.
    expect(call.dayUtcStart.toISOString()).toBe("2026-05-25T22:00:00.000Z");
    expect(call.dayUtcEnd.toISOString()).toBe("2026-05-26T22:00:00.000Z");
    expect(call.now).toBe(NOW);
    expect(call.limit).toBe(50);
  });

  it("forwards each sheet filter to the repository unchanged", async () => {
    const repo = new FakeMatchRepository();
    const service = new ListDiscoverMatchesService(repo);

    const filters = parseDiscoverFilters(
      new URLSearchParams(
        "time=evening&size=7&spots=2-3&free=1&booked=1&distance=3",
      ),
      { now: NOW },
    );

    await service.execute({
      filters,
      now: NOW,
      limit: 50,
      location: { lat: 50.08, lng: 14.43 },
    });

    const call = repo.calls[0]!;
    expect(call.timeOfDay).toEqual(["evening"]);
    expect(call.gameSize).toEqual([7]);
    expect(call.spotsLeft).toBe("2-3");
    expect(call.freeOnly).toBe(true);
    expect(call.fieldBookedOnly).toBe(true);
    expect(call.distanceKm).toBe(3);
    expect(call.location).toEqual({ lat: 50.08, lng: 14.43 });
  });

  it("silently drops distanceKm when no location is supplied (spec)", async () => {
    const repo = new FakeMatchRepository();
    const service = new ListDiscoverMatchesService(repo);

    const filters = parseDiscoverFilters(new URLSearchParams("distance=5"), {
      now: NOW,
    });

    await service.execute({ filters, now: NOW, limit: 50, location: null });

    const call = repo.calls[0]!;
    expect(call.distanceKm).toBeNull();
    expect(call.location).toBeNull();
  });

  it("passes the cursor through to the repository", async () => {
    const repo = new FakeMatchRepository();
    const service = new ListDiscoverMatchesService(repo);

    const cursor = {
      startTime: new Date("2026-05-26T17:30:00Z"),
      id: "abc",
    };
    const filters: DiscoverFilters = { ...defaultFilters(), cursor };

    await service.execute({ filters, now: NOW, limit: 50 });

    expect(repo.calls[0]!.cursor).toEqual(cursor);
  });

  it("decorates rows with derived status + slot math and returns nextCursor", async () => {
    const repo = new FakeMatchRepository();
    repo.seed(
      [
        makeMatch({
          id: asMatchId("m-open"),
          startTime: new Date("2026-05-26T18:00:00Z"),
          totalSpots: 14,
          captainCrew: [],
        }),
        makeMatch({
          id: asMatchId("m-full"),
          startTime: new Date("2026-05-26T19:00:00Z"),
          totalSpots: 10,
          captainCrew: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        }),
      ],
      { startTime: new Date("2026-05-26T19:00:00Z"), id: "m-full" },
    );

    const service = new ListDiscoverMatchesService(repo);
    const result = await service.execute({
      filters: defaultFilters(),
      now: NOW,
      limit: 50,
    });

    expect(result.rows[0]!.status).toBe("open");
    expect(result.rows[0]!.slots.free).toBe(13);
    expect(result.rows[1]!.status).toBe("full");
    expect(result.rows[1]!.slots.free).toBe(0);
    expect(result.nextCursor?.id).toBe("m-full");
  });
});
