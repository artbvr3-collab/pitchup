/**
 * MODULE: match_lifecycle.application.cancel-join-request-service
 * PURPOSE: Use case — pending player withdraws their own join request.
 *          Implements `POST /api/matches/:id/cancel-request`: under
 *          advisory lock → JR-exists check → JR-still-pending check →
 *          UPDATE status='cancelled'.
 * LAYER: application
 * DEPENDENCIES (ports): JoinRequestRepository + withMatchLock
 * CONSUMED BY: app/api/matches/[id]/cancel-request/route.ts
 * INVARIANTS:
 *   - Status is UPDATE → `cancelled` (NOT DELETE). UNIQUE(match_id, user_id)
 *     is preserved so re-apply works via UPSERT (spec match.md → "Cancel
 *     request flow" + "Player match states").
 *   - We do NOT notify the captain — spec match.md "We don't notify the
 *     captain — the pending entry simply disappears from their list".
 *     Captain sheet / Lineup updates on the next render or poll.
 *   - Race "Approve + Cancel-request" (spec race-matrix):
 *       · Approve won  → JR.status === 'accepted' → AlreadyInMatchError 409
 *         (spec code `already_accepted` — frontend toast "You were just
 *         accepted!", CTA refreshes to [You're in ✓] + [Leave match]).
 *       · Cancel won  → captain's Approve sees status !== pending → its own
 *         `AlreadyProcessedError`. No action here.
 *   - Other terminal states (rejected / left / kicked / cancelled) →
 *     `AlreadyProcessedError` 409. Frontend treats as success-no-op
 *     (spec → "Idempotency"). Repeated `POST /cancel-request` on an
 *     already-cancelled JR also lands here → 409, treated as success.
 *   - Match-status check is intentionally OMITTED here. The spec
 *     "Per-endpoint checklist" → POST /cancel-request lists only
 *     `404 request_not_found` / `409 already_accepted` / `409 already_processed`.
 *     A user should be able to cancel their pending even if the match
 *     transitioned to InProgress in the meantime (the cron auto-reject
 *     window is up to 5 min). The UI already disables `[Cancel request]`
 *     under the match-state branch for non-live statuses (spec CTA
 *     cascade), but the backend stays permissive — there's no spec error
 *     for "match locked + cancel-request".
 * TODO(Layer 7 — Notifications):
 *   - Spec note: action `request_cancelled` does NOT create a notification
 *     row (polling only for tab sync). Nothing to insert here.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cancel request flow",
 *     "Per-endpoint checklist" → POST /cancel-request, "Race scenarios"
 */
import { asUserId } from "@/src/auth/domain/user";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  AlreadyInMatchError,
  AlreadyProcessedError,
  RequestNotFoundError,
} from "../domain/errors";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId } from "../domain/match";

export interface CancelJoinRequestInput {
  readonly matchId: string;
  readonly userId: string;
}

export interface CancelJoinRequestResult {
  readonly status: "cancelled";
}

export class CancelJoinRequestService {
  constructor(
    private readonly joinRequestRepository: JoinRequestRepository,
  ) {}

  async execute(
    input: CancelJoinRequestInput,
  ): Promise<CancelJoinRequestResult> {
    const matchId = asMatchId(input.matchId);
    const userId = asUserId(input.userId);

    return withMatchLock(matchId, async (tx) => {
      const request = await this.joinRequestRepository.findByMatchAndUser(
        matchId,
        userId,
        tx,
      );
      if (!request) {
        throw new RequestNotFoundError({ matchId, userId });
      }

      if (request.status === "accepted") {
        // Approve won the race in another tab — surface the spec-canonical
        // "already_accepted" via AlreadyInMatchError (same domain code).
        throw new AlreadyInMatchError({ matchId, userId });
      }

      if (request.status !== "pending") {
        // rejected / cancelled / left / kicked — repeat tap or some other
        // terminal flip. Idempotency: frontend treats as success-no-op.
        throw new AlreadyProcessedError({
          matchId,
          requestId: request.id,
          currentStatus: request.status,
        });
      }

      await this.joinRequestRepository.updateStatus(
        request.id,
        "cancelled",
        null,
        tx,
      );

      return { status: "cancelled" as const };
    });
  }
}
