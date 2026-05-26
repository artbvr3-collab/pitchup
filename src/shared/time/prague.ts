/**
 * MODULE: shared.time.prague
 * PURPOSE: Canonical Prague-day ↔ UTC conversion primitives. Every "by day"
 *          query, picker bound, and horizon defined in the spec funnels
 *          through these — never inline `BETWEEN start_of_day_utc AND
 *          start_of_day_utc + INTERVAL '24h'`, which silently drops or
 *          duplicates an hour on DST Sundays.
 * LAYER: shared (pure utility)
 * DEPENDENCIES: none (uses `Intl.DateTimeFormat` from the stdlib)
 * CONSUMED BY: src/match_lifecycle/application/list-discover-matches.ts,
 *              src/match_lifecycle/infrastructure/prisma-match-repository.ts,
 *              app/(public)/games/* (DayPicker, FilterBar)
 * INVARIANTS:
 *   - `prague_day(d)` length ∈ {23h, 24h, 25h}: 23h on the spring-forward
 *     Sunday (last Sun of March), 25h on the fall-back Sunday (last Sun of
 *     October), 24h otherwise.
 *   - `today_prague()` returns the wall-clock date in Europe/Prague, NOT the
 *     UTC date — server-locale must not leak into the answer.
 *   - All helpers are pure. No `Date.now()` reads — callers pass `now` in.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Timezones & date ranges".
 */

const PRAGUE_TZ = "Europe/Prague";

const partFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PRAGUE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

interface PragueParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** A Prague calendar date as `YYYY-MM-DD` (no timestamp component). */
export type PragueDate = string & { readonly __pragueDateBrand: void };

function getPragueParts(instant: Date): PragueParts {
  const parts = partFormatter.formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    // Intl uses "24" for midnight at start of next day in some hour12=false
    // implementations; normalise to 0..23 to stay sane downstream.
    hour: Number(lookup.hour) % 24,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function asPragueDate(value: string): PragueDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid PragueDate: ${value}`);
  }
  return value as PragueDate;
}

/**
 * The current calendar date in Europe/Prague at the given `now` instant.
 * Returns `YYYY-MM-DD`, never a timestamp.
 */
export function todayPrague(now: Date): PragueDate {
  const parts = getPragueParts(now);
  return asPragueDate(
    `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`,
  );
}

/**
 * Shift a Prague calendar date by N days (positive or negative). Pure date
 * arithmetic — no TZ involved, just calendar math.
 */
export function addPragueDays(date: PragueDate, days: number): PragueDate {
  const [y, m, d] = date.split("-").map(Number);
  // Use UTC to avoid local-TZ midnight quirks; only the date components are
  // read back, never the time.
  const t = Date.UTC(y!, m! - 1, d! + days);
  const next = new Date(t);
  return asPragueDate(
    `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`,
  );
}

/** Inclusive day-difference in Prague calendar days (date2 - date1). */
export function diffPragueDays(date1: PragueDate, date2: PragueDate): number {
  const [y1, m1, d1] = date1.split("-").map(Number);
  const [y2, m2, d2] = date2.split("-").map(Number);
  const ms1 = Date.UTC(y1!, m1! - 1, d1!);
  const ms2 = Date.UTC(y2!, m2! - 1, d2!);
  return Math.round((ms2 - ms1) / 86_400_000);
}

/**
 * Resolve `midnight(date, Europe/Prague)` as a UTC instant — i.e. the UTC
 * timestamp that, when rendered in Prague, reads 00:00 on the given date.
 *
 * Algorithm: guess UTC midnight; observe what that instant renders as in
 * Prague; correct the guess by the observed offset. Two iterations are
 * enough — the first lands within ±1h (Prague is always UTC+1 or +2), the
 * second pins it exactly even across DST boundaries.
 */
function pragueMidnightAsUtc(date: PragueDate): Date {
  const [y, m, d] = date.split("-").map(Number);

  let guess = new Date(Date.UTC(y!, m! - 1, d!));
  for (let i = 0; i < 3; i++) {
    const parts = getPragueParts(guess);
    // Total seconds-of-day in Prague for this instant.
    const observedSecondsOfDay =
      parts.hour * 3600 + parts.minute * 60 + parts.second;
    // Day delta (Prague date vs target date) in days.
    const observedDate = asPragueDate(
      `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`,
    );
    const dayDelta = diffPragueDays(observedDate, date);
    // We want Prague to read 00:00:00 — adjust by the observed wall-clock
    // offset, plus any whole-day delta.
    if (dayDelta === 0 && observedSecondsOfDay === 0) return guess;
    guess = new Date(
      guess.getTime() + dayDelta * 86_400_000 - observedSecondsOfDay * 1000,
    );
  }
  return guess;
}

export interface PragueDayInterval {
  /** Inclusive UTC start: midnight in Prague on `date`. */
  readonly utcStart: Date;
  /** Exclusive UTC end: midnight in Prague on `date + 1`. */
  readonly utcEnd: Date;
}

/**
 * Half-open UTC interval `[utcStart, utcEnd)` covering one Prague calendar
 * day. Length varies on DST Sundays (23h / 25h); always 24h otherwise.
 */
export function pragueDay(date: PragueDate): PragueDayInterval {
  return {
    utcStart: pragueMidnightAsUtc(date),
    utcEnd: pragueMidnightAsUtc(addPragueDays(date, 1)),
  };
}

/**
 * Inclusive Prague-day range as a single half-open UTC interval. Used for
 * the 21-day horizon (`prague_range(today, today+20)`).
 */
export function pragueRange(
  start: PragueDate,
  end: PragueDate,
): PragueDayInterval {
  if (diffPragueDays(start, end) < 0) {
    throw new Error(`pragueRange: end (${end}) < start (${start})`);
  }
  return {
    utcStart: pragueMidnightAsUtc(start),
    utcEnd: pragueMidnightAsUtc(addPragueDays(end, 1)),
  };
}

/** Hour-of-day (0..23) in Europe/Prague for the given UTC instant. */
export function pragueHourOfDay(instant: Date): number {
  return getPragueParts(instant).hour;
}
