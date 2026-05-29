/**
 * MODULE: match_lifecycle.application.reject-join-request-service
 * PURPOSE: Use case — captain rejects a pending JoinRequest. Implements
 *          `POST /api/matches/:id/reject`: re-read match under advisory
 *          lock → captain check → request exists + pending → UPDATE status
 *          to rejected with `auto_reason = NULL` (captain-initiated, not
 *          cron / cancel).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository
 * CONSUMED BY: app/api/matches/[id]/reject/route.ts
 * INVARIANTS:
 *   - `auto_reason = NULL` is intentional — it distinguishes captain-reject
 *     from cron auto-reject (`match_started`) and cancel-driven mass-reject
 *     (`match_cancelled`). Inbox copy differs by reason in Layer 7.
 *   - No slot accounting changes (rejected pending was not counted in
 *     filled). No Watch cleanup (Watch wasn't tied to the pending row).
 *   - No re-apply limit — the player may Join again from any none-role
 *     state. Spec match.md → "Reject / Kick / Leave flows".
 * NOTE (Layer 7 — Notifications):
 *   - Inserts `notification(type='rejected', body="Your request was
 *     declined")` INSIDE this transaction (spec match.md → "Write ordering").
 *     No email on reject (spec "Notifications" allowlist).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST /reject,
 *     "Reject / Kick / Leave flows"
 */
import { asUserId } from "@/src/auth/domain/user";
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";
import type { NotificationRepository } from "@/src/notifications/domain/notification-repository";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  AlreadyProcessedError,
  MatchLockedError,
  MatchNotFoundError,
  NotCaptainError,
  RequestNotFoundError,
} from "../domain/errors";
import { asJoinRequestId, type JoinRequest } from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type { RejectJoinRequestInput } from "./dto/approve-reject-input";

export interface RejectJoinRequestResult {
  readonly status: "rejected";
}

export class RejectJoinRequestService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async execute(
    input: RejectJoinRequestInput,
    now: Date,
  ): Promise<RejectJoinRequestResult> {
    const matchId = asMatchId(input.matchId);
    const captainId = asUserId(input.captainId);
    const requestId = asJoinRequestId(input.requestId);

    return withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      if (match.captainId !== captainId) {
        throw new NotCaptainError({ matchId, captainId });
      }

      const request = await this.joinRequestRepository.findById(requestId, tx);
      if (!request || request.matchId !== matchId) {
        throw new RequestNotFoundError({ matchId, requestId });
      }
      if (request.status !== "pending") {
        throw new AlreadyProcessedError({
          matchId,
          requestId,
          currentStatus: request.status,
        });
      }

      const accepted = await this.joinRequestRepository.listAcceptedForMatch(
        matchId,
        tx,
      );
      const slots = computeSlots(match, sumAcceptedSlots(accepted));
      const status = deriveMatchStatus(match, slots, now);
      if (status !== "open" && status !== "almostFull" && status !== "full") {
        throw new MatchLockedError({ matchId, status });
      }

      await this.joinRequestRepository.updateStatus(
        requestId,
        "rejected",
        null,
        tx,
      );

      // Notification inside the same tx. No email on reject (spec
      // "Notifications" allowlist — only approve / kick / morning reminder).
      await this.notificationRepository.insert(
        {
          userId: request.userId,
          type: "rejected",
          matchId,
          body: NOTIFICATION_BODIES.rejected,
        },
        tx,
      );

      return { status: "rejected" as const };
    });
  }
}

function sumAcceptedSlots(requests: readonly JoinRequest[]): number {
  let total = 0;
  for (const r of requests) total += 1 + r.guestCount;
  return total;
}
