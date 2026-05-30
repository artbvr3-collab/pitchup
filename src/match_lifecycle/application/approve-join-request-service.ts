/**
 * MODULE: match_lifecycle.application.approve-join-request-service
 * PURPOSE: Use case — captain approves a pending JoinRequest. Implements
 *          `POST /api/matches/:id/approve`: re-read match + accepted set
 *          under advisory lock → captain check → request-exists/pending
 *          check → hard-cap check (`computeSlots(after).filled <= capacity`)
 *          → UPDATE status to accepted → DELETE Watch for (request.user, match)
 *          in same tx.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository, WatchRepository
 * CONSUMED BY: app/api/matches/[id]/approve/route.ts
 * INVARIANTS:
 *   - Hard cap is canonical. `computeSlots(match, acceptedSlots + 1 +
 *     guestCount).filled <= capacity` MUST hold. Otherwise OverCapacityError.
 *     The captain raises Total via Edit and retries.
 *     Spec global.md: "Total spots — hard cap on approve".
 *   - Watch row for the now-accepted user is removed in the same transaction
 *     — idempotent safety in case the user raced a Watch in just before
 *     approve. Spec match.md → "Per-endpoint checklist" → POST /approve.
 *   - Race "Approve + Cron auto-reject" / "Approve + Cancel-request" /
 *     "Approve + Approve same request" all funnel into the same checks:
 *     request must still be `pending` under the lock — else
 *     AlreadyProcessedError. If the row is gone entirely → RequestNotFoundError.
 * NOTE (Layer 7 — Notifications):
 *   - Inserts `notification(type='approved', body="✓ You're in")` for
 *     request.userId INSIDE this transaction (spec match.md → "Write
 *     ordering"). The `approved` email (Layer 7b) is sent AFTER the locked tx
 *     commits, best-effort: a Resend failure is logged but never rolls back
 *     the approve (it is not idempotent / not cron-retried) and the lock is
 *     never held across the HTTP call. Gated by `email_notifications`. See
 *     ADR-0004 "Send semantics".
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Approve flow", "Per-endpoint
 *     checklist" → POST /approve, "Race scenarios — resolution matrix"
 *   - docs/spec/pitchup-spec-global.md → "Total spots — hard cap on approve"
 */
import { asUserId, type UserId } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";
import {
  buildApprovedEmail,
  emailGateOpen,
  matchUrl,
} from "@/src/notifications/domain/email-bodies";
import type { EmailSender } from "@/src/notifications/domain/email-sender";
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";
import type { NotificationRepository } from "@/src/notifications/domain/notification-repository";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  AlreadyProcessedError,
  MatchLockedError,
  MatchNotFoundError,
  NotCaptainError,
  OverCapacityError,
  RequestNotFoundError,
} from "../domain/errors";
import { asJoinRequestId, type JoinRequest } from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId, type MatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type { WatchRepository } from "../domain/watch-repository";
import type { ApproveJoinRequestInput } from "./dto/approve-reject-input";

export interface ApproveJoinRequestResult {
  readonly status: "accepted";
}

export class ApproveJoinRequestService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
    private readonly notificationRepository: NotificationRepository,
    private readonly userRepository: UserRepository,
    private readonly emailSender: EmailSender,
    private readonly appBaseUrl: string,
  ) {}

  async execute(
    input: ApproveJoinRequestInput,
    now: Date,
  ): Promise<ApproveJoinRequestResult> {
    const matchId = asMatchId(input.matchId);
    const captainId = asUserId(input.captainId);
    const requestId = asJoinRequestId(input.requestId);

    const recipientId = await withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      // 1. Authorisation — only the captain.
      if (match.captainId !== captainId) {
        throw new NotCaptainError({ matchId, captainId });
      }

      // 2. Request must exist and belong to this match.
      const request = await this.joinRequestRepository.findById(requestId, tx);
      if (!request || request.matchId !== matchId) {
        throw new RequestNotFoundError({ matchId, requestId });
      }

      // 3. Request must still be pending.
      if (request.status !== "pending") {
        throw new AlreadyProcessedError({
          matchId,
          requestId,
          currentStatus: request.status,
        });
      }

      // 4. Match must be live (cron may have started; cancel may have hit).
      const accepted = await this.joinRequestRepository.listAcceptedForMatch(
        matchId,
        tx,
      );
      const acceptedSlots = sumAcceptedSlots(accepted);
      const currentSlots = computeSlots(match, acceptedSlots);
      const status = deriveMatchStatus(match, currentSlots, now);
      if (status !== "open" && status !== "almostFull" && status !== "full") {
        throw new MatchLockedError({ matchId, status });
      }

      // 5. Hard cap — would-be filled after approve must not exceed capacity.
      const afterSlots = computeSlots(
        match,
        acceptedSlots + 1 + request.guestCount,
      );
      if (afterSlots.filled > afterSlots.capacity) {
        throw new OverCapacityError({
          matchId,
          requestId,
          guestCount: request.guestCount,
          free: currentSlots.free,
        });
      }

      // 6. Flip pending → accepted.
      await this.joinRequestRepository.updateStatus(
        requestId,
        "accepted",
        null,
        tx,
      );

      // 7. Same-tx Watch cleanup for the approved user (race-safety;
      //    `POST /watch` enforces isFull, but cached tabs / direct curls
      //    may have planted a Watch a moment ago).
      await this.watchRepository.deleteForUserAndMatch(
        matchId,
        request.userId,
        tx,
      );

      // Notification inside the same tx (spec "Write ordering"). Approve also
      // earns an email — that channel lands in Layer 7b (EmailSender port).
      await this.notificationRepository.insert(
        {
          userId: request.userId,
          type: "approved",
          matchId,
          body: NOTIFICATION_BODIES.approved,
        },
        tx,
      );

      return request.userId;
    });

    // Post-commit, best-effort email (ADR-0004). The approve — including the
    // in-app inbox row — is already committed; a Resend hiccup must not roll it
    // back, and we never hold the advisory lock across an HTTP call.
    await this.sendApprovedEmail(recipientId, matchId);

    return { status: "accepted" as const };
  }

  private async sendApprovedEmail(
    userId: UserId,
    matchId: MatchId,
  ): Promise<void> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user || !emailGateOpen(user)) return;
      await this.emailSender.send(
        buildApprovedEmail(user.email, matchUrl(this.appBaseUrl, matchId)),
      );
    } catch (err) {
      console.error("[approve] best-effort approved-email send failed", err);
    }
  }
}

function sumAcceptedSlots(requests: readonly JoinRequest[]): number {
  let total = 0;
  for (const r of requests) total += 1 + r.guestCount;
  return total;
}
