/**
 * MODULE: notifications.infrastructure.prisma-reminder-sent-repository
 * PURPOSE: Prisma adapter for `ReminderSentRepository`. Two halves:
 *          - `insertIfAbsent` translates ON CONFLICT DO NOTHING via Prisma's
 *            `try/catch on create()` idiom (no raw SQL). Discriminates the
 *            unique-violation P2002 code as `'existed'`; any other error
 *            propagates.
 *          - `deleteForMatchesStartingBefore` uses Prisma's relation filter.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/notifications/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `insertIfAbsent` runs INSIDE the caller's transaction (`tx` is
 *     mandatory). The Prisma `tx.reminderSent.create` shares isolation with
 *     the caller's notification insert; on rollback both vanish.
 *   - `deleteForMatchesStartingBefore` relation filter compiles to a JOIN
 *     or EXISTS subquery — uses `matches(start_time)` + `reminder_sent_pkey`.
 *     Runs OUTSIDE any transaction.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Cron jobs"
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import type { TransactionClient } from "@/src/shared/db/types";

import type { ReminderKind } from "../domain/reminder-sent";
import type {
  InsertIfAbsentOutcome,
  ReminderSentRepository,
} from "../domain/reminder-sent-repository";

export class PrismaReminderSentRepository implements ReminderSentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insertIfAbsent(
    matchId: string,
    userId: string,
    kind: ReminderKind,
    tx: TransactionClient,
  ): Promise<InsertIfAbsentOutcome> {
    try {
      await tx.reminderSent.create({
        data: { matchId, userId, kind },
      });
      return "inserted";
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return "existed";
      }
      throw err;
    }
  }

  async deleteForMatchesStartingBefore(beforeStartTime: Date): Promise<number> {
    const res = await this.prisma.reminderSent.deleteMany({
      where: { match: { startTime: { lt: beforeStartTime } } },
    });
    return res.count;
  }
}
