/**
 * MODULE: tests.match_lifecycle.application.auto-reject-pending-service
 * PURPOSE: Cover cron #3 (Layer 7b): discovery → per-match advisory lock
 *          → massRejectPending → notification fan-out → watch wipe.
 *          Includes race idempotency (empty rejected → no side effects),
 *          batched multi-match runs, and the canonical body string.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/auto-reject-pending-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Cron auto-reject
 *     pending on match start", per-endpoint checklist row "Cron
 *     auto-reject pending"
 */
import { describe, expect, it, vi } from "vitest";

import { AutoRejectPendingService } from "@/src/match_lifecycle/application/auto-reject-pending-service";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";

import {
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeNotificationRepository,
  FakeWatchRepository,
  OTHER_PLAYER_ID,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  makeMatch,
} from "../_helpers/fakes";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

const PAST = new Date("2026-05-30T10:00:00Z");
const FUTURE = new Date("2026-05-30T20:00:00Z");
const NOW = new Date("2026-05-30T15:00:00Z");

function setup() {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const notifications = new FakeNotificationRepository();
  const service = new AutoRejectPendingService(
    matchRepo,
    joinRepo,
    watchRepo,
    notifications,
  );
  return { service, matchRepo, joinRepo, watchRepo, notifications };
}

describe("AutoRejectPendingService", () => {
  it("returns zeros when no match has pending past start_time", async () => {
    const { service } = setup();

    const result = await service.run(NOW);

    expect(result).toEqual({
      matchesScanned: 0,
      matchesProcessed: 0,
      pendingRejected: 0,
      watchesDeleted: 0,
    });
  });

  it("rejects pending, inserts 'rejected' notification with rejectedMatchStarted body, wipes watch", async () => {
    const { service, matchRepo, joinRepo, watchRepo, notifications } = setup();
    matchRepo.put(makeMatch({ startTime: PAST }));
    matchRepo.markHasPending(SEED_MATCH_ID);
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: OTHER_PLAYER_ID,
      status: "pending",
    });
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);

    const result = await service.run(NOW);

    expect(result).toEqual({
      matchesScanned: 1,
      matchesProcessed: 1,
      pendingRejected: 2,
      watchesDeleted: 1,
    });

    // Both pending → rejected with auto_reason='match_started'.
    expect(joinRepo.updates).toHaveLength(2);
    for (const u of joinRepo.updates) {
      expect(u.status).toBe("rejected");
      expect(u.autoReason).toBe("match_started");
    }

    // Notification fan-out: one per former-pending player, canonical body.
    expect(notifications.inserted).toHaveLength(2);
    expect(notifications.inserted.map((n) => n.userId).sort()).toEqual(
      [SEED_PLAYER_ID, OTHER_PLAYER_ID].sort(),
    );
    for (const n of notifications.inserted) {
      expect(n.type).toBe("rejected");
      expect(n.matchId).toBe(SEED_MATCH_ID);
      expect(n.body).toBe(NOTIFICATION_BODIES.rejectedMatchStarted);
    }

    // Watch wiped (cron #3 primary cleanup — spec §434).
    expect(watchRepo.bulkDeleted).toEqual([
      { matchId: SEED_MATCH_ID, count: 1 },
    ]);
  });

  it("skips notification + watch wipe when massRejectPending finds no rows (race idempotency)", async () => {
    const { service, matchRepo, joinRepo, watchRepo, notifications } = setup();
    // Match surfaces in discovery (test seeded), but no pending JR exists
    // — simulates a second cron run after the first already processed it.
    matchRepo.put(makeMatch({ startTime: PAST }));
    matchRepo.markHasPending(SEED_MATCH_ID);
    // Intentionally NO joinRepo.seed → massRejectPending returns [].
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);

    const result = await service.run(NOW);

    expect(result).toEqual({
      matchesScanned: 1,
      matchesProcessed: 0,
      pendingRejected: 0,
      watchesDeleted: 0,
    });
    expect(notifications.inserted).toHaveLength(0);
    expect(watchRepo.bulkDeleted).toHaveLength(0);
    // Watch row left intact for the InboxTtlService > 1-day safety net.
    expect(watchRepo.has(SEED_MATCH_ID, SEED_PLAYER_ID)).toBe(true);
  });

  it("processes multiple eligible matches in one run", async () => {
    const { service, matchRepo, joinRepo, watchRepo, notifications } = setup();
    const matchA = asMatchId("00000000-0000-0000-0000-00000000aaaa");
    const matchB = asMatchId("00000000-0000-0000-0000-00000000bbbb");
    matchRepo.put(
      makeMatch({ id: matchA, startTime: PAST, captainId: SEED_CAPTAIN_ID }),
    );
    matchRepo.put(
      makeMatch({ id: matchB, startTime: PAST, captainId: SEED_CAPTAIN_ID }),
    );
    matchRepo.markHasPending(matchA);
    matchRepo.markHasPending(matchB);
    joinRepo.seed({ matchId: matchA, userId: SEED_PLAYER_ID, status: "pending" });
    joinRepo.seed({ matchId: matchB, userId: OTHER_PLAYER_ID, status: "pending" });
    watchRepo.seed(matchA, OTHER_PLAYER_ID);

    const result = await service.run(NOW);

    expect(result.matchesScanned).toBe(2);
    expect(result.matchesProcessed).toBe(2);
    expect(result.pendingRejected).toBe(2);
    expect(result.watchesDeleted).toBe(1); // only matchA had a watcher
    expect(notifications.inserted).toHaveLength(2);
    expect(
      notifications.inserted.map((n) => n.matchId).sort(),
    ).toEqual([matchA, matchB].sort());
  });

  it("skips a future-starting match even if surfaced (defense — discovery query is the gate)", async () => {
    const { service, matchRepo, joinRepo, notifications } = setup();
    // FakeMatchRepository filters by startTime in findMatchIdsWithPendingStartedBefore.
    matchRepo.put(makeMatch({ startTime: FUTURE }));
    matchRepo.markHasPending(SEED_MATCH_ID);
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    const result = await service.run(NOW);

    expect(result.matchesScanned).toBe(0);
    expect(notifications.inserted).toHaveLength(0);
  });

  it("a second back-to-back run is a no-op (all pending already transitioned)", async () => {
    const { service, matchRepo, joinRepo, notifications } = setup();
    matchRepo.put(makeMatch({ startTime: PAST }));
    matchRepo.markHasPending(SEED_MATCH_ID);
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    const first = await service.run(NOW);
    const second = await service.run(NOW);

    expect(first.pendingRejected).toBe(1);
    expect(first.matchesProcessed).toBe(1);
    expect(notifications.inserted).toHaveLength(1);

    // Second run: discovery still surfaces it (test fixture flag), but
    // massRejectPending returns [] because the row is rejected now.
    expect(second.matchesScanned).toBe(1);
    expect(second.matchesProcessed).toBe(0);
    expect(second.pendingRejected).toBe(0);
    expect(notifications.inserted).toHaveLength(1); // no duplicate fan-out
  });

  it("accepted JRs on the eligible match are NOT touched (only pending transitions)", async () => {
    const { service, matchRepo, joinRepo, notifications } = setup();
    matchRepo.put(makeMatch({ startTime: PAST }));
    matchRepo.markHasPending(SEED_MATCH_ID);
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: OTHER_PLAYER_ID,
      status: "accepted",
    });

    await service.run(NOW);

    // Only ONE JR transition logged — the pending one. Accepted unchanged.
    expect(joinRepo.updates).toHaveLength(1);
    // Notification only for the pending user (no accepted-player kick body).
    expect(notifications.inserted).toHaveLength(1);
    expect(notifications.inserted[0]!.userId).toBe(SEED_PLAYER_ID);
  });
});
