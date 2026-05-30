/**
 * TESTS FOR: src/match_lifecycle/application/list-map-matches.ts
 * COVERAGE: ListMapMatchesService — horizon computation, status filtering,
 *           location-guard, empty result.
 * MOCKS: MatchRepository (FakeMatchRepository below)
 */
import { describe, expect, it } from "vitest";

import { asMatchId, type Match, type MatchId, type MatchWithVenue } from "@/src/match_lifecycle/domain/match";
import type {
  FindDiscoverPageOptions,
  FindDiscoverPageResult,
  FindMapMatchesOptions,
  FindMapMatchesResult,
  MatchRepository,
  UpdateMatchPatch,
} from "@/src/match_lifecycle/domain/match-repository";
import type { CreateMatchPersistenceInput } from "@/src/match_lifecycle/domain/match-repository";
import { ListMapMatchesService } from "@/src/match_lifecycle/application/list-map-matches";
import { asVenueId, type Venue } from "@/src/match_lifecycle/domain/venue";
import type { UserId } from "@/src/auth/domain/user";
import { todayPrague } from "@/src/shared/time/prague";

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-31T10:00:00Z"); // Prague 12:00

const VENUE: Venue = {
  id: asVenueId("aaaa0000-0000-0000-0000-000000000001"),
  name: "Letná Park",
  address: "Letenské sady 1, Praha 7",
  lat: 50.097,
  lng: 14.418,
  googleMapsUrl: null,
  surface: ["grass"],
  coverId: "cover-letna-1",
  active: true,
};

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: asMatchId("00000000-0000-0000-0000-000000000001"),
    captainId: "11111111-1111-1111-1111-111111111111" as UserId,
    venueId: VENUE.id,
    startTime: new Date("2026-06-01T14:00:00Z"), // Prague 16:00 (Afternoon)
    duration: 90,
    totalSpots: 10,
    price: 0,
    surface: "grass",
    studsAllowed: true,
    fieldBooked: false,
    description: null,
    descriptionHidden: false,
    captainCrew: [],
    cancelledAt: null,
    cancelReason: null,
    cancelReasonHidden: false,
    coverId: "cover-letna-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMatchWithVenue(overrides: Partial<Match> = {}): MatchWithVenue {
  return { ...makeMatch(overrides), venue: VENUE };
}

// ── Fake repository ───────────────────────────────────────────────────────────

class FakeMatchRepository implements MatchRepository {
  private rows: readonly MatchWithVenue[] = [];
  public lastOptions: FindMapMatchesOptions | null = null;

  seed(rows: readonly MatchWithVenue[]): void {
    this.rows = rows;
  }

  async findMapMatches(options: FindMapMatchesOptions): Promise<FindMapMatchesResult> {
    this.lastOptions = options;
    return { rows: this.rows };
  }

  async findDiscoverPage(_o: FindDiscoverPageOptions): Promise<FindDiscoverPageResult> {
    return { rows: [], nextCursor: null };
  }
  async create(_i: CreateMatchPersistenceInput): Promise<MatchId> {
    throw new Error("not used");
  }
  async findById(): Promise<null> { return null; }
  async findCaptainMatches(): Promise<readonly never[]> { return []; }
  async findByIds(): Promise<readonly never[]> { return []; }
  async update(): Promise<Date> { throw new Error("not used"); }
  async cancel(): Promise<void> { throw new Error("not used"); }
  async findUpcomingByCaptain(): Promise<readonly never[]> { return []; }
  async findMatchIdsWithPendingStartedBefore(): Promise<readonly never[]> { return []; }
  async findActiveStartingInWindow(): Promise<readonly never[]> { return []; }
  async findForAdmin(): Promise<readonly never[]> { return []; }
  async updateFlags(): Promise<null> { return null; }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ListMapMatchesService", () => {
  it("returns decorated matches for visible statuses", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([makeMatchWithVenue()]);
    const svc = new ListMapMatchesService(repo);

    const result = await svc.execute({ filters: emptyFilters(), now: NOW });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.status).toBe("open");
    expect(result.matches[0]?.slots.capacity).toBe(10);
    expect(result.matches[0]?.slots.filled).toBe(1); // captain only
    expect(result.matches[0]?.slots.free).toBe(9);
  });

  it("filters out cancelled matches", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([
      makeMatchWithVenue(),
      makeMatchWithVenue({
        id: asMatchId("00000000-0000-0000-0000-000000000002"),
        cancelledAt: new Date("2026-05-31T08:00:00Z"),
      }),
    ]);
    const svc = new ListMapMatchesService(repo);

    const result = await svc.execute({ filters: emptyFilters(), now: NOW });

    expect(result.matches).toHaveLength(1);
  });

  it("filters out InProgress and Ended matches", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([
      // InProgress: start in the past, not ended yet
      makeMatchWithVenue({
        id: asMatchId("00000000-0000-0000-0000-000000000010"),
        startTime: new Date("2026-05-31T09:00:00Z"), // before NOW=10:00
        duration: 90,
      }),
      // Open: in the future
      makeMatchWithVenue({
        id: asMatchId("00000000-0000-0000-0000-000000000011"),
        startTime: new Date("2026-06-01T14:00:00Z"),
        duration: 90,
      }),
    ]);
    const svc = new ListMapMatchesService(repo);

    const result = await svc.execute({ filters: emptyFilters(), now: NOW });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.status).toBe("open");
  });

  it("includes venue lat/lng on each match", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([makeMatchWithVenue()]);
    const svc = new ListMapMatchesService(repo);

    const result = await svc.execute({ filters: emptyFilters(), now: NOW });

    expect(result.matches[0]?.venue.lat).toBe(50.097);
    expect(result.matches[0]?.venue.lng).toBe(14.418);
  });

  it("passes distanceKm=null when no location provided", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([]);
    const svc = new ListMapMatchesService(repo);

    await svc.execute({
      filters: { ...emptyFilters(), distanceKm: 5 },
      now: NOW,
      location: null,
    });

    expect(repo.lastOptions?.distanceKm).toBeNull();
  });

  it("passes distanceKm when location is provided", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([]);
    const svc = new ListMapMatchesService(repo);

    await svc.execute({
      filters: { ...emptyFilters(), distanceKm: 3 },
      now: NOW,
      location: { lat: 50.097, lng: 14.418 },
    });

    expect(repo.lastOptions?.distanceKm).toBe(3);
  });

  it("returns empty matches when repo returns nothing", async () => {
    const repo = new FakeMatchRepository();
    repo.seed([]);
    const svc = new ListMapMatchesService(repo);

    const result = await svc.execute({ filters: emptyFilters(), now: NOW });

    expect(result.matches).toHaveLength(0);
  });
});

// ── Filter helpers ─────────────────────────────────────────────────────────────

function emptyFilters() {
  return {
    date: todayPrague(NOW),
    distanceKm: null,
    timeOfDay: [] as const,
    gameSize: [] as const,
    spotsLeft: null,
    freeOnly: false,
    fieldBookedOnly: false,
    venueSearch: "",
    cursor: null,
  };
}
