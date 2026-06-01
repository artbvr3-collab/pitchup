/**
 * TESTS FOR: src/match_lifecycle/application/update-venue-service.ts
 * MOCKS: VenueRepository (fake, from _helpers/fakes).
 * COVERAGE: not-found, happy overwrite + NFC/trim, and every branch of the
 *           deactivation guard (spec personal.md → "Guard against deactivation").
 */
import { describe, expect, it } from "vitest";

import { UpdateVenueService } from "@/src/match_lifecycle/application/update-venue-service";
import {
  VenueHasUpcomingMatchesError,
  VenueNotFoundError,
} from "@/src/match_lifecycle/domain/errors";
import { asVenueId, type Venue } from "@/src/match_lifecycle/domain/venue";

import { FakeVenueRepository } from "../_helpers/fakes";

const VENUE_ID = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-05-31T10:00:00Z");

function seedVenue(repo: FakeVenueRepository, overrides: Partial<Venue> = {}): void {
  repo.put({
    id: asVenueId(VENUE_ID),
    name: "Old Name",
    address: "Old Address",
    lat: 50.1,
    lng: 14.4,
    googleMapsUrl: null,
    photoUrl: null,
    surface: ["grass"],
    coverId: "cover-001",
    active: true,
    ...overrides,
  });
}

const PATCH = {
  name: "New Name",
  address: "New Address",
  lat: 50.2,
  lng: 14.5,
  googleMapsUrl: "https://maps.google.com/x",
  photoUrl: null,
  surface: ["grass", "hard"] as const,
  coverId: "cover-002",
  active: true,
};

function makeService() {
  const repo = new FakeVenueRepository(false);
  return { repo, service: new UpdateVenueService(repo) };
}

describe("UpdateVenueService", () => {
  it("throws VenueNotFoundError for an unknown id", async () => {
    const { service } = makeService();
    await expect(
      service.execute("00000000-0000-0000-0000-000000000000", PATCH, NOW),
    ).rejects.toBeInstanceOf(VenueNotFoundError);
  });

  it("overwrites all fields and NFC-trims name + address", async () => {
    const { repo, service } = makeService();
    seedVenue(repo);

    const venue = await service.execute(
      VENUE_ID,
      { ...PATCH, name: "  Trimmed  ", address: "  Addr  " },
      NOW,
    );

    expect(venue.name).toBe("Trimmed");
    expect(venue.address).toBe("Addr");
    expect(venue.surface).toEqual(["grass", "hard"]);
    expect(venue.coverId).toBe("cover-002");
    expect(venue.googleMapsUrl).toBe("https://maps.google.com/x");
  });

  it("blocks active → inactive when the venue has upcoming matches", async () => {
    const { repo, service } = makeService();
    seedVenue(repo, { active: true });
    repo.upcomingCounts.set(VENUE_ID, 3);

    const err = await service
      .execute(VENUE_ID, { ...PATCH, active: false }, NOW)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VenueHasUpcomingMatchesError);
    expect((err as VenueHasUpcomingMatchesError).meta).toMatchObject({
      upcomingMatchCount: 3,
    });
  });

  it("allows active → inactive when there are no upcoming matches", async () => {
    const { repo, service } = makeService();
    seedVenue(repo, { active: true });
    repo.upcomingCounts.set(VENUE_ID, 0);

    const venue = await service.execute(VENUE_ID, { ...PATCH, active: false }, NOW);

    expect(venue.active).toBe(false);
  });

  it("does not run the guard when the venue stays active", async () => {
    const { repo, service } = makeService();
    seedVenue(repo, { active: true });
    repo.upcomingCounts.set(VENUE_ID, 5); // would block deactivation, but we keep it active

    const venue = await service.execute(VENUE_ID, { ...PATCH, active: true }, NOW);

    expect(venue.active).toBe(true);
  });

  it("allows reactivation (inactive → active) regardless of upcoming count", async () => {
    const { repo, service } = makeService();
    seedVenue(repo, { active: false });
    repo.upcomingCounts.set(VENUE_ID, 9);

    const venue = await service.execute(VENUE_ID, { ...PATCH, active: true }, NOW);

    expect(venue.active).toBe(true);
  });
});
