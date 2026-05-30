/**
 * MODULE: moderation.application.demote-user-service
 * PURPOSE: Use case — an admin revokes admin rights via
 *          `POST /api/admin/users/:id/demote`. Flips `users.is_admin` to false
 *          and writes a `demote` audit row, guarded by the last-admin check.
 * LAYER: application
 * DEPENDENCIES: ../domain/errors, ../domain/admin-action-repository,
 *               src/auth/domain/{user, user-repository, errors}
 * CONSUMED BY: src/moderation/composition.ts →
 *              app/api/admin/users/[id]/demote/route.ts
 * INVARIANTS:
 *   - Self-modification guard FIRST (`target === actor` → 403). To step down,
 *     an admin asks another admin (spec personal.md → "To step down from
 *     admin").
 *   - Idempotent on a non-admin target → no-op, no audit row.
 *   - Last-admin guard: `countActiveAdmins(excludeTarget) === 0` → 409
 *     `last_admin` (the same `LastAdminError`/predicate used by self-delete).
 *     Cross-actor this is effectively unreachable (the acting admin is itself
 *     a counted active admin ≠ target), but it is the spec's source of truth.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "Admin role management & safety" →
 *     "Last-admin guard"
 */
import { LastAdminError } from "@/src/auth/domain/errors";
import { asUserId } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";

import type { AdminActionRepository } from "../domain/admin-action-repository";
import {
  AdminTargetNotFoundError,
  SelfModificationError,
} from "../domain/errors";

export interface DemoteUserInput {
  readonly actorAdminId: string;
  readonly targetUserId: string;
  readonly reason: string;
}

export class DemoteUserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly adminActionRepository: AdminActionRepository,
  ) {}

  async execute(input: DemoteUserInput): Promise<{ applied: boolean }> {
    if (input.targetUserId === input.actorAdminId) {
      throw new SelfModificationError();
    }

    const targetId = asUserId(input.targetUserId);
    const target = await this.userRepository.findById(targetId);
    if (target === null) throw new AdminTargetNotFoundError();
    if (!target.isAdmin) return { applied: false };

    const others = await this.userRepository.countActiveAdmins(targetId);
    if (others === 0) {
      throw new LastAdminError({ targetUserId: input.targetUserId });
    }

    await this.userRepository.setAdmin(targetId, false);
    await this.adminActionRepository.record({
      actorAdminId: input.actorAdminId,
      targetUserId: input.targetUserId,
      action: "demote",
      reason: input.reason,
    });

    return { applied: true };
  }
}
