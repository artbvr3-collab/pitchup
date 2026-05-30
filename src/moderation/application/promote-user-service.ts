/**
 * MODULE: moderation.application.promote-user-service
 * PURPOSE: Use case — an admin grants admin rights via
 *          `POST /api/admin/users/:id/promote`. Flips `users.is_admin` to true
 *          and writes a `promote` audit row with the required reason.
 * LAYER: application
 * DEPENDENCIES: ../domain/errors, ../domain/admin-action-repository,
 *               src/auth/domain/{user, user-repository}
 * CONSUMED BY: src/moderation/composition.ts →
 *              app/api/admin/users/[id]/promote/route.ts
 * INVARIANTS:
 *   - Self-modification guard FIRST (`target === actor` → 403). On the `(you)`
 *     row the toggle renders `[Demote]`, never `[Promote]`, so promote-self is
 *     a curl-only path; rejected as a backstop.
 *   - Idempotent on an already-admin target → no-op, no audit row.
 *   - No last-admin concern (promotion only grows the admin set). A banned
 *     user CAN be promoted — `is_admin` and `banned` are independent flags
 *     (spec global.md); a banned admin is simply not counted as active.
 *   - `is_admin` is read from DB on every request (never the JWT), so the new
 *     right takes effect on the target's very next request — no re-login
 *     (spec global.md → "`is_admin` not in JWT").
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/users" → Promote / Demote
 */
import { asUserId } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";

import type { AdminActionRepository } from "../domain/admin-action-repository";
import {
  AdminTargetNotFoundError,
  SelfModificationError,
} from "../domain/errors";

export interface PromoteUserInput {
  readonly actorAdminId: string;
  readonly targetUserId: string;
  readonly reason: string;
}

export class PromoteUserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly adminActionRepository: AdminActionRepository,
  ) {}

  async execute(input: PromoteUserInput): Promise<{ applied: boolean }> {
    if (input.targetUserId === input.actorAdminId) {
      throw new SelfModificationError();
    }

    const targetId = asUserId(input.targetUserId);
    const target = await this.userRepository.findById(targetId);
    if (target === null) throw new AdminTargetNotFoundError();
    if (target.isAdmin) return { applied: false };

    await this.userRepository.setAdmin(targetId, true);
    await this.adminActionRepository.record({
      actorAdminId: input.actorAdminId,
      targetUserId: input.targetUserId,
      action: "promote",
      reason: input.reason,
    });

    return { applied: true };
  }
}
