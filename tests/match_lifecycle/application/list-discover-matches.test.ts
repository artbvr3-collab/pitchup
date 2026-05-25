/**
 * MODULE: tests.match_lifecycle.application.list-discover-matches
 * PURPOSE: Unit tests for ListDiscoverMatchesService — the read-only Discover
 *          use case. Verifies that the service threads `now` / `limit` to the
 *          repository and decorates each row with the canonical slot math +
 *          derived status before returning view models.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/list-discover-matches.ts
 * MOCKS: MatchRepository port replaced with a hand-rolled FakeMatchRepository
 *        — per CODING_STANDARDS §9 "no mocks of code you own beyond ports".
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games".
 */
import { describe, it, expect } from "vitest";

import { asUserId } from "@/src/auth/domain/user";
import { ListDiscoverMatchesService } from "@/src/match_lifecycle/application/list-discover-matches";
import { asMatchId, type MatchWithVenue } from "@/src/match_lifecycle/domain/match";
import type {
  ListUpcomingOptions,
  MatchRepository,
} from "@/src/match_lifecycle/domain/match-repository";
import { asVenueId, type Surface } from "@/src/match_lifecycle/domain/venue";

class FakeMatchRepository implements MatchRepository {
  public listCalls: ListUpcomingOptions[] = [];
  private rows: readonly MatchWithVenue[] = [];

  seed(rows: readonly MatchWithVenue[]): void {
    this.rows = rows;
  }

  async listUpcoming(options: ListUpcomingOptions): Promise<readonly MatchWithVenue[]> {
    this.listCalls.push(options);
    return this.rows.slice(0, options.limit);
  }
}

const NOW = new Date("2026-05-26T12:00:00.000Z");

function makeMatch(overrides: Partial<MatchWithVenue> = {}): MatchWithVenue {
  const defaults: MatchWithVenue = {
    id: asMatchId("m1"),
    captainId: asUserId("u1"),
    venueId: asVenueId("v1"),
    startTime: new Date("2026-05-27T18:00:00.000Z"),
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
  return { ...defaults, ...overrides };
}

describe("ListDiscoverMatchesService.execute", () => {
  it("threads `now` and `limit` into the repository", async () => {
    const repo = new FakeMatchRepository();
    const service = new ListDiscoverMatchesService(repo);

    await service.execute({ now: NOW, limit: 25 });

    expect(repo.listCalls).toHaveLength(1);
    expect(repo.listCalls[0]).toEqual({ now: NOW, limit: 25 });
  });

  it("defaults limit to 50 when not provided", async () => {
    const repo = new FakeMatchRepository();
    const service = new ListDiscoverMatchesService(repo);

    await service.execute({ now: NOW });

    expect(repo.listCalls[0]?.limit).toBe(50);
  });

  it("defaults now to new Date() when not provided", async () => {
    const repo = new FakeMatchRepository();
    const service = new ListDiscoverMatchesService(repo);

    const before = Date.now();
    await service.execute({});
    const after = Date.now();

    const usedNow = repo.listCalls[0]?.now.getTime() ?? 0;
    expect(usedNow).toBeGreaterThanOrEqual(before);
    expect(usedNow).toBeLessThanOrEqual(after);
  });

  it("decorates each match with derived status and slot info", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([
      // Pre-game, open (captain alone, capacity 14)
      makeMatch({
        id: asMatchId("m-open"),
        startTime: new Date("2026-05-27T18:00:00.000Z"),
        totalSpots: 14,
        captainCrew: [],
      }),
      // Pre-game, almostFull (free = 2)
      makeMatch({
        id: asMatchId("m-almost"),
        startTime: new Date("2026-05-28T18:00:00.000Z"),
        totalSpots: 14,
        captainCrew: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"], // 1+11=12, free=2
      }),
      // Pre-game, full
      makeMatch({
        id: asMatchId("m-full"),
        startTime: new Date("2026-05-29T18:00:00.000Z"),
        totalSpots: 10,
        captainCrew: ["a", "b", "c", "d", "e", "f", "g", "h", "i"], // 1+9=10, free=0
      }),
    ]);

    const service = new ListDiscoverMatchesService(repo);
    const result = await service.execute({ now: NOW });

    expect(result).toHaveLength(3);

    const open = result[0]!;
    expect(open.status).toBe("open");
    expect(open.slots.filled).toBe(1);
    expect(open.slots.free).toBe(13);

    const almost = result[1]!;
    expect(almost.status).toBe("almostFull");
    expect(almost.slots.filled).toBe(12);
    expect(almost.slots.free).toBe(2);

    const full = result[2]!;
    expect(full.status).toBe("full");
    expect(full.slots.filled).toBe(10);
    expect(full.slots.free).toBe(0);
    expect(full.slots.isFull).toBe(true);
  });

  it("flattens venue into the view model (id / name / address only)", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([
      makeMatch({
        venue: {
          id: asVenueId("v-letna"),
          name: "Letná Sportcentrum",
          address: "Korunovační 29, Praha 7",
          lat: 50.1029,
          lng: 14.4263,
          googleMapsUrl: null,
          surface: ["hard"],
          coverId: "cover-002",
          active: true,
        },
      }),
    ]);

    const service = new ListDiscoverMatchesService(repo);
    const [view] = await service.execute({ now: NOW });

    expect(view?.venue).toEqual({
      id: asVenueId("v-letna"),
      name: "Letná Sportcentrum",
      address: "Korunovační 29, Praha 7",
    });
  });

  it("returns an empty array when the repository returns none", async () => {
    const repo = new FakeMatchRepository();
    const service = new ListDiscoverMatchesService(repo);

    const result = await service.execute({ now: NOW });
    expect(result).toEqual([]);
  });
});
