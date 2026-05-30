/**
 * MODULE: moderation.application.ban-user-service
 * PURPOSE: Use case — an admin bans a user via `POST /api/admin/users/:id/ban`.
 *          Mirrors `auth/application/DeleteAccountService` (the same cascade,
 *          the same canonical cancel reason) but is driven by an admin acting
 *          on ANOTHER account, with the self-modification + last-admin guards.
 * LAYER: application (cross-context coordinator — owns the moderation-side
 *        flow, delegates per-match cancellation to `match_lifecycle`, same
 *        pattern as `DeleteAccountService`).
 * DEPENDENCIES: ../domain/errors, ../domain/admin-action-repository,
 *               src/auth/domain/{user, user-repository, errors},
 *               src/match_lifecycle/application/cancel-match-service,
 *               src/match_lifecycle/domain/{errors, match-repository,
 *               system-cancel-reasons}
 * CONSUMED BY: src/moderation/composition.ts →
 *              app/api/admin/users/[id]/ban/route.ts
 * INVARIANTS:
 *   - **Self-modification guard runs FIRST.** `target === actor` → 403
 *     `self_modification` before any DB read (spec personal.md → "Self-
 *     modification guard"). The `(you)` row disables `[Ban]` in the UI; this is
 *     the curl / desynced-tab backstop.
 *   - **Idempotent on an already-banned target.** A second ban is a no-op — no
 *     duplicate audit row, no re-run of the cascade.
 *   - **Last-admin guard.** Banning an admin who is the only active admin
 *     (`countActiveAdmins(excludeTarget) === 0`) → 409 `last_admin`. In
 *     practice unreachable cross-actor (the acting admin is itself a counted
 *     active admin ≠ target), kept as the spec-mandated backstop + defence in
 *     depth.
 *   - **Cascade-cancel reuses `CancelMatchService` UNCHANGED** with
 *     `SYSTEM_CANCEL_REASONS.organizerRemoved` — privacy: the public banner /
 *     notification text MUST be identical for self-delete and admin-ban (spec
 *     global.md → "Ban / account deletion"). The ban *reason* (admin's words)
 *     goes ONLY to the audit log, never to players.
 *   - **`setBanned(true)` is called LAST, before the audit row.** A cascade
 *     failure leaves the account un-banned so the admin can retry; mirrors
 *     `markDeleted` ordering in `DeleteAccountService`. `is_admin` is NOT
 *     reset (spec global.md → "`is_admin` is preserved on ban").
 *   - **Per-match transactions, not one global tx** — each cancel takes its
 *     own `withMatchLock`. `AlreadyCancelledError` / `MatchAlreadyStartedError`
 *     are swallowed (no longer "upcoming"); other errors propagate as 500.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/users", "Admin role
 *     management & safety"
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion"
 */
import { LastAdminError } from "@/src/auth/domain/errors";
import { asUserId } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";
import type { CancelMatchService } from "@/src/match_lifecycle/application/cancel-match-service";
import {
  AlreadyCancelledError,
  MatchAlreadyStartedError,
} from "@/src/match_lifecycle/domain/errors";
import type { MatchRepository } from "@/src/match_lifecycle/domain/match-repository";
import { SYSTEM_CANCEL_REASONS } from "@/src/match_lifecycle/domain/system-cancel-reasons";

import type { AdminActionRepository } from "../domain/admin-action-repository";
import {
  AdminTargetNotFoundError,
  SelfModificationError,
} from "../domain/errors";

export interface BanUserInput {
  readonly actorAdminId: string;
  readonly targetUserId: string;
  readonly reason: string;
}

export interface BanUserResult {
  readonly cancelledMatchIds: readonly string[];
  /** `false` when the target was already banned (idempotent no-op). */
  readonly applied: boolean;
}

export class BanUserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly matchRepository: MatchRepository,
    private readonly cancelMatchService: CancelMatchService,
    private readonly adminActionRepository: AdminActionRepository,
  ) {}

  async execute(input: BanUserInput, now: Date): Promise<BanUserResult> {
    if (input.targetUserId === input.actorAdminId) {
      throw new SelfModificationError();
    }

    const targetId = asUserId(input.targetUserId);
    const target = await this.userRepository.findById(targetId);
    if (target === null) throw new AdminTargetNotFoundError();
    if (target.banned) return { cancelledMatchIds: [], applied: false };

    if (target.isAdmin) {
      const others = await this.userRepository.countActiveAdmins(targetId);
      if (others === 0) {
        throw new LastAdminError({ targetUserId: input.targetUserId });
      }
    }

    const upcoming = await this.matchRepository.findUpcomingByCaptain(
      targetId,
      now,
    );
    const cancelledMatchIds: string[] = [];
    for (const match of upcoming) {
      try {
        await this.cancelMatchService.execute(
          {
            matchId: match.id,
            captainId: targetId,
            cancelReason: SYSTEM_CANCEL_REASONS.organizerRemoved,
          },
          now,
        );
        cancelledMatchIds.push(match.id);
      } catch (err) {
        if (
          err instanceof AlreadyCancelledError ||
          err instanceof MatchAlreadyStartedError
        ) {
          continue;
        }
        throw err;
      }
    }

    await this.userRepository.setBanned(targetId, true);
    await this.adminActionRepository.record({
      actorAdminId: input.actorAdminId,
      targetUserId: input.targetUserId,
      action: "ban",
      reason: input.reason,
    });

    return { cancelledMatchIds, applied: true };
  }
}
