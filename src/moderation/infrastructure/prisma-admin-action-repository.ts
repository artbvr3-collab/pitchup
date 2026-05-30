/**
 * MODULE: moderation.infrastructure.prisma-admin-action-repository
 * PURPOSE: Prisma adapter for the `AdminActionRepository` port. Appends one
 *          row to `admin_actions` per admin role/ban operation.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/admin-action-repository
 * CONSUMED BY: src/moderation/infrastructure/repositories.ts
 * INVARIANTS:
 *   - Insert-only. No reads / updates / deletes on this table from the app.
 * RELATED DOCS: docs/ARCHITECTURE.md §8 (Persistence).
 */
import type { PrismaClient } from "@prisma/client";

import type { RecordAdminActionInput } from "../domain/admin-action";
import type { AdminActionRepository } from "../domain/admin-action-repository";

export class PrismaAdminActionRepository implements AdminActionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: RecordAdminActionInput): Promise<void> {
    await this.prisma.adminAction.create({
      data: {
        actorAdminId: input.actorAdminId,
        targetUserId: input.targetUserId,
        action: input.action,
        reason: input.reason,
      },
    });
  }
}
