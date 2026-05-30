/**
 * MODULE: tests.match_lifecycle.application.create-match-service
 * PURPOSE: Cover every branch of CreateMatchService — happy path + every
 *          domain error in the per-endpoint checklist for POST /api/matches.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/create-match-service.ts
 * MOCKS: MatchRepository + VenueRepository ports replaced with hand-rolled
 *        fakes (CODING_STANDARDS §9).
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "/matches/new",
 *               "Per-endpoint checklist" → POST /matches.
 */
import { describe, expect, it } from "vitest";

import { asUserId } from "@/src/auth/domain/user";
import { CreateMatchService } from "@/src/match_lifecycle/application/create-match-service";
import type { CreateMatchInput } from "@/src/match_lifecycle/application/dto/create-match-input";
import {
  CaptainCrewOverflowError,
  InvalidCrewNameError,
  InvalidStartTimeError,
  InvalidSurfaceError,
  InvalidTotalSpotsError,
  TooFarAheadError,
  VenueInactiveError,
  VenueNotFoundError,
} from "@/src/match_lifecycle/domain/errors";
import { asMatchId, type MatchId } from "@/src/match_lifecycle/domain/match";
import type {
  CreateMatchPersistenceInput,
  FindDiscoverPageOptions,
  FindDiscoverPageResult,
  MatchRepository,
} from "@/src/match_lifecycle/domain/match-repository";
import { asVenueId, type Surface, type Venue } from "@/src/match_lifecycle/domain/venue";
import type { VenueRepository } from "@/src/match_lifecycle/domain/venue-repository";

class FakeMatchRepository implements MatchRepository {
  public created: CreateMatchPersistenceInput[] = [];

  async findDiscoverPage(
    _options: FindDiscoverPageOptions,
  ): Promise<FindDiscoverPageResult> {
    return { rows: [], nextCursor: null };
  }

  async create(input: CreateMatchPersistenceInput): Promise<MatchId> {
    this.created.push(input);
    return asMatchId("00000000-0000-0000-0000-000000000099");
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
    throw new Error("update() not used in create-match tests");
  }

  async cancel(): Promise<void> {
    throw new Error("cancel() not used in create-match tests");
  }

  async findUpcomingByCaptain(): Promise<readonly never[]> {
    return [];
  }

  async findMatchIdsWithPendingStartedBefore(): Promise<readonly never[]> {
    return [];
  }

  async findActiveStartingInWindow(): Promise<readonly never[]> {
    return [];
  }

  async findMapMatches(): Promise<{ rows: readonly never[] }> {
    return { rows: [] };
  }
}

class FakeVenueRepository implements VenueRepository {
  private venues = new Map<string, Venue>();

  put(venue: Venue): void {
    this.venues.set(venue.id, venue);
  }

  async listActive(): Promise<readonly Venue[]> {
    return [...this.venues.values()].filter((v) => v.active);
  }

  async findById(id: ReturnType<typeof asVenueId>): Promise<Venue | null> {
    return this.venues.get(id) ?? null;
  }
}

const NOW = new Date("2026-05-26T10:00:00Z"); // Prague 12:00 on 2026-05-26
const CAPTAIN_ID = "11111111-1111-1111-1111-111111111111";
const VENUE_ID = "22222222-2222-2222-2222-222222222222";

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: asVenueId(VENUE_ID),
    name: "Letná Park",
    address: "Letenské sady 1, Prague 7",
    lat: 50.097,
    lng: 14.418,
    googleMapsUrl: null,
    surface: ["grass", "hard"] as readonly Surface[],
    coverId: "cover-letna-1",
    active: true,
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreateMatchInput> = {}): CreateMatchInput {
  return {
    captainId: CAPTAIN_ID,
    venueId: VENUE_ID,
    startTime: new Date("2026-05-26T17:00:00Z"), // 19:00 Prague, ~7h ahead
    duration: 90,
    totalSpots: 14,
    price: 150,
    surface: "grass",
    studsAllowed: true,
    fieldBooked: false,
    description: "Casual game, all welcome.",
    captainCrew: ["Marek", "Tomas"],
    ...overrides,
  };
}

function makeService(): {
  service: CreateMatchService;
  matchRepo: FakeMatchRepository;
  venueRepo: FakeVenueRepository;
} {
  const matchRepo = new FakeMatchRepository();
  const venueRepo = new FakeVenueRepository();
  venueRepo.put(makeVenue());
  return {
    service: new CreateMatchService(matchRepo, venueRepo),
    matchRepo,
    venueRepo,
  };
}

describe("CreateMatchService", () => {
  it("creates a match and snapshots venue.coverId at INSERT time", async () => {
    const { service, matchRepo } = makeService();

    const result = await service.execute(makeInput(), NOW);

    expect(result.id).toBeTruthy();
    expect(matchRepo.created).toHaveLength(1);
    const row = matchRepo.created[0]!;
    expect(row.captainId).toBe(asUserId(CAPTAIN_ID));
    expect(row.venueId).toBe(asVenueId(VENUE_ID));
    expect(row.coverId).toBe("cover-letna-1");
    expect(row.captainCrew).toEqual(["Marek", "Tomas"]);
    expect(row.description).toBe("Casual game, all welcome.");
  });

  it("forces studsAllowed=false on hard surface", async () => {
    const { service, matchRepo } = makeService();

    await service.execute(
      makeInput({ surface: "hard", studsAllowed: true }),
      NOW,
    );

    expect(matchRepo.created[0]!.studsAllowed).toBe(false);
  });

  it("normalizes empty description to null", async () => {
    const { service, matchRepo } = makeService();

    await service.execute(makeInput({ description: "   " }), NOW);

    expect(matchRepo.created[0]!.description).toBeNull();
  });

  it("trims crew names and drops blank entries", async () => {
    const { service, matchRepo } = makeService();

    await service.execute(
      makeInput({ captainCrew: ["  Marek ", "", "   ", "Tomas"] }),
      NOW,
    );

    expect(matchRepo.created[0]!.captainCrew).toEqual(["Marek", "Tomas"]);
  });

  it("rejects start_time earlier than now + 30 min", async () => {
    const { service } = makeService();

    await expect(
      service.execute(
        makeInput({ startTime: new Date(NOW.getTime() + 29 * 60_000) }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidStartTimeError);
  });

  it("accepts start_time exactly at now + 30 min boundary", async () => {
    const { service } = makeService();

    const result = await service.execute(
      makeInput({ startTime: new Date(NOW.getTime() + 30 * 60_000) }),
      NOW,
    );

    expect(result.id).toBeTruthy();
  });

  it("rejects start_time outside the 21-day Prague horizon", async () => {
    const { service } = makeService();
    // 2026-06-16 is day today+21 in Prague (allowed up to and including
    // 2026-06-15); pick a moment past the end of day today+20.
    const tooFar = new Date("2026-06-15T23:00:00Z"); // already day+21 in Prague

    await expect(
      service.execute(makeInput({ startTime: tooFar }), NOW),
    ).rejects.toBeInstanceOf(TooFarAheadError);
  });

  it("accepts start_time at the last legal Prague minute of day+20", async () => {
    const { service } = makeService();
    // Day today+20 = 2026-06-15 Prague. Last legal start_time = 23:59 local.
    // 2026-06-15 21:59:00Z = 2026-06-15 23:59 Prague (CEST = UTC+2).
    const lastLegal = new Date("2026-06-15T21:59:00Z");

    const result = await service.execute(
      makeInput({ startTime: lastLegal }),
      NOW,
    );

    expect(result.id).toBeTruthy();
  });

  it.each([7, 31])(
    "rejects total_spots outside [8, 30] (%i)",
    async (totalSpots) => {
      const { service } = makeService();
      await expect(
        service.execute(makeInput({ totalSpots }), NOW),
      ).rejects.toBeInstanceOf(InvalidTotalSpotsError);
    },
  );

  it("rejects crew name longer than 30 chars", async () => {
    const { service } = makeService();

    await expect(
      service.execute(
        makeInput({ captainCrew: ["A".repeat(31)] }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidCrewNameError);
  });

  it("rejects when 1 + crew.length exceeds total_spots", async () => {
    const { service } = makeService();
    const crew = Array.from({ length: 8 }, (_, i) => `P${i}`); // 8 crew + 1 captain = 9

    await expect(
      service.execute(
        makeInput({ totalSpots: 8, captainCrew: crew }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(CaptainCrewOverflowError);
  });

  it("rejects when the venue does not exist", async () => {
    const { service } = makeService();

    await expect(
      service.execute(
        makeInput({ venueId: "00000000-0000-0000-0000-000000000000" }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(VenueNotFoundError);
  });

  it("rejects when the venue is inactive", async () => {
    const matchRepo = new FakeMatchRepository();
    const venueRepo = new FakeVenueRepository();
    venueRepo.put(makeVenue({ active: false }));
    const service = new CreateMatchService(matchRepo, venueRepo);

    await expect(service.execute(makeInput(), NOW)).rejects.toBeInstanceOf(
      VenueInactiveError,
    );
  });

  it("rejects when surface is not offered by the venue", async () => {
    const matchRepo = new FakeMatchRepository();
    const venueRepo = new FakeVenueRepository();
    venueRepo.put(makeVenue({ surface: ["grass"] }));
    const service = new CreateMatchService(matchRepo, venueRepo);

    await expect(
      service.execute(makeInput({ surface: "hard" }), NOW),
    ).rejects.toBeInstanceOf(InvalidSurfaceError);
  });
});
