/**
 * MODULE: match_lifecycle.application.leave-match-service
 * PURPOSE: Use case — accepted player leaves a live match. Implements
 *          `POST /api/matches/:id/leave`: under advisory lock → match-live
 *          check → join-request-is-accepted check → UPDATE JR.status='left'
 *          → invoke `notifyWatching` (one-shot push + bulk DELETE of Watch
 *          rows iff `isFull` flips true → false).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository, WatchRepository,
 *                       NotificationRepository (passed through to notifyWatching)
 *                       + notifyWatching helper + withMatchLock
 * CONSUMED BY: app/api/matches/[id]/leave/route.ts
 * INVARIANTS:
 *   - Status is UPDATE → `left` (NOT DELETE). UNIQUE(match_id, user_id) is
 *     preserved so re-apply works via the UPSERT path in JoinService
 *     (spec match.md → "Player match states"). The row stays in DB and
 *     renders in `/my-matches → Section Past` as "You left" (sub-label
 *     reads `JoinRequest.status` directly).
 *   - The freed slot count = `1 + guestCount` of the leaving JR row. Guests
 *     cannot be removed individually (spec global.md → "Guests (+N on
 *     join)"). The helper `freedSlots` keeps this explicit.
 *   - notifyWatching runs in the SAME transaction. Spec race-matrix
 *     "Leave/Kick + watching-notify" — atomic.
 *   - `triggeredByCaptain: false` — captain DOES receive the in-app push
 *     ("A spot opened up") because the user left on their own and the
 *     captain didn't initiate the slot release (spec → "notify watching"
 *     captain self-trigger skip rule).
 *   - Match must be live. After start_time the row stays as `accepted`
 *     forever; players are considered to have played (spec → "Reject /
 *     Kick / Leave flows" → "The captain cannot leave a match").
 *   - 404 NotInMatchError covers both "no JR row" and "JR row not accepted"
 *     (left, kicked, rejected, cancelled, pending). The frontend treats
 *     404 as success-no-op (spec → "Idempotency").
 * NOTE (Layer 7 — Notifications):
 *   - `spot_opened` inserts for watching players + the captain (Leave is a
 *     player-initiated free, so the captain IS notified) live inside
 *     `notifyWatching`; this service passes the NotificationRepository through.
 *   - The `leave_reason` field captured in the Leave-flow modal (radio:
 *     "Can't make it" / "Injury" / "Personal reasons" / "Other") is NOT
 *     persisted yet — `JoinRequest` has no `leave_reason` column. Adding
 *     it is a v1.1 candidate; for now the reason is captured in the inbox
 *     `notification.body` only (Layer 7).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Leave flow", "Per-endpoint
 *     checklist" → POST /leave, "Race scenarios — resolution matrix"
 *   - docs/spec/pitchup-spec-global.md → "Guests (+N on join)"
 */
import { asUserId } from "@/src/auth/domain/user";
import type { NotificationRepository } from "@/src/notifications/domain/notification-repository";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  MatchLockedError,
  MatchNotFoundError,
  NotInMatchError,
} from "../domain/errors";
import type { JoinRequest } from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type { WatchRepository } from "../domain/watch-repository";
import { freedSlots, notifyWatching } from "./notify-watching";

export interface LeaveMatchInput {
  readonly matchId: string;
  readonly userId: string;
}

export interface LeaveMatchResult {
  readonly status: "left";
  /** Number of watcher inboxes that received the spot_opened push. */
  readonly notifiedWatcherCount: number;
}

export class LeaveMatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async execute(
    input: LeaveMatchInput,
    now: Date,
  ): Promise<LeaveMatchResult> {
    const matchId = asMatchId(input.matchId);
    const userId = asUserId(input.userId);

    return withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      const request = await this.joinRequestRepository.findByMatchAndUser(
        matchId,
        userId,
        tx,
      );
      if (!request || request.status !== "accepted") {
        throw new NotInMatchError({ matchId, userId });
      }

      // Match must be live. Compute slots-before with current accepted set.
      const acceptedBefore =
        await this.joinRequestRepository.listAcceptedForMatch(matchId, tx);
      const acceptedSlotsBefore = sumAcceptedSlots(acceptedBefore);
      const slotsBefore = computeSlots(match, acceptedSlotsBefore);
      const status = deriveMatchStatus(match, slotsBefore, now);
      if (status !== "open" && status !== "almostFull" && status !== "full") {
        throw new MatchLockedError({ matchId, status });
      }

      // Flip accepted → left. Slot count drops by (1 + guestCount).
      await this.joinRequestRepository.updateStatus(
        request.id,
        "left",
        null,
        tx,
      );

      const acceptedSlotsAfter =
        acceptedSlotsBefore - freedSlots(request.guestCount);
      const slotsAfter = computeSlots(match, acceptedSlotsAfter);

      const watch = await notifyWatching(
        {
          watchRepository: this.watchRepository,
          notificationRepository: this.notificationRepository,
        },
        {
          matchId,
          slotsBefore,
          slotsAfter,
          captainId: match.captainId,
          triggeredByCaptain: false,
          tx,
        },
      );

      return {
        status: "left" as const,
        notifiedWatcherCount: watch.watcherUserIds.length,
      };
    });
  }
}

function sumAcceptedSlots(requests: readonly JoinRequest[]): number {
  let total = 0;
  for (const r of requests) total += 1 + r.guestCount;
  return total;
}
