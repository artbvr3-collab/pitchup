/**
 * MODULE: tests.match_lifecycle.application.like-teammate-service
 * PURPOSE: Cover every branch of LikeTeammateService per the spec
 *          "Per-endpoint checklist" → POST /matches/:id/likes:
 *          ended-only, participant-only (captain OR accepted), self-like
 *          backstop, target existence/ban/delete, and idempotency.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/like-teammate-service.ts
 * MOCKS: withMatchLock (vi.mock) → runs the callback with a sentinel tx.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Post-match likes",
 *               "Per-endpoint checklist" → POST /matches/:id/likes
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_matchId: string, work: (tx: unknown) => Promise<T>) =>
    work({} as unknown),
}));

import {
  LikeTargetNotFoundError,
  MatchNotEndedError,
  MatchNotFoundError,
  NotAParticipantError,
} from "@/src/match_lifecycle/domain/errors";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import { LikeTeammateService } from "@/src/match_lifecycle/application/like-teammate-service";

import {
  FakeJoinRequestRepository,
  FakeLikeRepository,
  FakeMatchRepository,
  FakeUserRepository,
  makeMatch,
  makeUser,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  OTHER_PLAYER_ID,
} from "../_helpers/fakes";

// Match that has already ended by NOW: started 2h before, 90-min duration.
const NOW = new Date("2026-05-26T12:00:00Z");
const ENDED_START = new Date("2026-05-26T09:00:00Z");
const FUTURE_START = new Date("2026-07-01T17:00:00Z");

function makeService(opts: { ended: boolean }) {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const userRepo = new FakeUserRepository();
  const likeRepo = new FakeLikeRepository();

  matchRepo.put(
    makeMatch({ startTime: opts.ended ? ENDED_START : FUTURE_START }),
  );
  userRepo.seed(makeUser({ id: SEED_CAPTAIN_ID, name: "Captain" }));
  userRepo.seed(makeUser({ id: SEED_PLAYER_ID, name: "Player" }));
  userRepo.seed(makeUser({ id: OTHER_PLAYER_ID, name: "Other" }));

  const service = new LikeTeammateService(
    matchRepo,
    joinRepo,
    userRepo,
    likeRepo,
  );
  return { service, matchRepo, joinRepo, userRepo, likeRepo };
}

describe("LikeTeammateService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("captain likes an accepted player on an ended match → inserted", async () => {
    const { service, joinRepo, likeRepo } = makeService({ ended: true });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        giverId: SEED_CAPTAIN_ID,
        targetId: SEED_PLAYER_ID,
      },
      NOW,
    );

    expect(result.outcome).toBe("inserted");
    expect(likeRepo.insertCalls).toHaveLength(1);
  });

  it("accepted player likes the captain → inserted", async () => {
    const { service, joinRepo } = makeService({ ended: true });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        giverId: SEED_PLAYER_ID,
        targetId: SEED_CAPTAIN_ID,
      },
      NOW,
    );

    expect(result.outcome).toBe("inserted");
  });

  it("idempotent — a repeat like returns existed", async () => {
    const { service, likeRepo } = makeService({ ended: true });
    likeRepo.seed(SEED_MATCH_ID, SEED_CAPTAIN_ID, SEED_PLAYER_ID);

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        giverId: SEED_CAPTAIN_ID,
        targetId: SEED_PLAYER_ID,
      },
      NOW,
    );

    expect(result.outcome).toBe("existed");
  });

  it("match not found → MatchNotFoundError", async () => {
    const { service } = makeService({ ended: true });
    await expect(
      service.execute(
        {
          matchId: asMatchId("ffffffff-ffff-ffff-ffff-ffffffffffff"),
          giverId: SEED_CAPTAIN_ID,
          targetId: SEED_PLAYER_ID,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  it("match not ended → MatchNotEndedError", async () => {
    const { service } = makeService({ ended: false });
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          giverId: SEED_CAPTAIN_ID,
          targetId: SEED_PLAYER_ID,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotEndedError);
  });

  it("giver is neither captain nor accepted → NotAParticipantError", async () => {
    const { service } = makeService({ ended: true });
    // OTHER_PLAYER_ID has no accepted JR.
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          giverId: OTHER_PLAYER_ID,
          targetId: SEED_CAPTAIN_ID,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotAParticipantError);
  });

  it("pending giver is not a participant → NotAParticipantError", async () => {
    const { service, joinRepo } = makeService({ ended: true });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: OTHER_PLAYER_ID,
      status: "pending",
    });
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          giverId: OTHER_PLAYER_ID,
          targetId: SEED_CAPTAIN_ID,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotAParticipantError);
  });

  it("self-like → LikeTargetNotFoundError (backstop)", async () => {
    const { service } = makeService({ ended: true });
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          giverId: SEED_CAPTAIN_ID,
          targetId: SEED_CAPTAIN_ID,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(LikeTargetNotFoundError);
  });

  it("banned target → LikeTargetNotFoundError", async () => {
    const { service, joinRepo, userRepo } = makeService({ ended: true });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    userRepo.seed(
      makeUser({ id: SEED_PLAYER_ID, name: "Player", banned: true }),
    );
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          giverId: SEED_CAPTAIN_ID,
          targetId: SEED_PLAYER_ID,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(LikeTargetNotFoundError);
  });

  it("deleted target → LikeTargetNotFoundError", async () => {
    const { service, userRepo } = makeService({ ended: true });
    userRepo.seed(
      makeUser({
        id: SEED_PLAYER_ID,
        name: "Player",
        deletedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          giverId: SEED_CAPTAIN_ID,
          targetId: SEED_PLAYER_ID,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(LikeTargetNotFoundError);
  });

  it("missing target row → LikeTargetNotFoundError", async () => {
    const { service } = makeService({ ended: true });
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          giverId: SEED_CAPTAIN_ID,
          targetId: "99999999-9999-9999-9999-999999999999",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(LikeTargetNotFoundError);
  });
});
