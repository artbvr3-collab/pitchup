/**
 * MODULE: tests.match_lifecycle.application.admin-cancel-match-service
 * PURPOSE: Unit tests for AdminCancelMatchService — captain bypass, 404 on
 *          missing match, delegates to CancelMatchService unchanged.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/admin-cancel-match-service.ts
 */
import { describe, expect, it, vi, type Mock } from "vitest";

import { AdminCancelMatchService } from "@/src/match_lifecycle/application/admin-cancel-match-service";
import type { CancelMatchService } from "@/src/match_lifecycle/application/cancel-match-service";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";
import {
  FakeMatchRepository,
  makeMatch,
  SEED_MATCH_ID,
} from "../_helpers/fakes";
import { asUserId } from "@/src/auth/domain/user";

const CAPTAIN_ID = asUserId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

function makeFakeCancelService() {
  return {
    execute: vi.fn().mockResolvedValue({
      status: "cancelled",
      rejectedPendingCount: 0,
      watchRowsDeleted: 0,
    }),
  } as unknown as CancelMatchService;
}

function setup() {
  const matchRepo = new FakeMatchRepository();
  const cancelService = makeFakeCancelService();
  const service = new AdminCancelMatchService(matchRepo, cancelService);
  return { matchRepo, cancelService, service };
}

describe("AdminCancelMatchService", () => {
  it("resolves captainId from match and delegates to CancelMatchService", async () => {
    const { matchRepo, cancelService, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID, captainId: CAPTAIN_ID }));

    const now = new Date("2026-06-01T10:00:00Z");
    await service.execute({ matchId: SEED_MATCH_ID, cancelReason: "Spam match" }, now);

    expect(cancelService.execute).toHaveBeenCalledOnce();
    const [input] = (cancelService.execute as Mock).mock.calls[0]!;
    expect(input.matchId).toBe(SEED_MATCH_ID);
    expect(input.captainId).toBe(CAPTAIN_ID);
    expect(input.cancelReason).toBe("Spam match");
  });

  it("throws MatchNotFoundError when the match does not exist", async () => {
    const { service } = setup();

    await expect(
      service.execute({ matchId: SEED_MATCH_ID, cancelReason: "reason" }, new Date()),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });
});
