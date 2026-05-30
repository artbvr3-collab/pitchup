/**
 * MODULE: moderation.application.unban-user-service
 * PURPOSE: Use case — an admin lifts a ban via
 *          `POST /api/admin/users/:id/unban`. Flips `users.banned` back to
 *          false and writes an `unban` audit row. Does NOT restore cancelled
 *          matches (spec global.md → "On unban the profile and matches are not
 *          restored — only the ability to sign in again").
 * LAYER: application
 * DEPENDENCIES: ../domain/errors, ../domain/admin-action-repository,
 *               src/auth/domain/{user, user-repository}
 * CONSUMED BY: src/moderation/composition.ts →
 *              app/api/admin/users/[id]/unban/route.ts
 * INVARIANTS:
 *   - No self-modification guard: an admin acting here holds a valid (unbanned)
 *     session, so they cannot be unbanning themselves — `requireAuth` would
 *     have already 401'd a banned caller.
 *   - Idempotent on a not-banned target → no-op, no audit row.
 *   - `unban` carries NO reason (the spec has no reason modal for it) → audit
 *     `reason` is `null`. `is_admin` is untouched (it was preserved on ban; it
 *     returns to active status automatically — spec global.md).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/users" → `[Unban]`
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion" → unban
 */
import { asUserId } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";

import type { AdminActionRepository } from "../domain/admin-action-repository";
import { AdminTargetNotFoundError } from "../domain/errors";

export interface UnbanUserInput {
  readonly actorAdminId: string;
  readonly targetUserId: string;
}

export class UnbanUserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly adminActionRepository: AdminActionRepository,
  ) {}

  async execute(input: UnbanUserInput): Promise<{ applied: boolean }> {
    const targetId = asUserId(input.targetUserId);
    const target = await this.userRepository.findById(targetId);
    if (target === null) throw new AdminTargetNotFoundError();
    if (!target.banned) return { applied: false };

    await this.userRepository.setBanned(targetId, false);
    await this.adminActionRepository.record({
      actorAdminId: input.actorAdminId,
      targetUserId: input.targetUserId,
      action: "unban",
      reason: null,
    });

    return { applied: true };
  }
}
