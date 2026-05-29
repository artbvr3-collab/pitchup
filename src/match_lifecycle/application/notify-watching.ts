/**
 * MODULE: match_lifecycle.application.notify-watching
 * PURPOSE: DRY sub-operation invoked from any service that may flip a match
 *          from `isFull: true → false` (Leave, Kick — Layer 6.5, Edit
 *          total↑ — Layer 6.5, Edit remove-stub — Layer 6.5). Atomic with
 *          the freeing transaction (caller supplies the locked `tx`):
 *            1. Compare before/after isFull. Skip if no flip.
 *            2. Collect the user-id list of current watchers under the lock.
 *            3. Bulk DELETE all Watch rows for the match (one-shot semantics).
 *            4. Insert `spot_opened` notifications (watchers always; captain
 *               only when !triggeredByCaptain) INSIDE the same `tx`, then
 *               return the result for callers / tests.
 * LAYER: application
 * DEPENDENCIES (ports): WatchRepository, NotificationRepository
 * CONSUMED BY: src/match_lifecycle/application/leave-match-service.ts
 *              (Layer 6.5 will add kick-player-service + edit-match-service)
 * INVARIANTS:
 *   - The helper does NOT acquire its own lock. The caller (a service
 *     already inside `withMatchLock`) passes the same `tx`. This keeps the
 *     "one advisory lock per transaction" rule from `ARCHITECTURE.md §8`.
 *   - The fan-out runs ONLY on `isFull` true → false. Other transitions
 *     (true → true, false → true, false → false) are no-ops. Spec
 *     match.md → "notify watching (DRY sub-operation inside a transaction)".
 *   - All Watch rows are deleted in a single `deleteAllForMatch` statement
 *     to keep the operation atomic and idempotent (zero rows is fine).
 *   - Captain self-trigger skip: if the slot was freed by the captain
 *     themselves (Edit total↑, Kick), the captain does NOT receive the
 *     "A spot opened up" push. Only on Leave does the captain get it (they
 *     didn't free the slot themselves). Spec match.md → `notify watching`
 *     step 4. The result flag `notifyCaptain` carries this decision so the
 *     Layer 7 caller doesn't re-derive it.
 *   - Returns immediately when the flip didn't happen — saves a round-trip
 *     to the watch table.
 *   - Layer 7: `spot_opened` notifications are inserted here via the injected
 *     `NotificationRepository.insertMany` — watchers always, captain only when
 *     `notifyCaptain` (i.e. !triggeredByCaptain). All inside the caller's `tx`
 *     (spec match.md → "Write ordering: notifications inside transaction").
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "notify watching", "Watching logic",
 *     "Race scenarios — resolution matrix" → "Leave/Kick + watching-notify",
 *     "N watching → one slot"
 *   - docs/spec/pitchup-spec-global.md → "Notifications" → spot_opened
 */
import type { UserId } from "@/src/auth/domain/user";
import type { NewNotification } from "@/src/notifications/domain/notification";
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";
import type { NotificationRepository } from "@/src/notifications/domain/notification-repository";
import type { TransactionClient } from "@/src/shared/db/types";

import type { MatchId } from "../domain/match";
import type { SlotInfo } from "../domain/slot-math";
import type { WatchRepository } from "../domain/watch-repository";

export interface NotifyWatchingPorts {
  readonly watchRepository: WatchRepository;
  readonly notificationRepository: NotificationRepository;
}

export interface NotifyWatchingInput {
  readonly matchId: MatchId;
  /** `computeSlots(match, before)` — captured by the caller pre-mutation. */
  readonly slotsBefore: SlotInfo;
  /** `computeSlots(match, after)` — captured post-mutation, still under lock. */
  readonly slotsAfter: SlotInfo;
  /** Used by Layer 7 to address the captain notification. */
  readonly captainId: UserId;
  /**
   * `true` when the slot was freed by a captain action (Edit total↑, Kick).
   * Captain self-trigger skip applies — `notifyCaptain` in the result is
   * `false`. `false` for Leave (player-initiated), where the captain DOES
   * receive an in-app push.
   */
  readonly triggeredByCaptain: boolean;
  readonly tx: TransactionClient;
}

export interface NotifyWatchingResult {
  /** Empty list iff the flip didn't fire (or no one was watching). */
  readonly watcherUserIds: readonly UserId[];
  /** Mirrors the captain self-trigger skip rule. */
  readonly notifyCaptain: boolean;
  /** True when the isFull flip actually happened and the fan-out ran. */
  readonly fired: boolean;
  /** Number of Watch rows removed (for logging). */
  readonly watchRowsDeleted: number;
}

export async function notifyWatching(
  ports: NotifyWatchingPorts,
  input: NotifyWatchingInput,
): Promise<NotifyWatchingResult> {
  const flipped = input.slotsBefore.isFull && !input.slotsAfter.isFull;
  if (!flipped) {
    return {
      watcherUserIds: [],
      notifyCaptain: false,
      fired: false,
      watchRowsDeleted: 0,
    };
  }

  // Capture before delete — spec match.md "step 2" of notify watching.
  const watcherUserIds = await ports.watchRepository.listForMatch(
    input.matchId,
    input.tx,
  );
  const watchRowsDeleted = await ports.watchRepository.deleteAllForMatch(
    input.matchId,
    input.tx,
  );

  // Spec match.md → "notify watching" step 4: the spot_opened inserts live
  // INSIDE the caller's `tx`, so they roll back with the freeing mutation.
  // Watchers always get the push; the captain only on a player-initiated free
  // (Leave). `triggeredByCaptain` suppresses the captain's self-push on
  // Kick / Edit total↑ / stub removal.
  const notifyCaptain = !input.triggeredByCaptain;
  const notifications: NewNotification[] = watcherUserIds.map((userId) => ({
    userId,
    type: "spot_opened",
    matchId: input.matchId,
    body: NOTIFICATION_BODIES.spotOpenedWatcher,
  }));
  if (notifyCaptain) {
    notifications.push({
      userId: input.captainId,
      type: "spot_opened",
      matchId: input.matchId,
      body: NOTIFICATION_BODIES.spotOpenedCaptain,
    });
  }
  await ports.notificationRepository.insertMany(notifications, input.tx);

  return {
    watcherUserIds,
    notifyCaptain,
    fired: true,
    watchRowsDeleted,
  };
}

/**
 * Helper for service-side accounting. The slot delta after Leave/Kick is
 * `1 + guestCount` (the host + their anonymous companions); the service
 * already has these numbers, but exporting an explicit helper keeps the
 * `slotsBefore`/`slotsAfter` computation symmetric across call sites.
 *
 * Not used inside `notifyWatching` itself — it receives the pre-computed
 * SlotInfo objects.
 */
export function freedSlots(guestCount: number): number {
  return 1 + guestCount;
}
