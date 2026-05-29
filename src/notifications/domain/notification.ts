/**
 * MODULE: notifications.domain.notification
 * PURPOSE: Notification entity + the closed `type` enum. Pure data, no I/O.
 *          One row = one in-app inbox item (and, for a subset of types, one
 *          email / browser push in Layer 7b). `body` is a ready-made EN string
 *          written at the source event — there are NO client-side templates
 *          (spec global.md → "Notifications" → "Data model").
 * LAYER: domain
 * DEPENDENCIES: none (stdlib types only)
 * CONSUMED BY: src/notifications/domain/notification-repository.ts,
 *              src/notifications/application/*, src/notifications/infrastructure/*
 * INVARIANTS:
 *   - `type` is one of NOTIFICATION_TYPES. Stored as a `text` column,
 *     app-validated (not a Postgres enum — same convention as
 *     `JoinRequest.status` / `Match.surface`).
 *   - `matchId` is nullable for future match-less types; in v1 every event is
 *     about a match, so it is always populated.
 *   - `userId` / `matchId` are plain `string` here — the notifications context
 *     does not import the branded `UserId` / `MatchId` from other contexts
 *     (domain/ must not cross context boundaries; AGENTS.md §"cross-context").
 *     Branded ids from match_lifecycle / auth are assignable to `string`, so
 *     callers pass them directly.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Notifications", "Polling sync"
 *   - docs/spec/pitchup-app-map.md → entity "Notification"
 */

/**
 * Closed set of notification types. Source of truth: app-map ERD → Notification
 * + global.md → "action → notification.type mapping".
 */
export type NotificationType =
  | "approved"
  | "rejected"
  | "kicked"
  | "match_cancelled"
  | "match_updated"
  | "spot_opened"
  | "morning_reminder";

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "approved",
  "rejected",
  "kicked",
  "match_cancelled",
  "match_updated",
  "spot_opened",
  "morning_reminder",
];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/**
 * Write-side shape — what a source event inserts. `createdAt` defaults to
 * `now()` in the DB and `readAt` starts NULL, so neither is part of the input.
 */
export interface NewNotification {
  readonly userId: string;
  readonly type: NotificationType;
  readonly matchId: string | null;
  readonly body: string;
}

/** Read-side shape — what the Updates panel / poll endpoint renders. */
export interface NotificationRow {
  readonly id: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly matchId: string | null;
  readonly body: string;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}
