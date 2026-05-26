/**
 * MODULE: tests.match_lifecycle.application.reject-join-request-service
 * PURPOSE: Cover happy path + per-endpoint checklist for POST
 *          /api/matches/:id/reject.
 * LAYER: tests / application
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST /reject,
 *     "Reject / Kick / Leave flows"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RejectJoinRequestService } from "@/src/match_lifecycle/application/reject-join-request-service";
import {
  AlreadyProcessedError,
  MatchLockedError,
  MatchNotFoundError,
  NotCaptainError,
  RequestNotFoundError,
} from "@/src/match_lifecycle/domain/errors";
import { asJoinRequestId } from "@/src/match_lifecycle/domain/join-request";

import {
  FakeJoinRequestRepository,
  FakeMatchRepository,
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

const NOW = new Date("2026-05-26T12:00:00Z");

function makeService() {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  matchRepo.put(makeMatch());
  const service = new RejectJoinRequestService(matchRepo, joinRepo);
  return { service, matchRepo, joinRepo };
}

describe("RejectJoinRequestService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips pending → rejected with auto_reason = NULL (captain-initiated)", async () => {
    const { service, joinRepo } = makeService();
    const req = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req.id },
      NOW,
    );

    expect(result.status).toBe("rejected");
    const after = joinRepo.rows.get(req.id)!;
    expect(after.status).toBe("rejected");
    expect(after.autoReason).toBeNull();
  });

  it("404s when match id does not exist", async () => {
    const { service, joinRepo } = makeService();
    const req = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });
    await expect(
      service.execute(
        {
          matchId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
          captainId: SEED_CAPTAIN_ID,
          requestId: req.id,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  it("403s when caller is not the captain", async () => {
    const { service, joinRepo } = makeService();
    const req = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });
    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, captainId: OTHER_PLAYER_ID, requestId: req.id },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotCaptainError);
  });

  it("404s when request id does not exist", async () => {
    const { service } = makeService();
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          requestId: asJoinRequestId("ffffffff-ffff-ffff-ffff-ffffffffffff"),
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(RequestNotFoundError);
  });

  it("409 already_processed when request is no longer pending", async () => {
    const { service, joinRepo } = makeService();
    const req = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req.id },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AlreadyProcessedError);
  });

  it("rejects MatchLockedError when the match is cancelled", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ cancelledAt: new Date("2026-05-26T11:00:00Z") }));
    const joinRepo = new FakeJoinRequestRepository();
    const service = new RejectJoinRequestService(matchRepo, joinRepo);
    const req = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req.id },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });
});
