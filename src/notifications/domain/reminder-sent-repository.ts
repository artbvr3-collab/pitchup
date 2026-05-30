/**
 * MODULE: notifications.domain.reminder-sent-repository
 * PURPOSE: Port for the `ReminderSent` cron idempotency ledger (Layer 7b).
 *          Only the TTL cleanup method lands here in this commit — the write
 *          side (`insertIfAbsent` driving `INSERT ... ON CONFLICT DO NOTHING`
 *          for the morning-reminder cron) is added when `MorningReminderService`
 *          ships in a follow-up commit. Keeps each PR coherent.
 * LAYER: domain (port)
 * DEPENDENCIES: none
 * CONSUMED BY: src/notifications/infrastructure/prisma-reminder-sent-repository.ts,
 *              src/notifications/application/inbox-ttl-service.ts
 * INVARIANTS:
 *   - `deleteForMatchesStartingBefore` keys off `match.start_time`, NOT the
 *     ledger row's `created_at`. The spec TTL is "match started > 7 days ago"
 *     (match.md → "Inbox TTL cleanup"). Using `created_at` would expire rows
 *     for future matches that the morning cron wrote ahead of time on a
 *     retry — wrong shape.
 *   - The method runs OUTSIDE any transaction — cron sweeps don't need the
 *     advisory lock (no per-match invariant to preserve; the deleted rows
 *     are technical debris). Mirrors `NotificationRepository.deleteOlderThan`
 *     which is also tx-less for the same reason.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Inbox TTL cleanup"
 *   - ADR-0003
 */

export interface ReminderSentRepository {
  /**
   * Inbox TTL cron (Layer 7b, 03:00 Europe/Prague): DELETE every reminder_sent
   * row whose `match.start_time` is strictly less than `beforeStartTime`.
   * Returns the number of rows removed (for cron logging).
   *
   * Idempotent — a second run within the same day removes zero new rows.
   */
  deleteForMatchesStartingBefore(beforeStartTime: Date): Promise<number>;
}
