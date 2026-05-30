/**
 * MODULE: match_lifecycle.domain.derive-match-change
 * PURPOSE: Pure derivation of a single `matches_changed[]` entry for the global
 *          poll (`GET /api/updates/state`). Given the viewer's relationship to
 *          one match + the `since` cursor, decide whether anything changed in
 *          that window and, if so, which `action` + `my_status` to emit.
 *          Returns `null` when nothing changed (the match is skipped).
 *          Source of truth: spec global.md → "Polling sync" → "`action` — full
 *          enum" table (§410) + "`my_status`" table.
 * LAYER: domain (pure — no I/O)
 * DEPENDENCIES: ./join-request (status / auto-reason types), ./derive-my-status
 * CONSUMED BY: src/notifications/application/updates-state-service.ts
 * INVARIANTS:
 *   - Two change sources, checked in order:
 *       (A) the viewer's OWN JoinRequest transitioned (`updatedAt > since`) —
 *           drives requested / accepted / captain_rejected / match_started /
 *           match_cancelled(pending) / left / request_cancelled / kicked.
 *       (B) the MATCH row changed (`updatedAt > since`) AND the viewer is the
 *           captain or an accepted player — drives match_updated, or
 *           match_cancelled for accepted players (whose JoinRequest does NOT
 *           change on cancel — §401, the signal is `match.cancelledAt`).
 *     (A) takes precedence and returns early; in practice the two are mutually
 *     exclusive (approve/kick/leave touch join_request, edit/cancel touch the
 *     match row — never both for the same viewer).
 *   - `my_status` is computed via `deriveMyStatus` for every case EXCEPT
 *     `kicked`, which the on-read derivation collapses to `none`; the poll
 *     payload instead carries the UI-only `kicked` value to drive the
 *     Upcoming → Past card animation (spec §399 / §421).
 *   - Watching transitions are intentionally NOT emitted — a pure watcher is
 *     neither captain nor accepted (Step B skips) and has no active
 *     JoinRequest (Step A skips). spec §448.
 *   - `admin_deleted` (Layer 9) is out of scope here — it has no DB state to
 *     derive from and carries its own payload semantics.
 *   - Strict `> since` mirrors the notification cursor (`created_at > since`,
 *     spec §365). Boundary double-delivery is harmless: the client reaction is
 *     an idempotent `router.refresh()`.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Polling sync" (action enum,
 *     my_status table, "action → notification.type mapping")
 *   - docs/spec/pitchup-spec-match.md → cancel / edit flows
 */
import { deriveMyStatus, type MyStatus } from "./derive-my-status";
import type { JoinRequestAutoReason, JoinRequestStatus } from "./join-request";

/**
 * Closed set of `action` values the global poll emits. Most are produced by
 * `deriveMatchChange()` (which reads live DB state). `admin_deleted` is the
 * exception — it is NEVER returned by `deriveMatchChange`; instead
 * `UpdatesStateService` prepends it from the `admin_match_deletions` tombstone
 * table (Layer 9c). The union is here so the wire shape has one canonical type.
 */
export type MatchChangeAction =
  | "requested"
  | "request_cancelled"
  | "accepted"
  | "captain_rejected"
  | "match_started"
  | "match_cancelled"
  | "left"
  | "kicked"
  | "match_updated"
  | "admin_deleted";

/** Poll-payload `my_status` — the on-read enum plus the UI-only `kicked`. */
export type PollMyStatus = MyStatus | "kicked";

export interface MatchChangeInput {
  readonly matchId: string;
  readonly matchUpdatedAt: Date;
  readonly matchCancelledAt: Date | null;
  /** `true` when the viewer is the match captain. */
  readonly isCaptain: boolean;
  /** The viewer's own JoinRequest for this match, or `null` if none exists. */
  readonly joinRequest: {
    readonly status: JoinRequestStatus;
    readonly autoReason: JoinRequestAutoReason;
    readonly updatedAt: Date;
  } | null;
  /** `true` if a Watch row exists for this (match, viewer) pair. */
  readonly hasWatchRecord: boolean;
  /** Cursor of the previous successful poll. */
  readonly since: Date;
}

export interface MatchChange {
  readonly matchId: string;
  readonly action: MatchChangeAction;
  readonly myStatus: PollMyStatus;
}

export function deriveMatchChange(input: MatchChangeInput): MatchChange | null {
  const {
    matchId,
    matchUpdatedAt,
    matchCancelledAt,
    isCaptain,
    joinRequest,
    hasWatchRecord,
    since,
  } = input;

  const myStatus = deriveMyStatus({
    joinRequestStatus: joinRequest?.status ?? null,
    hasWatchRecord,
    matchCancelledAt,
  });

  // ---- Step A: the viewer's own JoinRequest transitioned in this window ----
  if (joinRequest && joinRequest.updatedAt > since) {
    switch (joinRequest.status) {
      case "pending":
        return { matchId, action: "requested", myStatus };
      case "accepted":
        // Approve+Cancel same-window race: if the match is now cancelled, the
        // cancel dominates — the card belongs in Past as "Match cancelled", not
        // an "accepted" animation. `myStatus` is already `cancelled` here
        // (deriveMyStatus hoists accepted + cancelledAt → cancelled), so we only
        // need to correct the action.
        return matchCancelledAt !== null
          ? { matchId, action: "match_cancelled", myStatus }
          : { matchId, action: "accepted", myStatus };
      case "rejected":
        return {
          matchId,
          action:
            joinRequest.autoReason === "match_cancelled"
              ? "match_cancelled"
              : joinRequest.autoReason === "match_started"
                ? "match_started"
                : "captain_rejected",
          myStatus,
        };
      case "left":
        return { matchId, action: "left", myStatus };
      case "cancelled":
        return { matchId, action: "request_cancelled", myStatus };
      case "kicked":
        return { matchId, action: "kicked", myStatus: "kicked" };
    }
  }

  // ---- Step B: the match row changed; only captain / accepted care ----
  const caresAboutMatchChange =
    isCaptain || joinRequest?.status === "accepted";
  if (caresAboutMatchChange && matchUpdatedAt > since) {
    if (matchCancelledAt !== null) {
      return { matchId, action: "match_cancelled", myStatus };
    }
    return { matchId, action: "match_updated", myStatus };
  }

  return null;
}
