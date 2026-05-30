/**
 * MODULE: notifications.application.morning-reminder-service
 * PURPOSE: Crons #1 and #2 (Layer 7b) — morning-of-match reminder.
 *            - 10:00 Europe/Prague: matches with `start_time` today AND
 *              `start_time >= now`. Window = `[now, prague_midnight_tomorrow)`.
 *              Body = `morningReminderToday` ("💬 Match today").
 *            - 20:00 Europe/Prague: matches with `start_time` tomorrow
 *              00:00–11:59 Prague. Window = `[prague_midnight_tomorrow,
 *              prague_noon_tomorrow)`. Body = `morningReminderTomorrow`
 *              ("💬 Match tomorrow").
 *          For every (match, recipient) pair — recipients = captain +
 *          accepted players — the service atomically writes a
 *          `reminder_sent` ledger row and (only on successful INSERT) an
 *          in-app `notification` row. A future commit adds the email send
 *          via Resend (TODO marker below) which respects
 *          `users.email_notifications`.
 * LAYER: application (cross-context: uses match_lifecycle's MatchRepository
 *        and JoinRequestRepository, mirror of InboxTtlService / UpdatesStateService).
 * DEPENDENCIES (ports): MatchRepository + JoinRequestRepository (match_lifecycle),
 *                       NotificationRepository + ReminderSentRepository (own
 *                       context). Uses `withTransaction` for per-pair atomicity.
 * CONSUMED BY: src/notifications/composition.ts, scripts/run-cron.ts (future)
 * INVARIANTS:
 *   - `now` is a method parameter. Production cron passes `new Date()`; the
 *     CLI runner passes a parsed `--now=ISO` for DST dry runs. Mirrors
 *     `InboxTtlService` and `AutoRejectPendingService`.
 *   - The `window` arg picks which Prague-relative bounds to compute. The
 *     CALLER (the cron runner) decides which window based on which cron
 *     slot fired (10:00 → today, 20:00 → tomorrow). The service never
 *     derives the window from `now` alone.
 *   - "Today" window lower bound is `now`, NOT prague-midnight-today — the
 *     spec excludes matches that have already started. Upper bound is
 *     prague-midnight-tomorrow, which is DST-correct via prague.ts helpers.
 *   - "Tomorrow" window is `[prague_midnight_tomorrow, prague_noon_tomorrow)`,
 *     both computed via prague.ts helpers (so the 02:00–03:00 DST skip/repeat
 *     on the two DST Sundays is handled correctly).
 *   - Cancelled matches are excluded at the repository layer
 *     (`findActiveStartingInWindow` filters `cancelledAt IS NULL`).
 *   - Recipients = captain + accepted JR holders. Pending / watching /
 *     rejected / left / kicked / cancelled are NOT reminded — they haven't
 *     confirmed (spec match.md §441 + global.md "morning_reminder").
 *   - Atomicity per (match, user): the ledger INSERT and the notification
 *     INSERT live inside ONE `withTransaction`. On unique-violation in the
 *     ledger (cron retry / concurrent instance / process restart) the tx
 *     short-circuits to `'existed'` and skips the notification. On any
 *     other error the tx rolls back — the ledger is empty, the next run
 *     will retry the same pair.
 *   - Email is deferred (TODO marker below). When Resend ships, it goes
 *     INSIDE the same tx as the ledger + notification INSERT — same
 *     "exactly-once via ledger gate" guarantee. The send must respect
 *     `users.email_notifications` (in-app inbox is never gated; email is).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Morning-of-match
 *     reminder" (incl. DST edges)
 *   - docs/spec/pitchup-app-map.md → "Cron jobs" + "Notifications" tables
 */
import type { JoinRequestRepository } from "@/src/match_lifecycle/domain/join-request-repository";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import type { MatchRepository } from "@/src/match_lifecycle/domain/match-repository";
import { withTransaction } from "@/src/shared/db/with-transaction";
import {
  addPragueDays,
  pragueDay,
  pragueWallTimeAsUtc,
  todayPrague,
} from "@/src/shared/time/prague";

import { NOTIFICATION_BODIES } from "../domain/notification-bodies";
import type { NotificationRepository } from "../domain/notification-repository";
import type { ReminderSentRepository } from "../domain/reminder-sent-repository";

export type MorningReminderWindow = "today" | "tomorrow";

export interface MorningReminderResult {
  readonly window: MorningReminderWindow;
  readonly matchesScanned: number;
  readonly recipientsConsidered: number;
  /** Per-pair attempts that resulted in a fresh INSERT (notification fired). */
  readonly remindersSent: number;
  /** Per-pair attempts that hit ON CONFLICT (ledger row already present). */
  readonly alreadySent: number;
}

interface MorningReminderPorts {
  readonly matches: MatchRepository;
  readonly joinRequests: JoinRequestRepository;
  readonly notifications: NotificationRepository;
  readonly reminders: ReminderSentRepository;
}

export class MorningReminderService {
  constructor(private readonly ports: MorningReminderPorts) {}

  async run(args: {
    now: Date;
    window: MorningReminderWindow;
  }): Promise<MorningReminderResult> {
    const [start, end] = computeWindow(args.now, args.window);
    const body =
      args.window === "today"
        ? NOTIFICATION_BODIES.morningReminderToday
        : NOTIFICATION_BODIES.morningReminderTomorrow;

    const matches = await this.ports.matches.findActiveStartingInWindow(
      start,
      end,
    );

    let recipientsConsidered = 0;
    let remindersSent = 0;
    let alreadySent = 0;

    for (const match of matches) {
      const accepted = await this.ports.joinRequests.listAcceptedForMatch(
        asMatchId(match.id),
      );
      // Captain first (deterministic order helps logs); accepted players follow.
      const recipientIds: readonly string[] = [
        match.captainId,
        ...accepted.map((jr) => jr.userId),
      ];

      for (const userId of recipientIds) {
        recipientsConsidered += 1;
        const outcome = await withTransaction(async (tx) => {
          const ledger = await this.ports.reminders.insertIfAbsent(
            match.id,
            userId,
            "morning_reminder",
            tx,
          );
          if (ledger === "existed") return "existed" as const;

          await this.ports.notifications.insert(
            {
              userId,
              type: "morning_reminder",
              matchId: match.id,
              body,
            },
            tx,
          );

          // TODO(Layer 7b email): Resend send goes here, INSIDE the same tx
          // so the ledger + inbox + email are all-or-nothing. Must respect
          // `users.email_notifications` (in-app row is unconditional, email
          // is opt-in per user). Throwing here is fine — the tx rolls back
          // the ledger + notification, and the next cron run retries.

          return "inserted" as const;
        });

        if (outcome === "inserted") remindersSent += 1;
        else alreadySent += 1;
      }
    }

    return {
      window: args.window,
      matchesScanned: matches.length,
      recipientsConsidered,
      remindersSent,
      alreadySent,
    };
  }
}

/**
 * Compute the half-open UTC interval `[start, end)` covering the cron's
 * Prague-relative window. All DST math lives in prague.ts.
 */
function computeWindow(
  now: Date,
  window: MorningReminderWindow,
): readonly [Date, Date] {
  const today = todayPrague(now);
  const tomorrow = addPragueDays(today, 1);

  if (window === "today") {
    // [now, prague_midnight_tomorrow) — already excludes matches before now
    // even if the cron fires slightly before 10:00 Prague.
    return [now, pragueDay(today).utcEnd] as const;
  }
  // [prague_midnight_tomorrow, prague_noon_tomorrow)
  return [
    pragueDay(tomorrow).utcStart,
    pragueWallTimeAsUtc(tomorrow, 12),
  ] as const;
}
