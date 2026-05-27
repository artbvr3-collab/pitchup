/**
 * MODULE: tests.match_lifecycle.application.leave-match-service
 * PURPOSE: Cover happy path + per-endpoint checklist for POST /api/matches/:id/leave.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/leave-match-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Leave flow", "Per-endpoint
 *     checklist" → POST /leave, "Race scenarios — resolution matrix"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeaveMatchService } from "@/src/match_lifecycle/application/leave-match-service";
import {
  MatchLockedError,
  NotInMatchError,
} from "@/src/match_lifecycle/domain/errors";

import {
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeWatchRepository,
  OTHER_PLAYER_ID,
  SEED_MATCH_ID,
  SEED_CAPTAIN_ID,
  SEED_PLAYER_ID,
  makeMatch,
} from "../_helpers/fakes";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

const NOW = new Date("2026-05-26T12:00:00Z");

function makeService() {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  matchRepo.put(makeMatch());
  const service = new LeaveMatchService(matchRepo, joinRepo, watchRepo);
  return { service, matchRepo, joinRepo, watchRepo };
}

describe("LeaveMatchService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips accepted → left and returns notifiedWatcherCount 0 when no watchers", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
      NOW,
    );

    expect(result.status).toBe("left");
    expect(result.notifiedWatcherCount).toBe(0);

    // Verify the JR row was actually flipped.
    const row = Array.from(joinRepo.rows.values()).find(
      (r) => r.userId === SEED_PLAYER_ID,
    );
    expect(row?.status).toBe("left");
  });

  it("throws NotInMatchError when there is no JoinRequest row for the user", async () => {
    const { service } = makeService();
    // No JR seeded — player never applied.

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotInMatchError);
  });

  it("throws NotInMatchError when the JoinRequest exists but is not accepted", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotInMatchError);
  });

  it("captain SEED_CAPTAIN_ID cannot leave their own match (not accepted → NotInMatchError)", async () => {
    const { service } = makeService();
    // Captain has no JR row (they are on the match by virtue of captainId, not JR).

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_CAPTAIN_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotInMatchError);
  });

  it("MatchLockedError when the match is cancelled", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ cancelledAt: new Date("2026-05-26T11:30:00Z") }));
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new LeaveMatchService(matchRepo, joinRepo, watchRepo);
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });

  it("race: N watchers on a full match → one-shot notify-watching dispatch", async () => {
    // total=8, captain (1) + 6 crew + accepted player with 0 guests (1) = 8 → isFull.
    // After leave: 7 filled → isFull flips true → false → notify-watching fires.
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F"],
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new LeaveMatchService(matchRepo, joinRepo, watchRepo);

    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    // Three watching players, each subscribed while the match was full.
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);
    watchRepo.seed(SEED_MATCH_ID, SEED_CAPTAIN_ID); // (legitimately impossible in prod — captain can't Watch — but the helper doesn't care; tests one-shot semantics)
    const THIRD = "55555555-5555-5555-5555-555555555555" as never;
    watchRepo.seed(SEED_MATCH_ID, THIRD);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
      NOW,
    );

    expect(result.status).toBe("left");
    expect(result.notifiedWatcherCount).toBe(3);
    // All Watch rows wiped in one bulk delete.
    expect(watchRepo.bulkDeleted).toEqual([
      { matchId: SEED_MATCH_ID, count: 3 },
    ]);
    expect(watchRepo.has(SEED_MATCH_ID, OTHER_PLAYER_ID)).toBe(false);
  });

  it("Watch race: a Watch row created while the match was full is included in the one-shot wipe", async () => {
    // Same shape as above but with only one watcher who subscribed
    // moments before the Leave. The helper captures + deletes in the
    // same tx — covers spec race-matrix "Watch + Leave (Watch first)".
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F"],
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new LeaveMatchService(matchRepo, joinRepo, watchRepo);

    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
      NOW,
    );

    expect(result.notifiedWatcherCount).toBe(1);
    expect(watchRepo.has(SEED_MATCH_ID, OTHER_PLAYER_ID)).toBe(false);
  });

  it("no notify-watching fan-out on a non-full match (isFull stays false)", async () => {
    // total=14, captain + 0 crew + accepted = 2 → not full → after Leave still not full.
    const { service, joinRepo, watchRepo } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    // Seed a Watch row (impossible in prod — backend rejects watch on
    // non-full — but we want to prove the helper short-circuits cleanly).
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
      NOW,
    );

    expect(result.notifiedWatcherCount).toBe(0);
    expect(watchRepo.bulkDeleted).toEqual([]); // helper short-circuited
    expect(watchRepo.has(SEED_MATCH_ID, OTHER_PLAYER_ID)).toBe(true);
  });
});
