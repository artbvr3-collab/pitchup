/**
 * MODULE: tests.ui.team-shuffle
 * PURPOSE: Cover the pure shuffle helpers — unit building (captain/accepted/
 *          guests/crew), distribution invariants (every unit placed exactly
 *          once, round-robin balance), and clipboard formatting. The random
 *          paths are asserted on properties that hold for ANY seed (counts,
 *          membership), not on a specific ordering.
 * LAYER: tests / ui (pure)
 * TESTS FOR: src/ui/lib/team-shuffle.ts
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Shuffle teams"
 */
import { describe, expect, it } from "vitest";

import {
  buildShuffleUnits,
  formatTeamsAsText,
  groupByTeam,
  shuffleIntoTeams,
  type ShuffleRosterInput,
} from "@/src/ui/lib/team-shuffle";

const ROSTER: ShuffleRosterInput = {
  captainName: "Ivan Novak",
  accepted: [
    { name: "Pavel", guestCount: 0 },
    { name: "Mark", guestCount: 3 }, // Mark + 3 guests = 4 units
  ],
  crew: ["Tomas Kral"],
};

describe("buildShuffleUnits", () => {
  it("captain first, then accepted, then their guests (continuous numbering), then crew", () => {
    const units = buildShuffleUnits(ROSTER);
    expect(units).toEqual([
      "Ivan Novak (Captain)",
      "Pavel",
      "Mark",
      "Guest 1",
      "Guest 2",
      "Guest 3",
      "Tomas", // crew stub → first name only
    ]);
  });

  it("unit count equals filled (1 captain + accepted + guests + crew)", () => {
    const units = buildShuffleUnits(ROSTER);
    // 1 + 2 accepted + 3 guests + 1 crew = 7
    expect(units).toHaveLength(7);
  });

  it("guests are global, continuous across multiple hosts", () => {
    const units = buildShuffleUnits({
      captainName: "Cap",
      accepted: [
        { name: "A", guestCount: 2 },
        { name: "B", guestCount: 1 },
      ],
      crew: [],
    });
    expect(units).toEqual([
      "Cap (Captain)",
      "A",
      "B",
      "Guest 1",
      "Guest 2",
      "Guest 3",
    ]);
  });
});

describe("shuffleIntoTeams", () => {
  it("places every unit exactly once", () => {
    const units = buildShuffleUnits(ROSTER);
    const result = shuffleIntoTeams(units, 2);
    expect(result).toHaveLength(units.length);
    expect(new Set(result.map((a) => a.unitLabel))).toEqual(new Set(units));
  });

  it("2 teams: sizes differ by at most 1", () => {
    const units = buildShuffleUnits(ROSTER); // 7 units → 4 + 3
    const result = shuffleIntoTeams(units, 2);
    const sizes = [0, 1].map(
      (t) => result.filter((a) => a.team === t).length,
    );
    expect(Math.abs(sizes[0]! - sizes[1]!)).toBeLessThanOrEqual(1);
    expect(sizes[0]! + sizes[1]!).toBe(7);
  });

  it("3 teams: every team index in 0..2, balanced ±1", () => {
    const units = buildShuffleUnits(ROSTER); // 7 → 3/2/2 in some order
    const result = shuffleIntoTeams(units, 3);
    const sizes = [0, 1, 2].map(
      (t) => result.filter((a) => a.team === t).length,
    );
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(7);
    for (const a of result) expect(a.team).toBeGreaterThanOrEqual(0);
    for (const a of result) expect(a.team).toBeLessThanOrEqual(2);
  });
});

describe("groupByTeam", () => {
  it("returns exactly teamCount groups in Red/Blue(/Green) order", () => {
    const units = buildShuffleUnits(ROSTER);
    const two = groupByTeam(shuffleIntoTeams(units, 2), 2);
    expect(two.map((g) => g.meta.label)).toEqual(["Red", "Blue"]);
    const three = groupByTeam(shuffleIntoTeams(units, 3), 3);
    expect(three.map((g) => g.meta.label)).toEqual(["Red", "Blue", "Green"]);
  });
});

describe("formatTeamsAsText", () => {
  it("formats as 'Red:\\n- A\\n\\nBlue:\\n- B'", () => {
    // Deterministic assignment (bypass the random shuffle) to assert text.
    const assignments = [
      { unitLabel: "Ivan", team: 0 as const },
      { unitLabel: "Pavel", team: 0 as const },
      { unitLabel: "Mark", team: 1 as const },
    ];
    const text = formatTeamsAsText(assignments, 2);
    expect(text).toBe("Red:\n- Ivan\n- Pavel\n\nBlue:\n- Mark");
  });

  it("includes Green only when teamCount is 3", () => {
    const assignments = [
      { unitLabel: "A", team: 0 as const },
      { unitLabel: "B", team: 1 as const },
      { unitLabel: "C", team: 2 as const },
    ];
    expect(formatTeamsAsText(assignments, 3)).toContain("Green:");
    expect(formatTeamsAsText(assignments, 2)).not.toContain("Green:");
  });
});
