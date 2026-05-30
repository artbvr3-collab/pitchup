/**
 * MODULE: notifications.application.inbox-ttl-service
 * PURPOSE: Cron #4 (Layer 7b) — once-daily janitor at 03:00 Europe/Prague.
 *          Deletes three families of stale rows in a fixed order:
 *            1. `notifications` older than 30 days (in-app inbox tail prune).
 *            2. `reminder_sent` for matches that started > 7 days ago
 *               (ledger TTL — see ReminderSentRepository docstring).
 *            3. `watches` on matches that started > 1 day ago (safety net
 *               for skipped auto-reject cron runs; primary Watch cleanup
 *               at match-start lives in AutoRejectPendingService).
 * LAYER: application (cross-context: uses match_lifecycle's WatchRepository,
 *        same allowed pattern as UpdatesStateService).
 * DEPENDENCIES (ports): NotificationRepository, ReminderSentRepository (own
 *                       context), WatchRepository (match_lifecycle).
 * CONSUMED BY: src/notifications/composition.ts, scripts/run-cron.ts (future).
 * INVARIANTS:
 *   - `now` is a method parameter, NOT injected via constructor. Mirrors the
 *     `prague.ts` convention — pure functions take time as input so the CLI
 *     runner can pass `--now=ISO` for DST-edge dry runs without touching the
 *     wiring.
 *   - Day = 24 hours, NOT a Prague calendar day. The TTLs are "≥ N hours ago"
 *     bounds, not "rows whose Prague date is ≥ N days before today". The
 *     PRAGUE part of the spec only governs WHEN the cron fires (the runner's
 *     job, not this service); the cutoffs themselves are absolute deltas.
 *   - Fixed order is for predictability/observability only — the three
 *     deletes are independent and could run in parallel. Order chosen by
 *     longest-TTL-first (30 → 7 → 1 days) to make log scanning easier.
 *   - Each delete is idempotent: re-running within the same hour removes
 *     zero new rows. A crash mid-run is recoverable by re-invoking.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Inbox TTL cleanup"
 *   - docs/spec/pitchup-app-map.md → "Cron jobs" table
 */
import type { WatchRepository } from "@/src/match_lifecycle/domain/watch-repository";

import type { NotificationRepository } from "../domain/notification-repository";
import type { ReminderSentRepository } from "../domain/reminder-sent-repository";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const INBOX_TTL_NOTIFICATIONS_DAYS = 30;
export const INBOX_TTL_REMINDER_SENT_DAYS = 7;
export const INBOX_TTL_WATCH_DAYS = 1;

export interface InboxTtlPorts {
  readonly notifications: NotificationRepository;
  readonly reminders: ReminderSentRepository;
  readonly watches: WatchRepository;
}

export interface InboxTtlResult {
  readonly notificationsDeleted: number;
  readonly remindersDeleted: number;
  readonly watchesDeleted: number;
}

export class InboxTtlService {
  constructor(private readonly ports: InboxTtlPorts) {}

  async run(now: Date): Promise<InboxTtlResult> {
    const nowMs = now.getTime();
    const notificationCutoff = new Date(nowMs - INBOX_TTL_NOTIFICATIONS_DAYS * DAY_MS);
    const reminderCutoff = new Date(nowMs - INBOX_TTL_REMINDER_SENT_DAYS * DAY_MS);
    const watchCutoff = new Date(nowMs - INBOX_TTL_WATCH_DAYS * DAY_MS);

    const notificationsDeleted =
      await this.ports.notifications.deleteOlderThan(notificationCutoff);
    const remindersDeleted =
      await this.ports.reminders.deleteForMatchesStartingBefore(reminderCutoff);
    const watchesDeleted =
      await this.ports.watches.deleteForMatchesStartingBefore(watchCutoff);

    return { notificationsDeleted, remindersDeleted, watchesDeleted };
  }
}
