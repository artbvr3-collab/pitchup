/**
 * MODULE: shared.db.with-transaction
 * PURPOSE: Open a plain Prisma transaction (no advisory lock). Counterpart to
 *          `withMatchLock` for use cases that need multi-statement atomicity
 *          but NOT per-match serialization — currently Layer 7b's
 *          `MorningReminderService`, where each (match, user) pair atomically
 *          INSERTs the `reminder_sent` idempotency row + the `notification`
 *          row. The unique constraint on `reminder_sent_pkey` provides
 *          inter-tx ordering; the advisory lock would be overkill (the cron
 *          processes hundreds of pairs per run).
 * LAYER: shared / infrastructure
 * DEPENDENCIES: ./prisma, ./types
 * CONSUMED BY: src/notifications/application/morning-reminder-service.ts
 * INVARIANTS:
 *   - Default isolation (READ COMMITTED). The cron does not need higher
 *     isolation — the only constraint is the `reminder_sent` unique on
 *     `(match_id, user_id, kind)`, which is enforced regardless of isolation.
 *   - Callers must use the `tx` client for every read/write — falling back
 *     to the un-locked singleton defeats the per-tuple atomicity.
 *   - Same rule as `withMatchLock`: do not call inside another transaction
 *     (Prisma forbids nesting). Cron loops sequentially, one tx per pair.
 * RELATED DOCS:
 *   - docs/ARCHITECTURE.md §8 (Persistence)
 *   - ADR-0003
 */
import { prisma } from "./prisma";
import type { TransactionClient } from "./types";

export async function withTransaction<T>(
  work: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(work);
}
