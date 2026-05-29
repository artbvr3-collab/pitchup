/**
 * MODULE: tests.match_lifecycle.domain.compute-changed-material-fields
 * PURPOSE: Diff helper for the `match_updated` notification body. Covers each
 *          material field individually, combinations (ordered), no-change, and
 *          non-material edits (must produce an empty list — accepted players
 *          are not notified for those).
 * LAYER: tests / domain (pure)
 * TESTS FOR: src/match_lifecycle/domain/compute-changed-material-fields.ts
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "/matches/:id/edit"
 */
import { describe, expect, it } from "vitest";

import { computeChangedMaterialFields } from "@/src/match_lifecycle/domain/compute-changed-material-fields";
import type { Match } from "@/src/match_lifecycle/domain/match";
import type { Surface } from "@/src/match_lifecycle/domain/venue";

import { makeMatch } from "../_helpers/fakes";

describe("computeChangedMaterialFields", () => {
  it("returns empty when nothing changed", () => {
    const m = makeMatch();
    expect(computeChangedMaterialFields(m, m)).toEqual([]);
  });

  it("detects a surface change", () => {
    const before = makeMatch({ surface: "grass" as Surface });
    const after = makeMatch({ surface: "hard" as Surface });
    expect(computeChangedMaterialFields(before, after)).toEqual(["surface"]);
  });

  it("detects a studs_allowed change", () => {
    const before = makeMatch({ studsAllowed: true });
    const after = makeMatch({ studsAllowed: false });
    expect(computeChangedMaterialFields(before, after)).toEqual(["studs"]);
  });

  it("detects a price change", () => {
    const before = makeMatch({ price: 0 });
    const after = makeMatch({ price: 150 });
    expect(computeChangedMaterialFields(before, after)).toEqual(["price"]);
  });

  it("detects a field_booked change", () => {
    const before = makeMatch({ fieldBooked: false });
    const after = makeMatch({ fieldBooked: true });
    expect(computeChangedMaterialFields(before, after)).toEqual([
      "field booking",
    ]);
  });

  it("lists multiple changed fields in canonical order", () => {
    const before = makeMatch({
      surface: "grass" as Surface,
      studsAllowed: true,
      price: 0,
      fieldBooked: false,
    });
    const after = makeMatch({
      surface: "hard" as Surface,
      studsAllowed: false,
      price: 200,
      fieldBooked: true,
    });
    expect(computeChangedMaterialFields(before, after)).toEqual([
      "surface",
      "studs",
      "price",
      "field booking",
    ]);
  });

  it("ignores non-material changes (description / total_spots / captain_crew)", () => {
    const before = makeMatch({
      description: "old",
      totalSpots: 14,
      captainCrew: [],
    });
    const after: Match = makeMatch({
      description: "new description",
      totalSpots: 20,
      captainCrew: ["Pavel"],
    });
    expect(computeChangedMaterialFields(before, after)).toEqual([]);
  });
});
