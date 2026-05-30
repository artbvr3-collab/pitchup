/**
 * MODULE: match_lifecycle.application.admin-cancel-match-service
 * PURPOSE: Admin variant of match cancellation. Thin wrapper around the
 *          existing `CancelMatchService` — bypasses `NotCaptainError` by
 *          reading the match's actual `captainId` from the DB and passing it
 *          as the caller identity. This mirrors how `BanUserService` reuses
 *          `CancelMatchService` (it also passes the target user's own id as
 *          the captain, since the target IS the captain of those matches).
 *          Implements `POST /api/admin/matches/:id/cancel`.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository (unlocked read for captainId),
 *                       CancelMatchService (reused unchanged)
 * CONSUMED BY: app/api/admin/matches/[id]/cancel/route.ts
 * INVARIANTS:
 *   - Pre-reads `match.captainId` WITHOUT a lock (captainId is immutable after
 *     INSERT — no mutation ever changes it). The service re-reads the match
 *     UNDER the advisory lock — two reads of the same immutable field are safe.
 *   - All business rules from `CancelMatchService` still apply: start-time
 *     guard, idempotency (AlreadyCancelledError), mass-reject pending,
 *     watch wipe, and notification fan-out are UNCHANGED.
 *   - Admin's `actorId` is NOT passed into CancelMatchService (it has no
 *     concept of an actor beyond captain). The admin identity lives only in
 *     the `requireAdmin()` auth gate and the HTTP request log.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → "Cancel"
 *   - src/match_lifecycle/application/cancel-match-service.ts
 */
import type { CancelMatchResult, CancelMatchService } from "./cancel-match-service";
import type { MatchRepository } from "../domain/match-repository";
import { asMatchId } from "../domain/match";
import { MatchNotFoundError } from "../domain/errors";

export interface AdminCancelMatchInput {
  readonly matchId: string;
  /** Pre-validated by the API boundary (NFC + trim + 1..200 chars). */
  readonly cancelReason: string;
}

export class AdminCancelMatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly cancelMatchService: CancelMatchService,
  ) {}

  async execute(
    input: AdminCancelMatchInput,
    now: Date,
  ): Promise<CancelMatchResult> {
    const matchId = asMatchId(input.matchId);

    // Unlocked pre-read to resolve the immutable captainId.
    const match = await this.matchRepository.findById(matchId);
    if (!match) throw new MatchNotFoundError({ matchId });

    // Delegate entirely to the existing service — all invariants preserved.
    return this.cancelMatchService.execute(
      {
        matchId: input.matchId,
        captainId: match.captainId,
        cancelReason: input.cancelReason,
      },
      now,
    );
  }
}
