/**
 * MODULE: tests.match_lifecycle.application.watch-match-service
 * PURPOSE: Cover happy path + per-endpoint checklist for POST /api/matches/:id/watch.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/watch-match-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Watching logic", "Per-endpoint
 *     checklist" → POST /watch, "Race scenarios — resolution matrix" →
 *     "Watch + Leave"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WatchMatchService } from "@/src/match_lifecycle/application/watch-match-service";
import {
  AlreadyInMatchError,
  CaptainCannotWatchError,
  MatchLockedError,
  MatchNotFullError,
} from "@/src/match_lifecycle/domain/errors";

import {
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeWatchRepository,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  makeMatch,
} from "../_helpers/fakes";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

const NOW = new Date("2026-05-26T12:00:00Z");

describe("WatchMatchService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a Watch row when the match is full and the user has no active JR", async () => {
    // captain (1) + 7 crew = 8 filled = 8 total → isFull === true.
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F", "G"],
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new WatchMatchService(matchRepo, joinRepo, watchRepo);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
      NOW,
    );

    expect(result.outcome).toBe("inserted");
    expect(watchRepo.inserted.length).toBe(1);
    expect(watchRepo.inserted[0]).toMatchObject({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
    });
  });

  it("throws MatchNotFullError when the match still has free slots", async () => {
    // totalSpots: 14, captainCrew: [] → captain alone = 1 filled → 13 free → not full.
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ totalSpots: 14, captainCrew: [] }));
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new WatchMatchService(matchRepo, joinRepo, watchRepo);

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFullError);
  });

  it("CaptainCannotWatchError when the captain tries to watch their own match", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F", "G"],
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new WatchMatchService(matchRepo, joinRepo, watchRepo);

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_CAPTAIN_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(CaptainCannotWatchError);
  });

  it.each(["pending", "accepted"] as const)(
    "AlreadyInMatchError when the user has an active JoinRequest (%s)",
    async (status) => {
      const matchRepo = new FakeMatchRepository();
      matchRepo.put(
        makeMatch({
          totalSpots: 8,
          captainCrew: ["A", "B", "C", "D", "E", "F", "G"],
        }),
      );
      const joinRepo = new FakeJoinRequestRepository();
      const watchRepo = new FakeWatchRepository();
      const service = new WatchMatchService(matchRepo, joinRepo, watchRepo);
      joinRepo.seed({
        matchId: SEED_MATCH_ID,
        userId: SEED_PLAYER_ID,
        status,
      });

      await expect(
        service.execute(
          { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
          NOW,
        ),
      ).rejects.toBeInstanceOf(AlreadyInMatchError);
    },
  );

  it("terminal JR status (left / kicked / rejected / cancelled) does NOT block Watch", async () => {
    // Spec: terminal statuses allow upgrade to `watching` per deriveMyStatus.
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F", "G"],
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new WatchMatchService(matchRepo, joinRepo, watchRepo);
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "left",
    });

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
      NOW,
    );
    expect(result.outcome).toBe("inserted");
  });

  it("idempotent upsert: second Watch on the same (match, user) returns 'existed'", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F", "G"],
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new WatchMatchService(matchRepo, joinRepo, watchRepo);

    const first = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
      NOW,
    );
    const second = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
      NOW,
    );
    expect(first.outcome).toBe("inserted");
    expect(second.outcome).toBe("existed");
  });

  it("MatchLockedError when the match is cancelled", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F", "G"],
        cancelledAt: new Date("2026-05-26T11:00:00Z"),
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new WatchMatchService(matchRepo, joinRepo, watchRepo);

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });
});
