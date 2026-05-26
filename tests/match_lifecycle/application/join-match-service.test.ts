/**
 * MODULE: tests.match_lifecycle.application.join-match-service
 * PURPOSE: Cover every branch of JoinMatchService — happy path + per-endpoint
 *          checklist for POST /api/matches/:id/join + race scenarios from
 *          the match.md resolution matrix that map onto this endpoint.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/join-match-service.ts
 * MOCKS: withMatchLock (the real one would open a Prisma transaction);
 *        repository ports are in-memory fakes from _helpers/fakes.ts.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST /join,
 *     "Join flow", "Watching logic", "Race scenarios — resolution matrix"
 *   - docs/spec/pitchup-spec-global.md → "Total spots — hard cap on approve"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JoinMatchService } from "@/src/match_lifecycle/application/join-match-service";
import {
  AlreadyInMatchError,
  AlreadyRequestedError,
  CaptainCannotJoinError,
  MatchLockedError,
  MatchNotFoundError,
} from "@/src/match_lifecycle/domain/errors";

import {
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeWatchRepository,
  OTHER_PLAYER_ID,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  makeMatch,
} from "../_helpers/fakes";

// Bypass the advisory-lock transaction; just invoke the work callback with a
// sentinel tx. The real lock is exercised by integration tests against Neon.
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
  const service = new JoinMatchService(matchRepo, joinRepo, watchRepo);
  return { service, matchRepo, joinRepo, watchRepo };
}

describe("JoinMatchService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts pending on first Join and removes any Watch for (user, match)", async () => {
    const { service, joinRepo, watchRepo } = makeService();
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 0, message: null },
      NOW,
    );

    expect(result.outcome).toBe("created");
    expect(joinRepo.rows.size).toBe(1);
    const row = [...joinRepo.rows.values()][0]!;
    expect(row.status).toBe("pending");
    expect(row.autoReason).toBeNull();
    expect(watchRepo.has(SEED_MATCH_ID, SEED_PLAYER_ID)).toBe(false);
    expect(watchRepo.deleted).toHaveLength(1);
  });

  it("normalises a whitespace-only message to null", async () => {
    const { service, joinRepo } = makeService();
    await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 2, message: "   " },
      NOW,
    );
    const row = [...joinRepo.rows.values()][0]!;
    expect(row.message).toBeNull();
    expect(row.guestCount).toBe(2);
  });

  it("rejects when the match id does not exist", async () => {
    const { service } = makeService();
    await expect(
      service.execute(
        {
          matchId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
          userId: SEED_PLAYER_ID,
          guestCount: 0,
          message: null,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  it("rejects when the captain tries to Join their own match", async () => {
    const { service } = makeService();
    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_CAPTAIN_ID, guestCount: 0, message: null },
        NOW,
      ),
    ).rejects.toBeInstanceOf(CaptainCannotJoinError);
  });

  it("rejects on a cancelled match with MatchLockedError", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ cancelledAt: new Date("2026-05-26T11:00:00Z") }));
    const service = new JoinMatchService(
      matchRepo,
      new FakeJoinRequestRepository(),
      new FakeWatchRepository(),
    );
    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 0, message: null },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });

  it("rejects on an in-progress match (now >= start_time)", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ startTime: new Date("2026-05-26T11:00:00Z") }));
    const service = new JoinMatchService(
      matchRepo,
      new FakeJoinRequestRepository(),
      new FakeWatchRepository(),
    );
    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 0, message: null },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });

  it("rejects on an ended match", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        startTime: new Date("2026-05-26T09:00:00Z"),
        duration: 90,
      }),
    );
    const service = new JoinMatchService(
      matchRepo,
      new FakeJoinRequestRepository(),
      new FakeWatchRepository(),
    );
    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 0, message: null },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });

  it("ALLOWS pending creation on a full match (Join API does NOT check free)", async () => {
    // total=8, 1 captain + 7 captain_crew → fully filled by captain side alone.
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F", "G"],
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const service = new JoinMatchService(matchRepo, joinRepo, watchRepo);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 0, message: null },
      NOW,
    );
    expect(result.outcome).toBe("created");
    expect(joinRepo.rows.size).toBe(1);
  });

  it("rejects with AlreadyRequestedError on double Join by same user (Join + Join race)", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 0, message: null },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AlreadyRequestedError);
  });

  it("rejects with AlreadyInMatchError when user is already accepted", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 0, message: null },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AlreadyInMatchError);
  });

  it.each(["rejected", "cancelled", "left", "kicked"] as const)(
    "revives a %s JoinRequest into pending (no re-apply limit, auto_reason cleared)",
    async (prevStatus) => {
      const { service, joinRepo } = makeService();
      const seeded = joinRepo.seed({
        matchId: SEED_MATCH_ID,
        userId: SEED_PLAYER_ID,
        status: prevStatus,
        autoReason:
          prevStatus === "rejected" ? "match_started" : null,
        guestCount: 1,
        message: "old message",
      });

      const result = await service.execute(
        {
          matchId: SEED_MATCH_ID,
          userId: SEED_PLAYER_ID,
          guestCount: 3,
          message: "fresh attempt",
        },
        NOW,
      );

      expect(result.outcome).toBe("revived");
      const revived = joinRepo.rows.get(seeded.id)!;
      expect(revived.status).toBe("pending");
      expect(revived.autoReason).toBeNull();
      expect(revived.guestCount).toBe(3);
      expect(revived.message).toBe("fresh attempt");
    },
  );

  it("does not affect other users' JoinRequests on the same match", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: OTHER_PLAYER_ID,
      status: "accepted",
    });

    await service.execute(
      { matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, guestCount: 0, message: null },
      NOW,
    );

    expect(joinRepo.rows.size).toBe(2);
    const mine = await joinRepo.findByMatchAndUser(SEED_MATCH_ID, SEED_PLAYER_ID);
    expect(mine!.status).toBe("pending");
    const other = await joinRepo.findByMatchAndUser(SEED_MATCH_ID, OTHER_PLAYER_ID);
    expect(other!.status).toBe("accepted");
  });
});
