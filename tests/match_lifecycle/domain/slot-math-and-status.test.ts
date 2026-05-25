/**
 * MODULE: tests.match_lifecycle.domain.slot-math-and-status
 * PURPOSE: Unit tests for the two canonical pure functions of the match
 *          domain: computeSlots() and deriveMatchStatus(). These are the
 *          single source of truth for the entire app — every other layer
 *          calls them rather than re-implementing the math.
 * LAYER: tests / domain
 * TESTS FOR: src/match_lifecycle/domain/slot-math.ts
 *            src/match_lifecycle/domain/match-status.ts
 * MOCKS: none — both functions are pure.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Slot math",
 *               docs/spec/pitchup-spec-match.md → "Match states".
 */
import { describe, it, expect } from "vitest";

import { computeSlots } from "@/src/match_lifecycle/domain/slot-math";
import { deriveMatchStatus } from "@/src/match_lifecycle/domain/match-status";

const NOW = new Date("2026-05-26T12:00:00.000Z");

describe("computeSlots", () => {
  it("captain alone, no crew, no accepted requests → filled = 1", () => {
    const slots = computeSlots({ totalSpots: 14, captainCrew: [] }, 0);
    expect(slots).toEqual({
      filled: 1,
      capacity: 14,
      free: 13,
      isFull: false,
    });
  });

  it("captain + 3 stub players + 2 accepted slots → filled = 6", () => {
    const slots = computeSlots(
      { totalSpots: 10, captainCrew: ["Tom", "Dick", "Harry"] },
      2,
    );
    expect(slots.filled).toBe(6);
    expect(slots.free).toBe(4);
    expect(slots.isFull).toBe(false);
  });

  it("exactly capacity → isFull true, free 0", () => {
    const slots = computeSlots(
      { totalSpots: 10, captainCrew: ["a", "b", "c"] },
      6, // 1 + 3 + 6 = 10
    );
    expect(slots.filled).toBe(10);
    expect(slots.free).toBe(0);
    expect(slots.isFull).toBe(true);
  });

  it("over-capacity (captain reduced totalSpots) → free clamps to 0, isFull true", () => {
    const slots = computeSlots(
      { totalSpots: 8, captainCrew: ["a", "b", "c", "d"] },
      6, // 1 + 4 + 6 = 11 > 8
    );
    expect(slots.filled).toBe(11);
    expect(slots.free).toBe(0);
    expect(slots.isFull).toBe(true);
  });

  it("default acceptedSlots = 0", () => {
    const slots = computeSlots({ totalSpots: 10, captainCrew: ["a", "b"] });
    expect(slots.filled).toBe(3);
    expect(slots.free).toBe(7);
  });
});

describe("deriveMatchStatus", () => {
  // Helper: open-slot info (free > 2)
  const openSlots = { filled: 5, capacity: 14, free: 9, isFull: false };
  const almostFullSlots = { filled: 12, capacity: 14, free: 2, isFull: false };
  const fullSlots = { filled: 14, capacity: 14, free: 0, isFull: true };

  it("cancelledAt set → cancelled (wins over time + slots)", () => {
    // Match is also "ended" by time and "full" by slots — cancelled still wins.
    const status = deriveMatchStatus(
      {
        startTime: new Date("2026-05-20T17:00:00.000Z"),
        duration: 90,
        cancelledAt: new Date("2026-05-21T10:00:00.000Z"),
      },
      fullSlots,
      NOW,
    );
    expect(status).toBe("cancelled");
  });

  it("now > startTime + duration → ended (wins over inProgress / slot states)", () => {
    const status = deriveMatchStatus(
      {
        startTime: new Date("2026-05-26T09:00:00.000Z"),
        duration: 90, // ends at 10:30
        cancelledAt: null,
      },
      openSlots,
      NOW, // 12:00 > 10:30
    );
    expect(status).toBe("ended");
  });

  it("now in [startTime, end) → inProgress", () => {
    const status = deriveMatchStatus(
      {
        startTime: new Date("2026-05-26T11:30:00.000Z"),
        duration: 90, // ends at 13:00
        cancelledAt: null,
      },
      fullSlots,
      NOW, // 12:00
    );
    expect(status).toBe("inProgress");
  });

  it("pre-game + free = 0 → full", () => {
    const status = deriveMatchStatus(
      {
        startTime: new Date("2026-05-27T18:00:00.000Z"),
        duration: 90,
        cancelledAt: null,
      },
      fullSlots,
      NOW,
    );
    expect(status).toBe("full");
  });

  it("pre-game + free = 1 → almostFull", () => {
    const status = deriveMatchStatus(
      { startTime: new Date("2026-05-27T18:00:00.000Z"), duration: 90, cancelledAt: null },
      { filled: 13, capacity: 14, free: 1, isFull: false },
      NOW,
    );
    expect(status).toBe("almostFull");
  });

  it("pre-game + free = 2 → almostFull (inclusive threshold)", () => {
    const status = deriveMatchStatus(
      { startTime: new Date("2026-05-27T18:00:00.000Z"), duration: 90, cancelledAt: null },
      almostFullSlots,
      NOW,
    );
    expect(status).toBe("almostFull");
  });

  it("pre-game + free = 3 → open", () => {
    const status = deriveMatchStatus(
      { startTime: new Date("2026-05-27T18:00:00.000Z"), duration: 90, cancelledAt: null },
      { filled: 11, capacity: 14, free: 3, isFull: false },
      NOW,
    );
    expect(status).toBe("open");
  });

  it("now exactly at startTime → inProgress (boundary, >=)", () => {
    const start = new Date("2026-05-26T12:00:00.000Z");
    const status = deriveMatchStatus(
      { startTime: start, duration: 90, cancelledAt: null },
      openSlots,
      NOW, // equal to start
    );
    expect(status).toBe("inProgress");
  });

  it("now exactly at end (start + duration) → ended (boundary, >=)", () => {
    const start = new Date("2026-05-26T10:30:00.000Z"); // ends at 12:00
    const status = deriveMatchStatus(
      { startTime: start, duration: 90, cancelledAt: null },
      openSlots,
      NOW,
    );
    expect(status).toBe("ended");
  });
});
