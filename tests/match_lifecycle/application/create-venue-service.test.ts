/**
 * TESTS FOR: src/match_lifecycle/application/create-venue-service.ts
 * MOCKS: VenueRepository (fake, from _helpers/fakes).
 * COVERAGE: id generation + deterministic cover default + NFC/trim + the
 *           admin-supplied cover override.
 */
import { describe, expect, it } from "vitest";

import { CreateVenueService } from "@/src/match_lifecycle/application/create-venue-service";
import {
  defaultCoverIdForVenue,
  isValidCoverId,
} from "@/src/match_lifecycle/domain/covers";

import { FakeVenueRepository } from "../_helpers/fakes";

function makeService() {
  const repo = new FakeVenueRepository(false);
  return { repo, service: new CreateVenueService(repo) };
}

const BASE = {
  name: "Strahov — Field 3",
  address: "Vaníčkova 2, Praha 6",
  lat: 50.0793,
  lng: 14.3879,
  googleMapsUrl: null,
  photoUrl: null,
  surface: ["grass"] as const,
  active: true,
};

describe("CreateVenueService", () => {
  it("persists a venue with an app-generated id", async () => {
    const { repo, service } = makeService();

    const venue = await service.execute({ ...BASE });

    expect(repo.created).toHaveLength(1);
    expect(venue.id).toBe(repo.created[0]!.id);
    expect(venue.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("applies the deterministic cover default when none is supplied", async () => {
    const { repo, service } = makeService();

    const venue = await service.execute({ ...BASE });

    expect(venue.coverId).toBe(defaultCoverIdForVenue(venue.id));
    expect(isValidCoverId(venue.coverId)).toBe(true);
  });

  it("uses the admin-supplied cover when provided", async () => {
    const { service } = makeService();

    const venue = await service.execute({ ...BASE, coverId: "cover-007" });

    expect(venue.coverId).toBe("cover-007");
  });

  it("NFC-normalises and trims name + address", async () => {
    const { service } = makeService();

    // "é" as base 'e' + combining accent should fold to a single NFC codepoint.
    const venue = await service.execute({
      ...BASE,
      name: "  Leténá Park  ",
      address: "  Some Street 1  ",
    });

    expect(venue.name).toBe("Leténá Park".normalize("NFC"));
    expect(venue.name.startsWith(" ")).toBe(false);
    expect(venue.address).toBe("Some Street 1");
  });

  it("persists a multi-surface, inactive venue verbatim", async () => {
    const { service } = makeService();

    const venue = await service.execute({
      ...BASE,
      surface: ["grass", "hard"],
      active: false,
    });

    expect(venue.surface).toEqual(["grass", "hard"]);
    expect(venue.active).toBe(false);
  });
});
