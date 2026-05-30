/**
 * MODULE: notifications.domain.reminder-sent
 * PURPOSE: Domain value types for the `ReminderSent` cron idempotency ledger.
 *          One row per `(match, user, kind)` records that a cron-driven send
 *          fired so a repeated run (process restart, second cron instance,
 *          manual replay) never produces a duplicate.
 * LAYER: domain
 * DEPENDENCIES: none (pure constants)
 * CONSUMED BY: src/notifications/domain/reminder-sent-repository.ts,
 *              future MorningReminderService (Layer 7b).
 * INVARIANTS:
 *   - `REMINDER_KINDS` is the EXACT set of `kind` values valid for the table
 *     (app-level enum, same convention as `Notification.type` and
 *     `Match.surface` — no Postgres enum). Adding a new kind is a constant
 *     change, no migration.
 *   - In v1 the only kind is `morning_reminder`; the spec lists no others
 *     (match.md → "Cron jobs"). The plural-shaped tuple is here so the type
 *     stays a union once Layer 7b adds further reminders (e.g. tournament,
 *     ladder) without changing call sites.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Duplicate guard"
 *   - docs/spec/pitchup-app-map.md → ERD → ReminderSent
 */

export const REMINDER_KINDS = ["morning_reminder"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
