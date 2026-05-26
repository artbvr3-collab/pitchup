/**
 * MODULE: tests.match_lifecycle.application.discover-filters
 * PURPOSE: Lock the URL-param contract for `/games`. Every "Invalid query
 *          params fallback" rule and "Apply / Reset behavior" rule in the
 *          spec is enforced here so a UI regression can't sneak past.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/discover-filters.ts
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games" → URL params,
 *               "Invalid query params fallback".
 */
import { describe, it, expect } from "vitest";

import {
  decodeCursor,
  discoverHorizonDates,
  encodeCursor,
  hasActiveSheetFilters,
  parseDiscoverFilters,
  serializeDiscoverFilters,
} from "@/src/match_lifecycle/application/discover-filters";

const NOW = new Date("2026-05-26T10:00:00Z"); // Prague: 2026-05-26 (UTC+2)

function parse(qs: string) {
  return parseDiscoverFilters(new URLSearchParams(qs), { now: NOW });
}

describe("parseDiscoverFilters: defaults", () => {
  it("returns today (Prague) + no filters when querystring is empty", () => {
    const f = parse("");
    expect(f.date).toBe("2026-05-26");
    expect(f.distanceKm).toBeNull();
    expect(f.timeOfDay).toEqual([]);
    expect(f.gameSize).toEqual([]);
    expect(f.spotsLeft).toBeNull();
    expect(f.freeOnly).toBe(false);
    expect(f.fieldBookedOnly).toBe(false);
    expect(f.venueSearch).toBe("");
    expect(f.cursor).toBeNull();
  });
});

describe("parseDiscoverFilters: date clamp to 21-day horizon", () => {
  it("accepts a date within the horizon", () => {
    expect(parse("date=2026-06-05").date).toBe("2026-06-05"); // today + 10
  });

  it("falls back to today when date is in the past", () => {
    expect(parse("date=2026-05-25").date).toBe("2026-05-26");
  });

  it("falls back to today when date is beyond +20 days", () => {
    expect(parse("date=2026-06-16").date).toBe("2026-05-26");
  });

  it("falls back to today when date is malformed", () => {
    expect(parse("date=not-a-date").date).toBe("2026-05-26");
  });
});

describe("parseDiscoverFilters: whitelist values", () => {
  it("accepts the documented distance radio values", () => {
    for (const km of [1, 3, 5, 10]) {
      expect(parse(`distance=${km}`).distanceKm).toBe(km);
    }
  });

  it("drops unknown distance values", () => {
    expect(parse("distance=2").distanceKm).toBeNull();
    expect(parse("distance=foo").distanceKm).toBeNull();
  });

  it("parses CSV time-of-day in order, ignoring duplicates and bad tokens", () => {
    const f = parse("time=morning,foo,evening,morning");
    expect(f.timeOfDay).toEqual(["morning", "evening"]);
  });

  it("parses CSV game sizes, ignoring out-of-range tokens", () => {
    const f = parse("size=4,7,12,11");
    expect(f.gameSize).toEqual([4, 7, 11]);
  });

  it("parses spots bucket and drops unknown values", () => {
    expect(parse("spots=1").spotsLeft).toBe("1");
    expect(parse("spots=2-3").spotsLeft).toBe("2-3");
    expect(parse("spots=4+").spotsLeft).toBe("4+");
    expect(parse("spots=7").spotsLeft).toBeNull();
  });

  it("treats free=1 / booked=1 as true; anything else as false", () => {
    expect(parse("free=1").freeOnly).toBe(true);
    expect(parse("free=true").freeOnly).toBe(false);
    expect(parse("booked=1").fieldBookedOnly).toBe(true);
  });

  it("trims venueSearch but preserves user text", () => {
    expect(parse("q=  letn%C3%A1  ").venueSearch).toBe("letná");
  });
});

describe("hasActiveSheetFilters", () => {
  it("is false when no sheet filter is set", () => {
    expect(hasActiveSheetFilters(parse("date=2026-05-30"))).toBe(false);
  });

  it("is true when any sheet filter is set", () => {
    expect(hasActiveSheetFilters(parse("free=1"))).toBe(true);
    expect(hasActiveSheetFilters(parse("size=7"))).toBe(true);
    expect(hasActiveSheetFilters(parse("time=evening"))).toBe(true);
  });
});

describe("cursor encode / decode", () => {
  it("round-trips a cursor through base64url", () => {
    const cursor = {
      startTime: new Date("2026-05-27T18:00:00Z"),
      id: "11111111-2222-3333-4444-555555555555",
    };
    const enc = encodeCursor(cursor);
    expect(enc).not.toMatch(/[+/=]/);
    const dec = decodeCursor(enc);
    expect(dec).toEqual(cursor);
  });

  it("returns null for malformed cursors instead of throwing", () => {
    expect(decodeCursor("not-base64")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe("serializeDiscoverFilters", () => {
  it("omits defaults but always emits the date", () => {
    const flat = serializeDiscoverFilters(parse(""));
    expect(flat).toEqual({ date: "2026-05-26" });
  });

  it("emits each set filter with its canonical key", () => {
    const flat = serializeDiscoverFilters(
      parse("distance=3&time=morning,evening&size=5,7&spots=2-3&free=1&booked=1"),
    );
    expect(flat).toMatchObject({
      distance: "3",
      time: "morning,evening",
      size: "5,7",
      spots: "2-3",
      free: "1",
      booked: "1",
    });
  });
});

describe("discoverHorizonDates", () => {
  it("returns 21 sequential Prague dates starting at today", () => {
    const dates = discoverHorizonDates("2026-05-26" as never);
    expect(dates).toHaveLength(21);
    expect(dates[0]).toBe("2026-05-26");
    expect(dates[20]).toBe("2026-06-15");
  });
});
