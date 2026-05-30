/**
 * MODULE: notifications.domain.reminder-sent-repository
 * PURPOSE: Port for the `ReminderSent` cron idempotency ledger (Layer 7b).
 *          Two halves:
 *            - `insertIfAbsent` is the WRITE side used by `MorningReminderService`
 *              before it fires the in-app notification + email. Maps the SQL
 *              `INSERT ... ON CONFLICT DO NOTHING` idiom — the spec's chosen
 *              guard against duplicate sends on cron retry / restart.
 *            - `deleteForMatchesStartingBefore` is the READ-tail TTL cleanup
 *              used by `InboxTtlService`.
 * LAYER: domain (port)
 * DEPENDENCIES: src/shared/db/types (TransactionClient)
 * CONSUMED BY: src/notifications/infrastructure/prisma-reminder-sent-repository.ts,
 *              src/notifications/application/inbox-ttl-service.ts,
 *              src/notifications/application/morning-reminder-service.ts
 * INVARIANTS:
 *   - `insertIfAbsent` takes a MANDATORY `tx` — it's always paired with a
 *     `NotificationRepository.insert` inside `withTransaction`, so the
 *     ledger row and the inbox row commit together (or both roll back on
 *     conflict). Same shape as `NotificationRepository.insert` which is
 *     also tx-required.
 *   - `deleteForMatchesStartingBefore` keys off `match.start_time`, NOT the
 *     ledger row's `created_at`. The spec TTL is "match started > 7 days
 *     ago" (match.md → "Inbox TTL cleanup"). Using `created_at` would expire
 *     rows for future matches that the morning cron wrote ahead of time on
 *     a retry — wrong shape.
 *   - `deleteForMatchesStartingBefore` runs OUTSIDE any transaction —
 *     mirrors `NotificationRepository.deleteOlderThan`.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Duplicate guard on
 *     retries / process restarts", "Inbox TTL cleanup"
 *   - ADR-0003
 */
import type { TransactionClient } from "@/src/shared/db/types";

import type { ReminderKind } from "./reminder-sent";

export type InsertIfAbsentOutcome = "inserted" | "existed";

export interface ReminderSentRepository {
  /**
   * Write the idempotency row for `(matchId, userId, kind)` if it does not
   * already exist. Returns `'inserted'` when this call created the row
   * (caller proceeds to write the notification + email), `'existed'` when
   * a row was already present (caller skips both side-effects).
   *
   * Implemented via INSERT ... ON CONFLICT DO NOTHING — the unique
   * constraint on the composite PK turns concurrent cron runs (or retries
   * after a partial crash) into a deterministic single-winner outcome
   * without an advisory lock.
   */
  insertIfAbsent(
    matchId: string,
    userId: string,
    kind: ReminderKind,
    tx: TransactionClient,
  ): Promise<InsertIfAbsentOutcome>;

  /**
   * Inbox TTL cron (Layer 7b, 03:00 Europe/Prague): DELETE every reminder_sent
   * row whose `match.start_time` is strictly less than `beforeStartTime`.
   * Returns the number of rows removed (for cron logging).
   *
   * Idempotent — a second run within the same day removes zero new rows.
   */
  deleteForMatchesStartingBefore(beforeStartTime: Date): Promise<number>;
}
