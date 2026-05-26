/**
 * MODULE: tests.shared.time.prague
 * PURPOSE: Lock the canonical Prague-day ↔ UTC math against DST drift. The
 *          whole reason `prague_day` / `prague_range` exist is that a naive
 *          `BETWEEN utc_midnight AND utc_midnight + INTERVAL '24h'` silently
 *          loses or duplicates an hour on the two DST Sundays.
 * LAYER: tests / shared
 * TESTS FOR: src/shared/time/prague.ts
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Timezones & date ranges".
 */
import { describe, it, expect } from "vitest";

import {
  addPragueDays,
  asPragueDate,
  diffPragueDays,
  pragueDay,
  pragueHourOfDay,
  pragueRange,
  todayPrague,
} from "@/src/shared/time/prague";

const HOUR_MS = 3_600_000;

describe("pragueDay length across DST boundaries", () => {
  it("is 24h on a plain winter day", () => {
    const interval = pragueDay(asPragueDate("2026-01-15"));
    expect(interval.utcEnd.getTime() - interval.utcStart.getTime()).toBe(
      24 * HOUR_MS,
    );
  });

  it("is 24h on a plain summer day", () => {
    const interval = pragueDay(asPragueDate("2026-07-15"));
    expect(interval.utcEnd.getTime() - interval.utcStart.getTime()).toBe(
      24 * HOUR_MS,
    );
  });

  it("is 23h on the spring-forward Sunday (last Sunday of March 2026 = 2026-03-29)", () => {
    const interval = pragueDay(asPragueDate("2026-03-29"));
    expect(interval.utcEnd.getTime() - interval.utcStart.getTime()).toBe(
      23 * HOUR_MS,
    );
  });

  it("is 25h on the fall-back Sunday (last Sunday of October 2026 = 2026-10-25)", () => {
    const interval = pragueDay(asPragueDate("2026-10-25"));
    expect(interval.utcEnd.getTime() - interval.utcStart.getTime()).toBe(
      25 * HOUR_MS,
    );
  });

  it("utcStart of a Prague day reads as 00:00 when rendered back in Prague", () => {
    const interval = pragueDay(asPragueDate("2026-03-29"));
    expect(pragueHourOfDay(interval.utcStart)).toBe(0);
  });

  it("utcStart of a winter day equals 23:00 UTC the previous calendar day (Prague = UTC+1)", () => {
    const { utcStart } = pragueDay(asPragueDate("2026-01-15"));
    expect(utcStart.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("utcStart of a summer day equals 22:00 UTC the previous calendar day (Prague = UTC+2)", () => {
    const { utcStart } = pragueDay(asPragueDate("2026-07-15"));
    expect(utcStart.toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });
});

describe("pragueRange covers inclusive day ranges as a single half-open interval", () => {
  it("collapses a single-day range to one pragueDay()", () => {
    const date = asPragueDate("2026-05-26");
    const single = pragueDay(date);
    const range = pragueRange(date, date);
    expect(range.utcStart.toISOString()).toBe(single.utcStart.toISOString());
    expect(range.utcEnd.toISOString()).toBe(single.utcEnd.toISOString());
  });

  it("a 21-day horizon spans 21 days × 24h plus / minus DST adjustments", () => {
    // Pick a range crossing the spring-forward Sunday (2026-03-29).
    const start = asPragueDate("2026-03-20");
    const end = asPragueDate("2026-04-09"); // inclusive — 21 days
    const range = pragueRange(start, end);
    const hours = (range.utcEnd.getTime() - range.utcStart.getTime()) / HOUR_MS;
    expect(hours).toBe(21 * 24 - 1); // one hour lost on 2026-03-29
  });

  it("throws when end < start", () => {
    expect(() =>
      pragueRange(asPragueDate("2026-05-26"), asPragueDate("2026-05-25")),
    ).toThrow();
  });
});

describe("addPragueDays / diffPragueDays", () => {
  it("adds and subtracts whole days symmetrically", () => {
    const start = asPragueDate("2026-03-28");
    const plus3 = addPragueDays(start, 3);
    expect(plus3).toBe("2026-03-31");
    expect(diffPragueDays(start, plus3)).toBe(3);
  });

  it("crosses month boundaries cleanly", () => {
    expect(addPragueDays(asPragueDate("2026-01-31"), 1)).toBe("2026-02-01");
  });

  it("crosses the DST Sunday as a single calendar day", () => {
    // Calendar arithmetic is TZ-agnostic — DST does not change the day count.
    const before = asPragueDate("2026-03-28");
    const after = asPragueDate("2026-03-30");
    expect(diffPragueDays(before, after)).toBe(2);
  });
});

describe("todayPrague returns the Prague calendar date for any `now`", () => {
  it("returns the next-day Prague date when UTC is still on the previous date late at night", () => {
    // 2026-01-15T23:30 UTC is 2026-01-16T00:30 Prague (UTC+1).
    const now = new Date("2026-01-15T23:30:00Z");
    expect(todayPrague(now)).toBe("2026-01-16");
  });

  it("returns the same Prague date when UTC is mid-day", () => {
    expect(todayPrague(new Date("2026-05-26T10:00:00Z"))).toBe("2026-05-26");
  });
});
