/**
 * MODULE: match_lifecycle.application.notify-watching
 * PURPOSE: DRY sub-operation invoked from any service that may flip a match
 *          from `isFull: true → false` (Leave, Kick — Layer 6.5, Edit
 *          total↑ — Layer 6.5, Edit remove-stub — Layer 6.5). Atomic with
 *          the freeing transaction (caller supplies the locked `tx`):
 *            1. Compare before/after isFull. Skip if no flip.
 *            2. Collect the user-id list of current watchers under the lock.
 *            3. Bulk DELETE all Watch rows for the match (one-shot semantics).
 *            4. Return the result for the caller / future Layer 7 dispatcher.
 *          Notification inserts are intentionally deferred to Layer 7 — see
 *          // TODO(Layer 7) markers in the body. The watcher-id list is
 *          captured so the Layer 7 wiring is a single-line insert.
 * LAYER: application
 * DEPENDENCIES (ports): WatchRepository
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
 * TODO(Layer 7 — Notifications):
 *   - Inject `NotificationRepository` via a ports object. Insert one row per
 *     watcher: `notification(type='spot_opened', user_id, match_id, body,
 *     created_at)` INSIDE the same `tx` (spec match.md → "Write ordering:
 *     notifications inside transaction"). Also insert one for the captain
 *     when `notifyCaptain === true`.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "notify watching", "Watching logic",
 *     "Race scenarios — resolution matrix" → "Leave/Kick + watching-notify",
 *     "N watching → one slot"
 *   - docs/spec/pitchup-spec-global.md → "Notifications" → spot_opened
 */
import type { UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import type { MatchId } from "../domain/match";
import type { SlotInfo } from "../domain/slot-math";
import type { WatchRepository } from "../domain/watch-repository";

export interface NotifyWatchingPorts {
  readonly watchRepository: WatchRepository;
  // Layer 7 will add: notificationRepository: NotificationRepository
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

  // TODO(Layer 7): for each id in watcherUserIds:
  //   notificationRepository.insert({
  //     type: 'spot_opened', userId: id, matchId: input.matchId,
  //     body: "🟢 A spot just opened in [match]",
  //   }, input.tx);
  //
  // TODO(Layer 7): if notifyCaptain (i.e. !triggeredByCaptain):
  //   notificationRepository.insert({
  //     type: 'spot_opened', userId: input.captainId,
  //     matchId: input.matchId,
  //     body: "🟢 A spot opened up in your match",
  //   }, input.tx);
  // Spec match.md → "notify watching" step 4 — these inserts MUST live inside
  // the same `tx` so they disappear on rollback. Layer 7 adds the port.

  return {
    watcherUserIds,
    notifyCaptain: !input.triggeredByCaptain,
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
