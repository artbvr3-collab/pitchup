/**
 * MODULE: match_lifecycle.application.discover-filters
 * PURPOSE: Canonical filter DTO + URL-param parser for the `/games` Discover
 *          feed and the `GET /api/matches/discover` route handler. Whitelist
 *          parsing — invalid values are silently dropped to defaults (spec:
 *          "Invalid query params fallback"), never thrown.
 * LAYER: application
 * DEPENDENCIES: zod, ../../shared/time/prague
 * CONSUMED BY: ./list-discover-matches.ts,
 *              app/(public)/games/page.tsx,
 *              app/api/matches/discover/route.ts
 * INVARIANTS:
 *   - All filter sources are validated via this single parser. No ad-hoc
 *     URLSearchParams reads in app/ or route handlers.
 *   - `date` outside `[today_prague(), today_prague() + 20]` (Prague TZ) or
 *     malformed → fallback to `today_prague(now)`. No 400.
 *   - Cursor decode failures → fallback to first page. No 400.
 *   - `distance` is always preserved in the parsed DTO even when location
 *     is missing — the repository / UI decides whether to honor it (per spec,
 *     the SSR list silently ignores `?distance` without location and the UI
 *     shows a banner).
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games" → "URL params"
 *               and "Invalid query params fallback".
 */
import { z } from "zod";

import {
  addPragueDays,
  asPragueDate,
  diffPragueDays,
  todayPrague,
  type PragueDate,
} from "@/src/shared/time/prague";

export type TimeOfDay = "morning" | "afternoon" | "evening";
export type SpotsBucket = "1" | "2-3" | "4+";
export type DistanceKm = 1 | 3 | 5 | 10;
export type GameSize = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface DiscoverFilters {
  /** Prague calendar day to display. Always set — defaults to today. */
  readonly date: PragueDate;
  /** Distance radius in km from saved location. `null` = Any. */
  readonly distanceKm: DistanceKm | null;
  /** Time-of-day buckets (OR within set). Empty = any time. */
  readonly timeOfDay: readonly TimeOfDay[];
  /** Game-size chips (OR within set). Empty = any size. */
  readonly gameSize: readonly GameSize[];
  /** Spots-left bucket. `null` = Any (includes full). */
  readonly spotsLeft: SpotsBucket | null;
  /** Free-only toggle. */
  readonly freeOnly: boolean;
  /** Field-booked-only toggle. */
  readonly fieldBookedOnly: boolean;
  /** Live venue-name substring search (ephemeral — not in URL). */
  readonly venueSearch: string;
  /** Page cursor; `null` = first page. */
  readonly cursor: DiscoverCursor | null;
}

export interface DiscoverCursor {
  /** Last seen `startTime` (UTC). */
  readonly startTime: Date;
  /** Last seen match id — breaks ties on identical startTime. */
  readonly id: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DISTANCE_VALUES: readonly DistanceKm[] = [1, 3, 5, 10];
const TIME_VALUES: readonly TimeOfDay[] = ["morning", "afternoon", "evening"];
const SPOTS_VALUES: readonly SpotsBucket[] = ["1", "2-3", "4+"];
const GAME_SIZE_VALUES: readonly GameSize[] = [4, 5, 6, 7, 8, 9, 10, 11];

const dateSchema = z
  .string()
  .regex(DATE_RE)
  .transform((value) => asPragueDate(value));

const distanceSchema = z
  .string()
  .transform((value) => {
    const n = Number(value);
    return DISTANCE_VALUES.includes(n as DistanceKm) ? (n as DistanceKm) : null;
  });

const csvTimeSchema = z
  .string()
  .transform((value) => parseCsv(value, TIME_VALUES, (v) => v as TimeOfDay));

const csvSizeSchema = z.string().transform((value) =>
  parseCsv(
    value,
    GAME_SIZE_VALUES.map(String),
    (v) => Number(v) as GameSize,
  ),
);

const spotsSchema = z
  .string()
  .transform((value) => {
    // URLSearchParams decodes "+" to " " — accept both forms so hand-typed
    // `?spots=4+` URLs survive in addition to the encoded `4%2B`. Replace
    // before trimming, because `.trim()` would eat the trailing space first.
    const normalised = value.replace(/\s/g, "+").trim();
    return SPOTS_VALUES.includes(normalised as SpotsBucket)
      ? (normalised as SpotsBucket)
      : null;
  });

const flagSchema = z
  .string()
  .transform((value) => value === "1");

const cursorSchema = z.string();

const rawSchema = z
  .object({
    date: dateSchema.optional(),
    distance: distanceSchema.optional(),
    time: csvTimeSchema.optional(),
    size: csvSizeSchema.optional(),
    spots: spotsSchema.optional(),
    free: flagSchema.optional(),
    booked: flagSchema.optional(),
    q: z.string().max(120).optional(),
    cursor: cursorSchema.optional(),
  })
  .catchall(z.unknown());

export interface ParseDiscoverFiltersOptions {
  /** Reference instant for clamping `date` to the 21-day horizon. */
  readonly now: Date;
}

/**
 * Parse a URL-ish input (URLSearchParams or plain key→value record). Always
 * succeeds — invalid values fall back to defaults per spec.
 */
export function parseDiscoverFilters(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
  options: ParseDiscoverFiltersOptions,
): DiscoverFilters {
  const flat = flattenInput(input);
  const parsed = rawSchema.safeParse(flat);
  // Schema can only fail on malformed `date` / `cursor` — both fall back
  // safely below, so we accept partial results when zod rejects a field.
  const data = parsed.success ? parsed.data : {};

  const today = todayPrague(options.now);
  const requestedDate = data.date;
  const clampedDate = clampDateToHorizon(requestedDate, today);

  return {
    date: clampedDate,
    distanceKm: data.distance ?? null,
    timeOfDay: data.time ?? [],
    gameSize: data.size ?? [],
    spotsLeft: data.spots ?? null,
    freeOnly: data.free ?? false,
    fieldBookedOnly: data.booked ?? false,
    venueSearch: typeof data.q === "string" ? data.q.trim() : "",
    cursor: decodeCursor(data.cursor),
  };
}

function flattenInput(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): Record<string, string> {
  if (input instanceof URLSearchParams) {
    const out: Record<string, string> = {};
    for (const [k, v] of input.entries()) out[k] = v;
    return out;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}

function clampDateToHorizon(
  requested: PragueDate | undefined,
  today: PragueDate,
): PragueDate {
  if (!requested) return today;
  const delta = diffPragueDays(today, requested);
  if (delta < 0 || delta > 20) return today;
  return requested;
}

function parseCsv<T>(
  raw: string,
  allowed: readonly string[],
  map: (value: string) => T,
): readonly T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (!allowed.includes(trimmed)) continue;
    seen.add(trimmed);
    out.push(map(trimmed));
  }
  return out;
}

/**
 * Cursor format: `base64url(JSON({s: ISO8601, i: matchId}))`. Compact, opaque
 * to clients, and round-trips through Server Component navigation and the
 * route handler unchanged.
 */
export function encodeCursor(cursor: DiscoverCursor): string {
  const payload = JSON.stringify({
    s: cursor.startTime.toISOString(),
    i: cursor.id,
  });
  return base64UrlEncode(payload);
}

export function decodeCursor(raw: string | undefined | null): DiscoverCursor | null {
  if (!raw) return null;
  try {
    const json = base64UrlDecode(raw);
    const data = JSON.parse(json) as { s?: unknown; i?: unknown };
    if (typeof data.s !== "string" || typeof data.i !== "string") return null;
    const startTime = new Date(data.s);
    if (Number.isNaN(startTime.getTime())) return null;
    return { startTime, id: data.i };
  } catch {
    return null;
  }
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

/**
 * Map a parsed DTO back to a URLSearchParams-compatible record — used by
 * client islands when rewriting the URL (e.g. day picker, filter sheet
 * Apply). Defaults are omitted so the URL stays clean.
 */
export function serializeDiscoverFilters(
  filters: DiscoverFilters,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Note: callers usually serialize date themselves when it's "today" should
  // be omitted; we include it unconditionally and let the caller strip.
  out.date = filters.date;
  if (filters.distanceKm !== null) out.distance = String(filters.distanceKm);
  if (filters.timeOfDay.length > 0) out.time = filters.timeOfDay.join(",");
  if (filters.gameSize.length > 0) out.size = filters.gameSize.join(",");
  if (filters.spotsLeft !== null) out.spots = filters.spotsLeft;
  if (filters.freeOnly) out.free = "1";
  if (filters.fieldBookedOnly) out.booked = "1";
  if (filters.cursor) out.cursor = encodeCursor(filters.cursor);
  return out;
}

/**
 * True iff any sheet filter (distance / time / size / spots / free / booked)
 * is active. Used by the `[⚙]` dot-badge and by the empty-state to decide
 * whether to surface `[Clear all filters]`.
 */
export function hasActiveSheetFilters(filters: DiscoverFilters): boolean {
  return (
    filters.distanceKm !== null ||
    filters.timeOfDay.length > 0 ||
    filters.gameSize.length > 0 ||
    filters.spotsLeft !== null ||
    filters.freeOnly ||
    filters.fieldBookedOnly
  );
}

/** The 21-day horizon defined by spec (today + 20 inclusive). */
export const DISCOVER_HORIZON_DAYS = 21;

/** Convenience: array of the 21 PragueDates starting from `today`. */
export function discoverHorizonDates(today: PragueDate): readonly PragueDate[] {
  const out: PragueDate[] = [];
  for (let i = 0; i < DISCOVER_HORIZON_DAYS; i++) {
    out.push(addPragueDays(today, i));
  }
  return out;
}
