/**
 * TESTS FOR: src/match_lifecycle/domain/covers.ts
 * COVERAGE: the deterministic default formula (spec global.md → "Cover venue")
 *           + slug membership.
 */
import { describe, expect, it } from "vitest";

import {
  COVER_IDS,
  defaultCoverIdForVenue,
  isValidCoverId,
} from "@/src/match_lifecycle/domain/covers";

describe("isValidCoverId", () => {
  it("accepts known palette slugs and rejects everything else", () => {
    expect(isValidCoverId("cover-001")).toBe(true);
    expect(isValidCoverId(COVER_IDS[COVER_IDS.length - 1]!)).toBe(true);
    expect(isValidCoverId("cover-999")).toBe(false);
    expect(isValidCoverId("cover-default")).toBe(false);
    expect(isValidCoverId("")).toBe(false);
  });
});

describe("defaultCoverIdForVenue", () => {
  it("applies covers[int(hex(id[:8])) % len] from the spec formula", () => {
    // hex 00000000 → 0 → index 0
    expect(defaultCoverIdForVenue("00000000-0000-0000-0000-000000000000")).toBe(
      COVER_IDS[0],
    );
    // hex 0000000b → 11 → index 11 % 12 = 11
    expect(defaultCoverIdForVenue("0000000b-1111-2222-3333-444444444444")).toBe(
      COVER_IDS[11 % COVER_IDS.length],
    );
    // hex 0000000c → 12 → wraps to index 0
    expect(defaultCoverIdForVenue("0000000c-1111-2222-3333-444444444444")).toBe(
      COVER_IDS[12 % COVER_IDS.length],
    );
  });

  it("is deterministic — same id always yields the same cover", () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef0123456789";
    expect(defaultCoverIdForVenue(id)).toBe(defaultCoverIdForVenue(id));
  });

  it("always returns a valid palette slug", () => {
    for (const id of [
      "ffffffff-0000-0000-0000-000000000000",
      "deadbeef-0000-0000-0000-000000000000",
      "12345678-0000-0000-0000-000000000000",
    ]) {
      expect(isValidCoverId(defaultCoverIdForVenue(id))).toBe(true);
    }
  });

  it("works with or without dashes (replaceAll normalises)", () => {
    expect(defaultCoverIdForVenue("0000000b1111222233334444")).toBe(
      defaultCoverIdForVenue("0000000b-1111-2222-3333-444444444444"),
    );
  });
});
