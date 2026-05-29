/**
 * MODULE: auth.application.delete-account-service
 * PURPOSE: Use case — authenticated user self-deletes their account via
 *          `DELETE /api/me`. Orchestrates the spec global.md "Ban / account
 *          deletion" flow:
 *            1. last-admin guard;
 *            2. cascade-cancel of every upcoming captain match through the
 *               existing `CancelMatchService`;
 *            3. soft-delete the user row.
 * LAYER: application (cross-context — owns the auth-side coordinator but
 *        delegates the per-match work to `match_lifecycle/application`,
 *        same pattern as `MatchStateService` reaching into `chat` /
 *        `auth/domain/user-repository`).
 * DEPENDENCIES: ../domain/errors, ../domain/user, ../domain/user-repository,
 *               src/match_lifecycle/application/cancel-match-service,
 *               src/match_lifecycle/domain/{errors,match-repository,
 *               system-cancel-reasons}
 * CONSUMED BY: src/auth/composition.ts → app/api/me/route.ts (DELETE)
 * INVARIANTS:
 *   - **Last-admin guard runs FIRST.** Spec personal.md §146 mandates a 409
 *     `last_admin` when the caller is the only active admin (`isAdmin=true
 *     AND banned=false AND deletedAt IS NULL` counted via
 *     `UserRepository.countActiveAdmins({excludeUserId})`). UI mirrors the
 *     guard with a disabled `[Delete account]` button + blocking text;
 *     reaching this branch implies a curl / drift between page render and
 *     submit. Throwing here, BEFORE the cascade, leaves the system intact.
 *   - **Cascade-cancel uses `CancelMatchService` unchanged.** Each upcoming
 *     captain match is cancelled through the same service captains call
 *     manually, with the canonical
 *     `SYSTEM_CANCEL_REASONS.organizerRemoved` string as the cancel reason.
 *     Privacy: spec global.md "Ban / account deletion" requires the public
 *     banner / notification text to be identical for self-delete and admin
 *     ban — the constant is the single source of truth.
 *   - **Per-match transactions, not one global tx.** Each cancel takes its
 *     OWN `withMatchLock` (and therefore its own DB tx); the user-row flip
 *     is a separate tx-less write. The whole operation is NOT atomic across
 *     matches. Acceptable for v1: any failure mid-cascade leaves the user's
 *     account undeleted (step 3 is last), so the user can retry — already-
 *     cancelled matches are skipped, the rest proceed.
 *   - **Idempotent retries.** Between fetch and per-match cancel a race
 *     could land `AlreadyCancelledError` (a parallel-tab admin / cron) or
 *     `MatchAlreadyStartedError` (clock tick between fetch and lock).
 *     Swallow both — the match is no longer "upcoming" by the time we'd
 *     act on it. Other domain errors propagate as 500 (the user retries).
 *   - **`markDeleted` is called LAST** so a partial-cascade failure does
 *     not leave the user without an account AND with surviving open
 *     matches. Setting `deletedAt` then column-based session invalidation
 *     fires on the next request from any tab (spec global.md "Session
 *     invalidation").
 *   - **InProgress matches are NOT touched** — spec "Ghost match". The
 *     `findUpcomingByCaptain` predicate excludes them via `start_time >
 *     now()`. The captain just becomes `[Removed user]` on Lineup for the
 *     remainder of the match.
 *   - **Accepted JoinRequests on others' matches are NOT explicitly
 *     freed.** They stay `accepted` in DB; the captain (and other players)
 *     see `[Removed user]` on Lineup at render-time via the existing
 *     banned/deleted resolution. Free-slot fan-out for those is intentional
 *     spec gap in v1 — see global.md "Ban / account deletion" → "Accepted /
 *     pending / watching in other matches" (informational, not implemented
 *     in 7.5; revisit when admin-ban ships in Layer 9 alongside the same
 *     cleanup).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "ACCOUNT ACTIONS" → Delete
 *     account, "Admin role management & safety" → last-admin guard
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion" → Captain
 *     of upcoming matches, "Session invalidation"
 *   - docs/spec/pitchup-spec-match.md §290 (banner wording on cascade)
 */
import {
  AlreadyCancelledError,
  MatchAlreadyStartedError,
} from "@/src/match_lifecycle/domain/errors";
import type { MatchRepository } from "@/src/match_lifecycle/domain/match-repository";
import { SYSTEM_CANCEL_REASONS } from "@/src/match_lifecycle/domain/system-cancel-reasons";
import type { CancelMatchService } from "@/src/match_lifecycle/application/cancel-match-service";

import { LastAdminError } from "../domain/errors";
import { asUserId, type UserId } from "../domain/user";
import type { UserRepository } from "../domain/user-repository";

export interface DeleteAccountInput {
  readonly userId: string;
}

export interface DeleteAccountResult {
  readonly cancelledMatchIds: readonly string[];
}

export class DeleteAccountService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly matchRepository: MatchRepository,
    private readonly cancelMatchService: CancelMatchService,
  ) {}

  async execute(
    input: DeleteAccountInput,
    now: Date,
  ): Promise<DeleteAccountResult> {
    const userId = asUserId(input.userId);

    // 1. Last-admin guard. The caller is signed in (requireAuth ran in the
    //    route handler) but their isAdmin flag may have flipped between the
    //    page render and this call — re-fetch.
    const user = await this.userRepository.findById(userId);
    if (user === null) {
      // The session validated in requireAuth, so the row existed seconds
      // ago. Race with admin hard-delete (Layer 9) — treat as already done.
      return { cancelledMatchIds: [] };
    }
    // Already soft-deleted by a parallel tab — idempotent success-no-op.
    if (user.deletedAt !== null) return { cancelledMatchIds: [] };

    if (user.isAdmin) {
      const others = await this.userRepository.countActiveAdmins(userId);
      if (others === 0) {
        throw new LastAdminError({ userId });
      }
    }

    // 2. Cascade-cancel upcoming captain matches. The list is captured
    //    BEFORE any cancel runs; a brand-new match created mid-cascade by
    //    the user (very unlikely — they're deleting their account) would
    //    be missed, but they're about to lose their session anyway.
    const upcoming = await this.matchRepository.findUpcomingByCaptain(
      userId,
      now,
    );

    const cancelledMatchIds: string[] = [];
    for (const match of upcoming) {
      try {
        await this.cancelMatchService.execute(
          {
            matchId: match.id,
            captainId: userId,
            cancelReason: SYSTEM_CANCEL_REASONS.organizerRemoved,
          },
          now,
        );
        cancelledMatchIds.push(match.id);
      } catch (err) {
        // Swallow the two "no longer upcoming" races (parallel cancel,
        // clock tick). Any other domain error means something structural is
        // broken — propagate so the route returns 500 and the user retries.
        if (
          err instanceof AlreadyCancelledError ||
          err instanceof MatchAlreadyStartedError
        ) {
          continue;
        }
        throw err;
      }
    }

    // 3. Flip deletedAt. Done LAST so a cascade failure leaves the account
    //    intact and the user can retry. After this write, column-based
    //    session invalidation kicks in on the next request from any open
    //    tab (spec global.md "Session invalidation").
    await this.userRepository.markDeleted(userId);

    return { cancelledMatchIds };
  }
}

// Re-export the input UserId helper so call sites that compose DTOs from
// route handlers don't need a second import. Not used inside the service.
export type { UserId };
