/**
 * MODULE: match_lifecycle.application.watch-match-service
 * PURPOSE: Use case — user subscribes to "Notify me when a spot opens" on a
 *          full match. Implements `POST /api/matches/:id/watch`: under
 *          advisory lock → match-live → captain backstop → no-active-JR
 *          backstop → isFull check → idempotent INSERT into watch table.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository,
 *                       WatchRepository + withMatchLock
 * CONSUMED BY: app/api/matches/[id]/watch/route.ts
 * INVARIANTS:
 *   - **`computeSlots(match).isFull === true` is mandatory.** Spec match.md
 *     "Watch is only created on a full match". The UI already hides
 *     `[Notify me]` on non-full matches (CTA cascade), but the backend
 *     check covers direct curls + cached tabs where the user opened a full
 *     match in the background, someone left, `notify watching` already
 *     dispatched, the user returned and tapped without refresh → `409
 *     not_full` → frontend toast "A spot just opened — refresh to join".
 *   - Captain cannot Watch their own match → `400 captain_cannot_watch`.
 *     UI never produces the button via `computeCta`; this is the curl
 *     backstop (mirror of `CaptainCannotJoinError` in Join service).
 *   - Active JoinRequest (status ∈ {pending, accepted}) blocks Watch →
 *     `400 already_in_match`. Terminal JR statuses (rejected, cancelled,
 *     left, kicked) are allowed — Watch upgrades them to `watching` per
 *     the `deriveMyStatus` mapping.
 *   - `upsertForUserAndMatch` is idempotent: existing row → `existed`,
 *     fresh row → `inserted`. Both return 200 to the client; the outcome
 *     is exposed for logging only.
 *   - Match must be live. Spec checklist: `409 match_locked` on
 *     InProgress / Ended / Cancelled.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Watching logic", "Per-endpoint
 *     checklist" → POST /watch, "Race scenarios — resolution matrix" →
 *     "Watch + Leave"
 */
import { asUserId } from "@/src/auth/domain/user";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  AlreadyInMatchError,
  CaptainCannotWatchError,
  MatchLockedError,
  MatchNotFoundError,
  MatchNotFullError,
} from "../domain/errors";
import type { JoinRequest } from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type {
  UpsertWatchOutcome,
  WatchRepository,
} from "../domain/watch-repository";

export interface WatchMatchInput {
  readonly matchId: string;
  readonly userId: string;
}

export interface WatchMatchResult {
  readonly outcome: UpsertWatchOutcome;
}

export class WatchMatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
  ) {}

  async execute(input: WatchMatchInput, now: Date): Promise<WatchMatchResult> {
    const matchId = asMatchId(input.matchId);
    const userId = asUserId(input.userId);

    return withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      // 1. Captain cannot Watch — backstop against direct curl.
      if (match.captainId === userId) {
        throw new CaptainCannotWatchError({ matchId, userId });
      }

      // 2. No active JoinRequest from this user (pending/accepted blocks
      //    Watch — "parallel states pending+watching do not exist").
      const jr = await this.joinRequestRepository.findByMatchAndUser(
        matchId,
        userId,
        tx,
      );
      if (jr && (jr.status === "pending" || jr.status === "accepted")) {
        throw new AlreadyInMatchError({ matchId, userId });
      }

      // 3. Match must be live + full. Compute slots under lock.
      const accepted = await this.joinRequestRepository.listAcceptedForMatch(
        matchId,
        tx,
      );
      const slots = computeSlots(match, sumAcceptedSlots(accepted));
      const status = deriveMatchStatus(match, slots, now);
      if (status !== "open" && status !== "almostFull" && status !== "full") {
        throw new MatchLockedError({ matchId, status });
      }
      if (!slots.isFull) {
        throw new MatchNotFullError({ matchId, free: slots.free });
      }

      // 4. Idempotent INSERT. existed → existing subscription (200 OK).
      const outcome = await this.watchRepository.upsertForUserAndMatch(
        matchId,
        userId,
        tx,
      );

      return { outcome };
    });
  }
}

function sumAcceptedSlots(requests: readonly JoinRequest[]): number {
  let total = 0;
  for (const r of requests) total += 1 + r.guestCount;
  return total;
}
