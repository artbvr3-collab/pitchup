/**
 * MODULE: tests.match_lifecycle.application.cancel-join-request-service
 * PURPOSE: Cover happy path + per-endpoint checklist for POST /api/matches/:id/cancel-request.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/cancel-join-request-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cancel request flow",
 *     "Per-endpoint checklist" → POST /cancel-request, "Race scenarios"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CancelJoinRequestService } from "@/src/match_lifecycle/application/cancel-join-request-service";
import {
  AlreadyInMatchError,
  AlreadyProcessedError,
  RequestNotFoundError,
} from "@/src/match_lifecycle/domain/errors";
import type { JoinRequestStatus } from "@/src/match_lifecycle/domain/join-request";

import {
  FakeJoinRequestRepository,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
} from "../_helpers/fakes";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

function makeService() {
  const joinRepo = new FakeJoinRequestRepository();
  const service = new CancelJoinRequestService(joinRepo);
  return { service, joinRepo };
}

describe("CancelJoinRequestService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips pending → cancelled", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    const result = await service.execute({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
    });

    expect(result.status).toBe("cancelled");

    const row = Array.from(joinRepo.rows.values()).find(
      (r) => r.userId === SEED_PLAYER_ID,
    );
    expect(row?.status).toBe("cancelled");
  });

  it("throws RequestNotFoundError when there is no JoinRequest row for the user", async () => {
    const { service } = makeService();
    // No JR seeded — player never applied.

    await expect(
      service.execute({
        matchId: SEED_MATCH_ID,
        userId: SEED_PLAYER_ID,
      }),
    ).rejects.toBeInstanceOf(RequestNotFoundError);
  });

  it("race: Approve won → JR.status === 'accepted' → AlreadyInMatchError (spec already_accepted)", async () => {
    // Spec race-matrix row "Approve + Cancel-request" — late cancel-request
    // sees the row already accepted.
    const { service, joinRepo } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute({
        matchId: SEED_MATCH_ID,
        userId: SEED_PLAYER_ID,
      }),
    ).rejects.toBeInstanceOf(AlreadyInMatchError);
  });

  it.each(["rejected", "cancelled", "left", "kicked"] satisfies JoinRequestStatus[])(
    "terminal status %s → AlreadyProcessedError (idempotent re-tap)",
    async (status) => {
      const { service, joinRepo } = makeService();
      joinRepo.seed({
        matchId: SEED_MATCH_ID,
        userId: SEED_PLAYER_ID,
        status,
      });

      await expect(
        service.execute({
          matchId: SEED_MATCH_ID,
          userId: SEED_PLAYER_ID,
        }),
      ).rejects.toBeInstanceOf(AlreadyProcessedError);
    },
  );
});
