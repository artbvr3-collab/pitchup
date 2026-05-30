/**
 * MODULE: match_lifecycle.infrastructure.prisma-admin-match-deletion-repository
 * PURPOSE: Prisma adapter for the `AdminMatchDeletionRepository` port (Layer
 *          9c). Stores ephemeral tombstones for admin-deleted matches so the
 *          global poll can emit { action: 'admin_deleted' } for affected users
 *          up to 24 h after deletion.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/admin-match-deletion-repository
 * CONSUMED BY: src/match_lifecycle/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `record()` is called BEFORE the physical match DELETE (in
 *     AdminDeleteMatchService) so the affected_user_ids are read while the
 *     JoinRequest / Watch rows still exist.
 *   - `findForUserSince()` uses the GIN index on `affected_user_ids` to avoid
 *     a full-table scan. The tombstone table is small (1 row per admin delete)
 *     so a full scan would also be fine, but the index is cleaner.
 *   - `deleteOlderThan()` is called by InboxTtlService (24 h TTL).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → Delete
 *   - docs/spec/pitchup-spec-global.md → "Polling sync" → action: admin_deleted
 */
import type { PrismaClient } from "@prisma/client";

import type { AdminMatchDeletionRepository } from "../domain/admin-match-deletion-repository";

export class PrismaAdminMatchDeletionRepository
  implements AdminMatchDeletionRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async record(
    matchId: string,
    affectedUserIds: readonly string[],
  ): Promise<void> {
    await this.prisma.adminMatchDeletion.create({
      data: {
        matchId,
        affectedUserIds: [...affectedUserIds],
      },
    });
  }

  async findForUserSince(
    userId: string,
    since: Date,
  ): Promise<readonly string[]> {
    // Prisma does not support array-contains with `= ANY()` natively, so we
    // use $queryRaw to leverage the GIN index on affected_user_ids.
    const rows = await this.prisma.$queryRaw<{ match_id: string }[]>`
      SELECT match_id
      FROM admin_match_deletions
      WHERE deleted_at > ${since}
        AND ${userId}::uuid = ANY(affected_user_ids)
    `;
    return rows.map((r) => r.match_id);
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const result = await this.prisma.adminMatchDeletion.deleteMany({
      where: { deletedAt: { lt: before } },
    });
    return result.count;
  }
}
