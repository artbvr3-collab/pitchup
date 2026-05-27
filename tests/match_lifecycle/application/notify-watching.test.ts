/**
 * MODULE: tests.match_lifecycle.application.notify-watching
 * PURPOSE: Cover the `isFull: true → false` flip semantics of the notify-
 *          watching helper: only fires on the flip; idempotently captures
 *          then deletes all Watch rows; `notifyCaptain` mirrors the
 *          captain self-trigger skip rule.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/notify-watching.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "notify watching (DRY sub-operation)",
 *     "Race scenarios — resolution matrix" → "N watching → one slot",
 *     "Leave/Kick + watching-notify"
 */
import { describe, expect, it } from "vitest";

import { notifyWatching } from "@/src/match_lifecycle/application/notify-watching";
import type { SlotInfo } from "@/src/match_lifecycle/domain/slot-math";

import {
  FAKE_TX,
  FakeWatchRepository,
  OTHER_PLAYER_ID,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
} from "../_helpers/fakes";

function slots(args: {
  filled: number;
  capacity: number;
  free: number;
  isFull: boolean;
}): SlotInfo {
  return args;
}

const FULL = slots({ filled: 14, capacity: 14, free: 0, isFull: true });
const ONE_FREE = slots({ filled: 13, capacity: 14, free: 1, isFull: false });
const TWO_FREE = slots({ filled: 12, capacity: 14, free: 2, isFull: false });

describe("notifyWatching", () => {
  it("does not fire when isFull stays true → true", async () => {
    const watchRepo = new FakeWatchRepository();
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);

    const result = await notifyWatching(
      { watchRepository: watchRepo },
      {
        matchId: SEED_MATCH_ID,
        slotsBefore: FULL,
        slotsAfter: FULL,
        captainId: SEED_CAPTAIN_ID,
        triggeredByCaptain: false,
        tx: FAKE_TX,
      },
    );

    expect(result.fired).toBe(false);
    expect(result.watcherUserIds).toEqual([]);
    expect(result.watchRowsDeleted).toBe(0);
    // Watch row survives.
    expect(watchRepo.has(SEED_MATCH_ID, SEED_PLAYER_ID)).toBe(true);
  });

  it("does not fire when isFull stays false → false (Leave on a non-full match)", async () => {
    const watchRepo = new FakeWatchRepository();
    const result = await notifyWatching(
      { watchRepository: watchRepo },
      {
        matchId: SEED_MATCH_ID,
        slotsBefore: TWO_FREE,
        slotsAfter: ONE_FREE,
        captainId: SEED_CAPTAIN_ID,
        triggeredByCaptain: false,
        tx: FAKE_TX,
      },
    );
    expect(result.fired).toBe(false);
  });

  it("fires on true → false: captures all watchers and bulk-deletes", async () => {
    const watchRepo = new FakeWatchRepository();
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);

    const result = await notifyWatching(
      { watchRepository: watchRepo },
      {
        matchId: SEED_MATCH_ID,
        slotsBefore: FULL,
        slotsAfter: ONE_FREE,
        captainId: SEED_CAPTAIN_ID,
        triggeredByCaptain: false,
        tx: FAKE_TX,
      },
    );

    expect(result.fired).toBe(true);
    expect(result.watcherUserIds.length).toBe(2);
    expect(result.watcherUserIds).toContain(SEED_PLAYER_ID);
    expect(result.watcherUserIds).toContain(OTHER_PLAYER_ID);
    expect(result.watchRowsDeleted).toBe(2);
    expect(result.notifyCaptain).toBe(true); // !triggeredByCaptain

    // All Watch rows wiped in one go.
    expect(watchRepo.has(SEED_MATCH_ID, SEED_PLAYER_ID)).toBe(false);
    expect(watchRepo.has(SEED_MATCH_ID, OTHER_PLAYER_ID)).toBe(false);
    expect(watchRepo.bulkDeleted).toEqual([{ matchId: SEED_MATCH_ID, count: 2 }]);
  });

  it("triggeredByCaptain → notifyCaptain === false (captain self-trigger skip)", async () => {
    const watchRepo = new FakeWatchRepository();
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);

    const result = await notifyWatching(
      { watchRepository: watchRepo },
      {
        matchId: SEED_MATCH_ID,
        slotsBefore: FULL,
        slotsAfter: ONE_FREE,
        captainId: SEED_CAPTAIN_ID,
        triggeredByCaptain: true,
        tx: FAKE_TX,
      },
    );

    expect(result.fired).toBe(true);
    expect(result.notifyCaptain).toBe(false);
    expect(result.watcherUserIds.length).toBe(1);
  });

  it("fires with zero watchers (full match no one was watching) — still wipes nothing", async () => {
    const watchRepo = new FakeWatchRepository();
    // No watchers seeded.

    const result = await notifyWatching(
      { watchRepository: watchRepo },
      {
        matchId: SEED_MATCH_ID,
        slotsBefore: FULL,
        slotsAfter: ONE_FREE,
        captainId: SEED_CAPTAIN_ID,
        triggeredByCaptain: false,
        tx: FAKE_TX,
      },
    );

    expect(result.fired).toBe(true);
    expect(result.watcherUserIds).toEqual([]);
    expect(result.watchRowsDeleted).toBe(0);
    // Bulk delete still called (idempotent — zero rows is normal).
    expect(watchRepo.bulkDeleted).toEqual([{ matchId: SEED_MATCH_ID, count: 0 }]);
  });
});
