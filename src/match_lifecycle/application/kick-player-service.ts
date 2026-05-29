/**
 * MODULE: match_lifecycle.application.kick-player-service
 * PURPOSE: Use case — captain removes an accepted player from their match.
 *          Implements `POST /api/matches/:id/kick`: under advisory lock →
 *          captain check → request-exists / belongs-to-match check →
 *          status='accepted' check → live-status check → UPDATE
 *          JR.status='kicked' → `notifyWatching(triggeredByCaptain=true)`.
 *          The kicked player surfaces in `/my-matches → Section Past` as
 *          "You were removed" via the Layer 6 sub-label code path (reads
 *          `JoinRequest.status` directly).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository, WatchRepository
 *                       + notifyWatching helper + withMatchLock
 * CONSUMED BY: app/api/matches/[id]/kick/route.ts
 * INVARIANTS:
 *   - Captain-only. The handler resolves the calling user; the service
 *     verifies that user IS the captain — `NotCaptainError 403`. The kicked
 *     player is identified by `requestId` (mirrors Approve / Reject), NOT by
 *     userId — kicking by userId would race with re-applies. The
 *     `request.matchId === matchId` cross-match guard collapses to 404 so a
 *     direct curl with a stale request id from a different match cannot
 *     escalate into a NotCaptain-on-wrong-match disclosure.
 *   - Status is UPDATE → `kicked` (NOT DELETE). UNIQUE(match_id, user_id) is
 *     preserved so the player can re-apply via the UPSERT path in
 *     JoinService. The row stays in DB and renders in `/my-matches → Section
 *     Past` as "You were removed" (sub-label reads `JoinRequest.status`).
 *   - The freed slot count = `1 + guestCount` of the kicked JR row (guests
 *     ride with their host — spec global.md "Guests"). Captain cannot trim
 *     guests separately; that requires Approve→Kick→re-Approve workflow.
 *   - notifyWatching runs in the SAME transaction (atomic with the kick).
 *     `triggeredByCaptain: true` — the captain self-trigger skip rule from
 *     spec match.md "notify watching" step 4 applies: the captain does NOT
 *     receive a self-push for an action they initiated. Watching players
 *     always get the push regardless of trigger.
 *   - Match must be live (Open/AlmostFull/Full). After `start_time` the
 *     match is considered played — spec §292 makes Kick unavailable; the UI
 *     hides the button via the CTA cascade, the 409 covers direct curls.
 *   - 404 NotInMatchError when the JR is absent OR not accepted (e.g. user
 *     left a moment earlier — race "Leave + Kick" in spec matrix). The
 *     frontend treats both 404 outcomes as success-no-op (the desired state
 *     "player not on roster" is already true). Spec match.md "Idempotency".
 * NOTE (Layer 7 — Notifications):
 *   - Inserts `notification(type='kicked', body="You were removed from the
 *     match")` for request.userId INSIDE the same `tx` (spec "Write
 *     ordering"). Watcher / captain spot_opened fan-out is handled by
 *     `notifyWatching` (port passed through the ports object).
 *   - Email to the kicked player (Kick is on the email allowlist) is deferred
 *     to Layer 7b (EmailSender port) — TODO(Layer 7b) marker in the body.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Reject / Kick / Leave flows",
 *     "Per-endpoint checklist" → POST /kick, "Race scenarios — resolution
 *     matrix" → "Leave + Kick", "notify watching"
 *   - docs/spec/pitchup-spec-global.md → "Guests (+N on join)",
 *     "Notifications" (email allowlist)
 */
import { asUserId } from "@/src/auth/domain/user";
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";
import type { NotificationRepository } from "@/src/notifications/domain/notification-repository";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  MatchLockedError,
  MatchNotFoundError,
  NotCaptainError,
  NotInMatchError,
  RequestNotFoundError,
} from "../domain/errors";
import { asJoinRequestId, type JoinRequest } from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type { WatchRepository } from "../domain/watch-repository";
import { freedSlots, notifyWatching } from "./notify-watching";

export interface KickPlayerInput {
  readonly matchId: string;
  readonly captainId: string;
  readonly requestId: string;
}

export interface KickPlayerResult {
  readonly status: "kicked";
  /** Number of watcher inboxes that received the spot_opened push. */
  readonly notifiedWatcherCount: number;
}

export class KickPlayerService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async execute(
    input: KickPlayerInput,
    now: Date,
  ): Promise<KickPlayerResult> {
    const matchId = asMatchId(input.matchId);
    const captainId = asUserId(input.captainId);
    const requestId = asJoinRequestId(input.requestId);

    return withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      // 1. Authorisation — only the captain may kick.
      if (match.captainId !== captainId) {
        throw new NotCaptainError({ matchId, captainId });
      }

      // 2. Request must exist and belong to this match (cross-match guard
      //    collapses to 404 so a direct curl with a foreign request id
      //    cannot leak status information about another match).
      const request = await this.joinRequestRepository.findById(requestId, tx);
      if (!request || request.matchId !== matchId) {
        throw new RequestNotFoundError({ matchId, requestId });
      }

      // 3. Player must currently be on the roster. Left / kicked / pending
      //    / rejected → 404 (spec "Idempotency": frontend treats as
      //    success-no-op, "player not on roster" is the desired state).
      if (request.status !== "accepted") {
        throw new NotInMatchError({ matchId, requestId });
      }

      // 4. Match must be live. Compute slots-before with current accepted
      //    set; same pattern as Leave / Approve.
      const acceptedBefore =
        await this.joinRequestRepository.listAcceptedForMatch(matchId, tx);
      const acceptedSlotsBefore = sumAcceptedSlots(acceptedBefore);
      const slotsBefore = computeSlots(match, acceptedSlotsBefore);
      const status = deriveMatchStatus(match, slotsBefore, now);
      if (status !== "open" && status !== "almostFull" && status !== "full") {
        throw new MatchLockedError({ matchId, status });
      }

      // 5. Flip accepted → kicked. Slot count drops by (1 + guestCount).
      await this.joinRequestRepository.updateStatus(
        request.id,
        "kicked",
        null,
        tx,
      );

      const acceptedSlotsAfter =
        acceptedSlotsBefore - freedSlots(request.guestCount);
      const slotsAfter = computeSlots(match, acceptedSlotsAfter);

      // Notification to the kicked player INSIDE the same tx (spec "Write
      // ordering"). notifyWatching below covers the watcher / captain fan-out.
      await this.notificationRepository.insert(
        {
          userId: request.userId,
          type: "kicked",
          matchId,
          body: NOTIFICATION_BODIES.kicked,
        },
        tx,
      );
      // TODO(Layer 7b): email send to request.userId via EmailSender port —
      //   Kick is on the email allowlist (spec global.md "Notifications").

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
          triggeredByCaptain: true,
          tx,
        },
      );

      return {
        status: "kicked" as const,
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
