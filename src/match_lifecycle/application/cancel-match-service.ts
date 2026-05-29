/**
 * MODULE: match_lifecycle.application.cancel-match-service
 * PURPOSE: Use case — captain cancels their match before kickoff. Implements
 *          `POST /api/matches/:id/cancel`: under advisory lock → captain
 *          check → not-already-cancelled check → not-started check →
 *          UPDATE match.cancelled_at + cancel_reason → mass-update all
 *          pending JR → rejected (auto_reason='match_cancelled') → DELETE
 *          all Watch rows (silently, spec §282).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository, WatchRepository
 *                       + withMatchLock
 * CONSUMED BY: app/api/matches/[id]/cancel/route.ts
 * INVARIANTS:
 *   - Cancel is terminal — once `cancelled_at IS NOT NULL` the match stays
 *     Cancelled forever (state machine `Cancelled --> [*]`). PATCH cannot
 *     reanimate it (the edit-field whitelist drops `cancelled_at`).
 *   - The accepted players' JRs are NOT touched. Spec match.md "Race
 *     scenarios" → "Approve + Cancel match": "the newly accepted player
 *     stays on the roster (their invite is not revoked; the Cancelled match
 *     status disables the CTA anyway)." Their `JoinRequest.status` stays
 *     `accepted`; the Past sub-label reads `match.cancelledAt IS NOT NULL`
 *     to surface as "Match was cancelled" (Layer 6 sub-label code path,
 *     personal.md table).
 *   - All pending JRs are mass-rejected with `auto_reason='match_cancelled'`
 *     in the SAME tx — this is how `/my-matches → Section Past` distinguishes
 *     "Request declined · match cancelled" from "Request declined · match
 *     started" / "Request declined" (captain-initiated reject). Spec
 *     personal.md → "Past sub-label by `auto_reason`".
 *   - All Watch rows are DELETED silently (spec §282 — "watching: Watch
 *     deleted silently, without a notification row"). The watcher count
 *     becomes 0 immediately. No `notifyWatching` call — the watcher fan-out
 *     is suppressed on cancel by design.
 *   - Idempotent: a second `POST /cancel` on an already-cancelled match
 *     throws `AlreadyCancelledError 409`. Spec "Idempotency" notes that
 *     returning 200 is also acceptable — the frontend treats the 409 as
 *     success-no-op (the desired state "match cancelled" is already true).
 *   - `cancelReason` arrives pre-validated from the Zod boundary
 *     (`.trim().normalize('NFC')` + 1..200 length) — see the route handler
 *     schema. The service does NOT re-normalise; the AGENTS gotcha on
 *     `UpdateProfileService` text validation applies (single normalisation
 *     site at the boundary).
 *   - Post-start cancel is NOT allowed in v1 — spec §292. After `start_time`
 *     the match is considered played. The captain sheet hides
 *     `[Cancel match]` on non-live statuses; the 409 covers direct curls.
 *     Rain / injury / force majeure handled outside the app per personal.md
 *     "Known gaps".
 * NOTE (Layer 7 — Notifications):
 *   - Inserts one `match_cancelled` row per accepted JR (body "Match
 *     cancelled — <reason>") and per formerly-pending JR (body "Your request
 *     was declined — match was cancelled") INSIDE the same tx. Two DIFFERENT
 *     bodies, one SAME type. Polling derives different `my_status` for the
 *     two audiences (`cancelled` vs `declined`) on read.
 *   - Watching players: NO notification, NO `matches_changed` entry — Watch
 *     is deleted silently (spec §282); the `👀 Watching` card goes stale
 *     until next render.
 *   - No email on cancel (spec "Notifications" allowlist).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST
 *     /cancel, "Reject / Kick / Leave flows" → "Match cancellation",
 *     "Race scenarios — resolution matrix" → "Join + Cancel-match",
 *     "Approve + Cancel match", "Idempotency"
 *   - docs/spec/pitchup-spec-personal.md → Past sub-label table
 *   - docs/spec/pitchup-spec-global.md → "Text field validation &
 *     sanitization" (cancel_reason limits), "Polling sync" → my_status
 */
import { asUserId } from "@/src/auth/domain/user";
import type { NewNotification } from "@/src/notifications/domain/notification";
import {
  buildMatchCancelledBody,
  NOTIFICATION_BODIES,
} from "@/src/notifications/domain/notification-bodies";
import type { NotificationRepository } from "@/src/notifications/domain/notification-repository";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  AlreadyCancelledError,
  MatchAlreadyStartedError,
  MatchNotFoundError,
  NotCaptainError,
} from "../domain/errors";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import type { WatchRepository } from "../domain/watch-repository";

export interface CancelMatchInput {
  readonly matchId: string;
  readonly captainId: string;
  /** Pre-validated by the API boundary (NFC + trim + length 1..200). */
  readonly cancelReason: string;
}

export interface CancelMatchResult {
  readonly status: "cancelled";
  readonly rejectedPendingCount: number;
  readonly watchRowsDeleted: number;
}

export class CancelMatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async execute(
    input: CancelMatchInput,
    now: Date,
  ): Promise<CancelMatchResult> {
    const matchId = asMatchId(input.matchId);
    const captainId = asUserId(input.captainId);

    return withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      // 1. Authorisation — only the captain may cancel.
      if (match.captainId !== captainId) {
        throw new NotCaptainError({ matchId, captainId });
      }

      // 2. Idempotency / terminality — already cancelled stays cancelled.
      if (match.cancelledAt !== null) {
        throw new AlreadyCancelledError({
          matchId,
          cancelledAt: match.cancelledAt.toISOString(),
        });
      }

      // 3. No post-start cancel in v1. Compare against `now` (UTC); the
      //    advisory lock guarantees we see a fresh `match.startTime`.
      if (match.startTime.getTime() <= now.getTime()) {
        throw new MatchAlreadyStartedError({
          matchId,
          startTime: match.startTime.toISOString(),
        });
      }

      // 4. Mark the match as cancelled. Order matters: cancel match BEFORE
      //    mass-reject so any concurrent reader sees `cancelled_at` first
      //    (READ COMMITTED gives us per-statement consistency anyway, but
      //    the write order is documented for posterity).
      await this.matchRepository.cancel(matchId, input.cancelReason, tx);

      // 5. Mass-reject pending JRs with auto_reason='match_cancelled'.
      //    Returned rows give Layer 7 the userId list for the inbox fan-out
      //    addressed to former-pending players.
      const rejected = await this.joinRequestRepository.massRejectPending(
        matchId,
        "match_cancelled",
        tx,
      );

      // 6. Wipe Watch rows. Per spec §282 — silently, no notification fan-out.
      //    Atomic with the cancel because callers may still be holding a
      //    full-match Watch they tried to plant a moment earlier.
      const watchRowsDeleted =
        await this.watchRepository.deleteAllForMatch(matchId, tx);

      // 7. Notifications INSIDE the same tx (spec "Write ordering"). Two
      //    DIFFERENT bodies, one SAME type (`match_cancelled`): accepted
      //    players get "Match cancelled — <reason>"; former-pending players
      //    (the `rejected` pre-image rows) get "Your request was declined —
      //    match was cancelled". Accepted JRs are unchanged by cancel, so we
      //    re-read them under the lock. Watching players are NOT notified —
      //    Watch was wiped silently above (spec §282). No email on cancel.
      const accepted = await this.joinRequestRepository.listAcceptedForMatch(
        matchId,
        tx,
      );
      const notifications: NewNotification[] = [
        ...accepted.map((jr) => ({
          userId: jr.userId,
          type: "match_cancelled" as const,
          matchId,
          body: buildMatchCancelledBody(input.cancelReason),
        })),
        ...rejected.map((jr) => ({
          userId: jr.userId,
          type: "match_cancelled" as const,
          matchId,
          body: NOTIFICATION_BODIES.matchCancelledPending,
        })),
      ];
      await this.notificationRepository.insertMany(notifications, tx);

      return {
        status: "cancelled" as const,
        rejectedPendingCount: rejected.length,
        watchRowsDeleted,
      };
    });
  }
}
