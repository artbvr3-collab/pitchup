/**
 * MODULE: app.(public).games.discover-types
 * PURPOSE: Shared client/server types for the Discover page islands. Mirrors
 *          the `SerializedDiscoverRow` shape from the route handler so the
 *          Server Component, route handler, and client components agree on
 *          one wire format.
 * LAYER: interfaces (shared types — no runtime side effects)
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games".
 */
import type { MatchStatus } from "@/src/match_lifecycle/domain/match-status";
import type { Surface } from "@/src/match_lifecycle/domain/venue";

export interface DiscoverRow {
  readonly id: string;
  /** ISO-8601 UTC; render via Intl with `timeZone: "Europe/Prague"`. */
  readonly startTime: string;
  readonly duration: number;
  readonly surface: Surface;
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly price: number;
  readonly coverId: string;
  readonly venue: {
    readonly id: string;
    readonly name: string;
    readonly address: string;
    readonly photoUrl: string | null;
  };
  readonly slots: {
    readonly filled: number;
    readonly capacity: number;
    readonly free: number;
    readonly isFull: boolean;
  };
  readonly status: MatchStatus;
}

export interface DiscoverPagePayload {
  readonly rows: readonly DiscoverRow[];
  readonly nextCursor: string | null;
}

/**
 * Shape sent from the Server Component to the client shell. Echoes the
 * already-parsed URL filters so client islands (day picker, filter bar,
 * sheet) can render the current state without re-parsing.
 */
export interface DiscoverInitialState {
  readonly date: string; // PragueDate as YYYY-MM-DD
  readonly today: string; // PragueDate as YYYY-MM-DD
  readonly horizonDates: readonly string[]; // 21 PragueDates
  readonly distanceKm: 1 | 3 | 5 | 10 | null;
  readonly timeOfDay: readonly ("morning" | "afternoon" | "evening")[];
  readonly gameSize: readonly number[];
  readonly spotsLeft: "1" | "2-3" | "4+" | null;
  readonly freeOnly: boolean;
  readonly fieldBookedOnly: boolean;
  readonly page: DiscoverPagePayload;
}
