/**
 * MODULE: notifications.domain.notification-repository
 * PURPOSE: Port for persisting + reading notifications. Implemented by a Prisma
 *          adapter in infrastructure/ (ADR-0003). Two families of methods:
 *            - WRITE (insert / insertMany): take a MANDATORY `tx`. They are only
 *              ever called from inside an existing locked transaction (the
 *              match-mutating services + notify watching). Spec global.md →
 *              "Writing new records ... INSERT notification(...) inside the same
 *              transaction as the primary operation" + match.md → "Write
 *              ordering". A non-optional `tx` makes that invariant unskippable.
 *            - READ / standalone (listRecent / hasUnread / markAllRead /
 *              deleteOlderThan): NO `tx`. They run as their own atomic
 *              statements against the singleton Prisma client — the poll
 *              endpoint, the mark-all-read endpoint, and the TTL cron each call
 *              exactly one of these with no surrounding transaction.
 * LAYER: domain (port)
 * DEPENDENCIES: src/shared/db/types (TransactionClient — the one Prisma type
 *               allowed in port signatures per ADR-0003, mirrors every other
 *               repository port in the codebase).
 * CONSUMED BY: src/notifications/infrastructure/prisma-notification-repository.ts,
 *              match_lifecycle services (write), UpdatesStateService (read).
 * INVARIANTS:
 *   - `insert` / `insertMany` require `tx` — they disappear on rollback with
 *     the primary mutation. Never call them outside `withMatchLock`.
 *   - `markAllRead` updates EVERY unread row for the user (no LIMIT) — the red
 *     dot must clear completely, including items beyond the top-20 panel window
 *     (spec global.md → "Mark-as-read"). No advisory lock: per-user, single
 *     writer, last-write-wins (same reasoning as UpdateProfile / UnwatchMatch).
 *   - `hasUnread` is a boolean EXISTS, not a count — drives the red dot only.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Notifications", "Polling sync"
 *   - docs/spec/pitchup-spec-match.md → "Write ordering"
 *   - ADR-0003
 */
import type { TransactionClient } from "@/src/shared/db/types";

import type { NewNotification, NotificationRow } from "./notification";

export interface NotificationRepository {
  /** Insert one row INSIDE the caller's locked transaction. */
  insert(notification: NewNotification, tx: TransactionClient): Promise<void>;

  /**
   * Insert many rows in one statement INSIDE the caller's locked transaction.
   * Empty input is a no-op (zero rows is fine). Used for fan-outs (cancel →
   * accepted + former-pending, edit → accepted, notify watching → watchers).
   */
  insertMany(
    notifications: readonly NewNotification[],
    tx: TransactionClient,
  ): Promise<void>;

  /** Latest `limit` rows for the user, `created_at DESC`. Default 20. */
  listRecent(userId: string, limit?: number): Promise<readonly NotificationRow[]>;

  /** Boolean EXISTS(read_at IS NULL) — drives the 🔔 red dot. */
  hasUnread(userId: string): Promise<boolean>;

  /** UPDATE every unread row → read_at = now() for the user (no LIMIT). */
  markAllRead(userId: string): Promise<void>;

  /** TTL cron (Layer 7b): delete rows older than `cutoff`. Returns deleted count. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
