/**
 * MODULE: match_lifecycle.application.like-teammate-service
 * PURPOSE: POST /api/matches/:id/likes — a captain / accepted participant
 *          likes a teammate after the match has ended. Idempotent INSERT
 *          (ON CONFLICT DO NOTHING) under the advisory lock.
 *          Spec match.md → "Post-match likes" + "Per-endpoint checklist".
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository.findById,
 *                       JoinRequestRepository.findByMatchAndUser,
 *                       UserRepository.findById,
 *                       LikeRepository.insertIfAbsent
 * CONSUMED BY: app/api/matches/[id]/likes/route.ts
 * INVARIANTS:
 *   - Guards run in the spec's checklist order:
 *       1. match exists                         → MatchNotFoundError 404
 *       2. status === 'ended'                   → MatchNotEndedError 409
 *       3. giver is captain OR accepted         → NotAParticipantError 403
 *       4. target ≠ giver (self-like backstop)  → LikeTargetNotFoundError 404
 *       5. target exists, not banned/deleted    → LikeTargetNotFoundError 404
 *   - Idempotent: a repeat like (double tap / re-open) returns
 *     `{ outcome: 'existed' }`, mapped to 200 by the route (spec §600).
 *   - Likes are irreversible — there is no un-like path.
 *   - Status is derived via `deriveMatchStatus` (never recomputed inline);
 *     the `ended` decision is independent of slot fullness, so a cheap
 *     `computeSlots(match)` suffices for the derivation call.
 *   - Per spec the target need NOT be re-checked for roster membership — the
 *     checklist only requires "target row exists AND not banned". The modal
 *     only ever surfaces roster members; a stray id is harmless (its count is
 *     never shown).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Post-match likes", "Per-endpoint
 *     checklist" → POST /matches/:id/likes, "Concurrency & locking"
 */
import { asUserId, type UserId } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  LikeTargetNotFoundError,
  MatchNotEndedError,
  MatchNotFoundError,
  NotAParticipantError,
} from "../domain/errors";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import type { LikeInsertOutcome, LikeRepository } from "../domain/like-repository";
import { asMatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";

export class LikeTeammateService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly userRepository: UserRepository,
    private readonly likeRepository: LikeRepository,
  ) {}

  async execute(
    input: { matchId: string; giverId: UserId; targetId: string },
    now: Date,
  ): Promise<{ outcome: LikeInsertOutcome }> {
    const matchId = asMatchId(input.matchId);
    const receiverId = asUserId(input.targetId);

    return withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      // 2. Match must have ended.
      const status = deriveMatchStatus(match, computeSlots(match), now);
      if (status !== "ended") throw new MatchNotEndedError({ matchId });

      // 3. Giver must be the captain or an accepted participant.
      const isCaptain = match.captainId === input.giverId;
      if (!isCaptain) {
        const request = await this.joinRequestRepository.findByMatchAndUser(
          matchId,
          input.giverId,
          tx,
        );
        if (!request || request.status !== "accepted") {
          throw new NotAParticipantError({ matchId });
        }
      }

      // 4. Cannot like yourself (the modal filters this out; backstop here).
      if (receiverId === input.giverId) {
        throw new LikeTargetNotFoundError({ matchId, targetId: receiverId });
      }

      // 5. Target must still exist and be neither banned nor deleted.
      const target = await this.userRepository.findById(receiverId);
      if (!target || target.banned || target.deletedAt !== null) {
        throw new LikeTargetNotFoundError({ matchId, targetId: receiverId });
      }

      const outcome = await this.likeRepository.insertIfAbsent(
        matchId,
        input.giverId,
        receiverId,
        tx,
      );
      return { outcome };
    });
  }
}
