/**
 * MODULE: tests.match_lifecycle.application.admin-hide-text-service
 * PURPOSE: Unit tests for AdminHideTextService — toggle hide flags, 404 on
 *          missing match.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/admin-hide-text-service.ts
 */
import { describe, expect, it } from "vitest";

import { AdminHideTextService } from "@/src/match_lifecycle/application/admin-hide-text-service";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";
import { FakeMatchRepository, makeMatch, SEED_MATCH_ID } from "../_helpers/fakes";

function setup() {
  const matchRepo = new FakeMatchRepository();
  const service = new AdminHideTextService(matchRepo);
  return { matchRepo, service };
}

describe("AdminHideTextService", () => {
  it("toggles description_hidden to true", async () => {
    const { matchRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID }));

    const result = await service.execute({
      matchId: SEED_MATCH_ID,
      descriptionHidden: true,
    });

    expect(result.descriptionHidden).toBe(true);
    expect(result.cancelReasonHidden).toBe(false);
  });

  it("toggles cancel_reason_hidden independently", async () => {
    const { matchRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID }));

    const result = await service.execute({
      matchId: SEED_MATCH_ID,
      cancelReasonHidden: true,
    });

    expect(result.descriptionHidden).toBe(false);
    expect(result.cancelReasonHidden).toBe(true);
  });

  it("toggles both flags in one call", async () => {
    const { matchRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID }));

    const result = await service.execute({
      matchId: SEED_MATCH_ID,
      descriptionHidden: true,
      cancelReasonHidden: true,
    });

    expect(result.descriptionHidden).toBe(true);
    expect(result.cancelReasonHidden).toBe(true);
  });

  it("throws MatchNotFoundError when match does not exist", async () => {
    const { service } = setup();

    await expect(
      service.execute({ matchId: SEED_MATCH_ID, descriptionHidden: true }),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });
});
