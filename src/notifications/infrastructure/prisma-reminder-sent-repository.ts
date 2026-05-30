/**
 * MODULE: notifications.infrastructure.prisma-reminder-sent-repository
 * PURPOSE: Prisma adapter for `ReminderSentRepository`. In this commit only
 *          the TTL cleanup method is implemented; the write side lands with
 *          `MorningReminderService` in Layer 7b.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/reminder-sent-repository
 * CONSUMED BY: src/notifications/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `deleteForMatchesStartingBefore` uses Prisma's relation filter
 *     (`{ match: { startTime: { lt: ... } } }`) which compiles to a JOIN-or-
 *     IN-subquery DELETE — both shapes use the `matches(start_time)` index
 *     and the `reminder_sent_pkey` index (composite PK starts with match_id).
 *     No N+1.
 *   - Runs OUTSIDE any transaction. Cron sweeps don't take the advisory lock.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Cron jobs → Inbox TTL cleanup"
 */
import type { PrismaClient } from "@prisma/client";

import type { ReminderSentRepository } from "../domain/reminder-sent-repository";

export class PrismaReminderSentRepository implements ReminderSentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async deleteForMatchesStartingBefore(beforeStartTime: Date): Promise<number> {
    const res = await this.prisma.reminderSent.deleteMany({
      where: { match: { startTime: { lt: beforeStartTime } } },
    });
    return res.count;
  }
}
