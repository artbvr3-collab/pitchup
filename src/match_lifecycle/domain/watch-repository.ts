/**
 * MODULE: match_lifecycle.domain.watch-repository
 * PURPOSE: Port for "Notify me when a spot opens" subscriptions.
 *          - Layer 4: idempotent delete inside the Join/Approve transactions
 *            (a successful Join wipes the user's Watch for that match in the
 *            same tx; Approve does the same as a safety against a Watch race).
 *          - Layer 5: read-only `countForMatch` + `existsForUserAndMatch` for
 *            the polling lineup snapshot and the RSC viewer-role derivation.
 *          - Layer 6: full WRITE surface for POST/DELETE /watch +
 *            notify-watching one-shot:
 *              · `upsertForUserAndMatch` — INSERT ON CONFLICT DO NOTHING,
 *                returns outcome so the service can log "existed" without
 *                surfacing it to the client (idempotent re-subscribe).
 *              · `listForMatch` — collects user ids for the notification
 *                fan-out inside `notifyWatching`.
 *              · `deleteAllForMatch` — bulk delete of all Watch rows for a
 *                match in one statement; called by `notifyWatching` after
 *                the user-id list is captured.
 *              · `listMatchIdsForUser` — unlocked read used by
 *                `ListMyMatchesService` to find matches the user is
 *                watching (drives the `👀 Watching` cards in Section
 *                Upcoming).
 * LAYER: domain
 * DEPENDENCIES: ./match, src/auth/domain/user, src/shared/db/types
 * CONSUMED BY: src/match_lifecycle/application/{join,approve,leave,watch,
 *              unwatch,list-my-matches,notify-watching}-service,
 *              src/match_lifecycle/infrastructure/prisma-watch-repository
 * INVARIANTS:
 *   - `deleteForUserAndMatch` + `deleteAllForMatch` are idempotent: deleting
 *     non-existent rows is a no-op.
 *   - `upsertForUserAndMatch` is also idempotent — an existing row counts
 *     as success (`outcome: 'existed'`); the service maps both branches to
 *     `200 OK`.
 *   - `listForMatch` returns user ids in arbitrary order. Callers are
 *     responsible for any sort they need.
 *   - Spec: match.md → "Watching logic" → "What happens to the Watch record
 *     on Join", "notify watching (DRY sub-operation)", "Per-endpoint checklist"
 *     → POST /watch, DELETE /watch.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Watching logic", "Per-endpoint checklist"
 *   - ADR-0003
 */
import type { UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import type { MatchId } from "./match";

export type UpsertWatchOutcome = "inserted" | "existed";

export interface WatchRepository {
  /** Idempotent. No error if no row exists. */
  deleteForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
    tx: TransactionClient,
  ): Promise<void>;

  /**
   * Count of Watch rows for the given match. Unlocked read — used by the
   * polling state assembler to surface `watching_count`. Captain-facing UI
   * shows the number on the lineup tab; non-captain UI hides it. The poll
   * payload includes the count for everyone (cheap to send).
   */
  countForMatch(matchId: MatchId): Promise<number>;

  /**
   * True if the (match, user) pair has a Watch row. Used by the RSC
   * page-load path to derive the viewer's role (`watching` vs `none`).
   * Unlocked — viewer-role drives UI only; the Join transaction takes
   * the canonical lock and re-checks.
   */
  existsForUserAndMatch(matchId: MatchId, userId: UserId): Promise<boolean>;

  /**
   * INSERT ON CONFLICT DO NOTHING under the advisory lock. Returns
   * `inserted` on a fresh row, `existed` if the pair was already present
   * (idempotent re-subscribe). The service exposes both as `200 OK`.
   */
  upsertForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
    tx: TransactionClient,
  ): Promise<UpsertWatchOutcome>;

  /**
   * All user ids with a Watch row for the given match. Called by
   * `notifyWatching` to gather recipients before deletion. Returns ids in
   * arbitrary order. Caller invokes under the same advisory lock so that
   * the list captured here is consistent with the subsequent
   * `deleteAllForMatch`.
   */
  listForMatch(
    matchId: MatchId,
    tx: TransactionClient,
  ): Promise<readonly UserId[]>;

  /**
   * Bulk DELETE of every Watch row for the match in one statement. Returns
   * the number of rows removed (for logging). Called by `notifyWatching`
   * after `listForMatch`. Idempotent — zero rows is a normal outcome on a
   * non-full match where nobody was watching.
   */
  deleteAllForMatch(
    matchId: MatchId,
    tx: TransactionClient,
  ): Promise<number>;

  /**
   * Unlocked read — match ids the user has a Watch row on. Used by
   * `ListMyMatchesService` for /my-matches Section Upcoming (`👀 Watching`
   * cards). Returns ids in arbitrary order; caller joins with match rows
   * via `MatchRepository.findByIds`.
   */
  listMatchIdsForUser(userId: UserId): Promise<readonly MatchId[]>;

  /**
   * Inbox TTL cron (Layer 7b, 03:00 Europe/Prague) safety sweep: DELETE every
   * Watch row whose `match.start_time` is strictly less than `beforeStartTime`.
   * Returns deleted count.
   *
   * Primary Watch cleanup at match-start time lives in `AutoRejectPendingService`
   * (cron #3, every 5 min — drops Watch in the same batch as the pending
   * auto-reject per spec match.md §434). This method is the once-daily safety
   * net for the case where the 5-min cron is paused or skips a run.
   *
   * Unlocked — same rationale as `notifyWatching`'s `deleteAllForMatch`: cron
   * sweeps don't take the advisory lock (no per-match invariant to preserve;
   * the deleted rows are technical debris and no surviving user is reading
   * them — the match's `start_time` has passed by >24h).
   */
  deleteForMatchesStartingBefore(beforeStartTime: Date): Promise<number>;
}
