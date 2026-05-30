/**
 * MODULE: match_lifecycle.application.auto-reject-pending-service
 * PURPOSE: Cron #3 (Layer 7b) — every 5 minutes. Find every match whose
 *          `start_time <= now` AND that still has pending JoinRequest rows;
 *          for each, under the match's advisory lock, mass-reject those
 *          pending rows with `auto_reason='match_started'`, fan-out the
 *          `rejected` notification with the canonical "match started"
 *          body, and wipe every Watch row on the match (primary cleanup —
 *          the InboxTtlService > 1-day safety net only catches what we
 *          miss here).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository,
 *                       WatchRepository, NotificationRepository
 *                       + shared/db/with-match-lock
 * CONSUMED BY: src/match_lifecycle/composition.ts, scripts/run-cron.ts (future)
 * INVARIANTS:
 *   - `run(now)` takes `now` as a method param (CLI runner uses `--now=ISO`
 *     for dry runs; production passes `new Date()`). No injected clock.
 *   - Each match processed in its OWN `withMatchLock` tx. After
 *     `start_time`, no live user-facing operation targets the match
 *     (Join/Approve/Reject/etc all return 409), so contention is only
 *     between cron retries / two cron instances. The lock keeps the
 *     write set atomic (massRejectPending + insertMany + deleteAllForMatch
 *     all see one consistent pre-image) and naturally idempotent: a second
 *     cron run finds zero pending rows under the lock and short-circuits.
 *   - **Race idempotency:** the cron's discovery query (`findMatchIdsWith
 *     PendingStartedBefore`) may surface a match that another cron run
 *     just finished processing. Inside the lock, `massRejectPending`
 *     returns `[]` for that match — we MUST skip the notification + watch
 *     wipe in that branch (the other run already did both). Driving every
 *     side-effect off `rejected.length > 0` keeps the cron exactly-once
 *     under retry even without per-cron deduplication state.
 *   - Notifications carry the FIXED `rejectedMatchStarted` body — never
 *     interpolated, mirrors every other notification fan-out in the
 *     codebase (spec global.md → "Notification text comes from body").
 *     No email for this type per spec match.md §294.
 *   - Watch wipe via `deleteAllForMatch` (NOT `notifyWatching`) — the
 *     match isn't "freeing a slot", it's ending. Watchers receive no
 *     `spot_opened` notification.
 *   - Captain has no pending JR on their own match (captain_cannot_join);
 *     no special-case to exclude.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Cron auto-reject
 *     pending on match start", "Reject / Kick / Leave flows → Pending
 *     lives until start_time", per-endpoint checklist row "Cron
 *     auto-reject pending"
 *   - docs/spec/pitchup-app-map.md → "Cron jobs" table
 */
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";
import type { NewNotification } from "@/src/notifications/domain/notification";
import type { NotificationRepository } from "@/src/notifications/domain/notification-repository";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import type { JoinRequestRepository } from "../domain/join-request-repository";
import type { MatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import type { WatchRepository } from "../domain/watch-repository";

export interface AutoRejectPendingResult {
  /** Matches surfaced by the discovery query. */
  readonly matchesScanned: number;
  /** Matches where at least one pending row was actually transitioned. */
  readonly matchesProcessed: number;
  /** Total pending → rejected transitions across all matches. */
  readonly pendingRejected: number;
  /** Total Watch rows wiped across all matches. */
  readonly watchesDeleted: number;
}

export class AutoRejectPendingService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async run(now: Date): Promise<AutoRejectPendingResult> {
    const matchIds =
      await this.matchRepository.findMatchIdsWithPendingStartedBefore(now);

    let matchesProcessed = 0;
    let pendingRejected = 0;
    let watchesDeleted = 0;

    for (const matchId of matchIds) {
      const perMatch = await this.processMatch(matchId);
      if (perMatch.rejected > 0) {
        matchesProcessed += 1;
        pendingRejected += perMatch.rejected;
        watchesDeleted += perMatch.watches;
      }
    }

    return {
      matchesScanned: matchIds.length,
      matchesProcessed,
      pendingRejected,
      watchesDeleted,
    };
  }

  private async processMatch(
    matchId: MatchId,
  ): Promise<{ rejected: number; watches: number }> {
    return withMatchLock(matchId, async (tx) => {
      const rejected = await this.joinRequestRepository.massRejectPending(
        matchId,
        "match_started",
        tx,
      );
      if (rejected.length === 0) return { rejected: 0, watches: 0 };

      const notifications: NewNotification[] = rejected.map((jr) => ({
        userId: jr.userId,
        type: "rejected" as const,
        matchId,
        body: NOTIFICATION_BODIES.rejectedMatchStarted,
      }));
      await this.notificationRepository.insertMany(notifications, tx);

      const watches = await this.watchRepository.deleteAllForMatch(matchId, tx);
      return { rejected: rejected.length, watches };
    });
  }
}
