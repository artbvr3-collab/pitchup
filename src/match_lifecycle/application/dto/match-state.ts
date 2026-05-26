/**
 * MODULE: match_lifecycle.application.dto.match-state
 * PURPOSE: Wire-shape DTOs for `GET /api/matches/:id/state?since=ISO`. Keys
 *          are snake_case to match the spec verbatim; the route handler
 *          returns this object verbatim (no extra serialisation layer).
 *          Status strings are also the spec's wire form (`Open`,
 *          `AlmostFull`, etc.) — the domain uses lowerCamel (`open`,
 *          `almostFull`); `toWireStatus()` maps between the two so the
 *          domain enum stays canonical and only one wire-form mapping
 *          exists.
 * LAYER: application (DTO)
 * DEPENDENCIES: ../../domain/match-status
 * CONSUMED BY: src/match_lifecycle/application/match-state-service.ts,
 *              app/api/matches/[id]/state/route.ts,
 *              app/matches/[id]/page.tsx (initial RSC snapshot — same shape
 *              hydrates the client islands).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Polling for match state" (§195-212)
 *   - docs/spec/pitchup-spec-global.md → "Polling sync"
 */
import type { MatchStatus } from "../../domain/match-status";

export type MatchStateWireStatus =
  | "Open"
  | "AlmostFull"
  | "Full"
  | "InProgress"
  | "Ended"
  | "Cancelled";

export function toWireStatus(status: MatchStatus): MatchStateWireStatus {
  switch (status) {
    case "open":
      return "Open";
    case "almostFull":
      return "AlmostFull";
    case "full":
      return "Full";
    case "inProgress":
      return "InProgress";
    case "ended":
      return "Ended";
    case "cancelled":
      return "Cancelled";
  }
}

/**
 * A single chat message in the polling payload. `deleted_at` is non-null
 * for soft-deleted messages — the UI renders the tombstone in place
 * (spec match.md §225). `author` is the embedded resolved User snapshot;
 * a null `author` happens when the user row is missing (deleted) — the UI
 * falls back to `[Removed user]`. Banned users surface `banned: true`
 * which the UI also collapses to `[Removed user]`.
 */
export interface MatchStateMessage {
  readonly id: string;
  readonly text: string;
  readonly created_at: string;
  readonly deleted_at: string | null;
  readonly author: MatchStateMessageAuthor | null;
}

export interface MatchStateMessageAuthor {
  readonly id: string;
  readonly name: string;
  readonly avatar_url: string;
  readonly banned: boolean;
}

/** One accepted player on the lineup (captain or accepted JoinRequest). */
export interface MatchStateLineupPlayer {
  readonly user: MatchStateMessageAuthor;
  /** 0..4 — anonymous +N companions occupying adjacent slots. */
  readonly guest_count: number;
}

/** One pending request (captain-only). */
export interface MatchStateLineupPending {
  readonly request_id: string;
  readonly user: MatchStateMessageAuthor;
  readonly guest_count: number;
  readonly message: string | null;
  readonly created_at: string;
}

export interface MatchStateLineup {
  readonly captain: MatchStateMessageAuthor;
  readonly accepted: readonly MatchStateLineupPlayer[];
  /** Captain-only — non-captains receive `[]`. */
  readonly pending: readonly MatchStateLineupPending[];
  /** Stub players from `match.captainCrew`. Strings only (no User row). */
  readonly crew: readonly string[];
  readonly watching_count: number;
}

export interface MatchStateResponse {
  readonly messages: readonly MatchStateMessage[];
  readonly lineup: MatchStateLineup;
  readonly status: MatchStateWireStatus;
  /** ISO timestamp for optimistic concurrency on `PATCH /matches/:id`. */
  readonly updated_at: string;
  /**
   * `true` when the match has been hard-deleted by admin between polls.
   * Frontend redirects to `/games`. Currently always `false` — admin
   * hard-delete is Layer 9; spec field included now to keep the contract
   * stable.
   */
  readonly deleted: boolean;
}
