/**
 * MODULE: tests.match_lifecycle.application.unwatch-match-service
 * PURPOSE: Cover happy path + idempotent path for DELETE /api/matches/:id/watch.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/unwatch-match-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → DELETE /watch
 *   - AGENTS.md → "Chat writes are the second no-lock exception" gotcha
 *     (Layer 5) — Unwatch extends the same no-lock convention to a third
 *     write endpoint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnwatchMatchService } from "@/src/match_lifecycle/application/unwatch-match-service";

import {
  FakeWatchRepository,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
} from "../_helpers/fakes";

// UnwatchMatchService uses prisma.$transaction directly (no advisory lock).
vi.mock("@/src/shared/db/prisma", () => ({
  prisma: {
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn({}),
  },
}));

function makeService() {
  const watchRepo = new FakeWatchRepository();
  const service = new UnwatchMatchService(watchRepo);
  return { service, watchRepo };
}

describe("UnwatchMatchService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes an existing Watch row and records the deletion", async () => {
    const { service, watchRepo } = makeService();
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);

    const result = await service.execute({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
    });

    expect(result.status).toBe("ok");
    expect(watchRepo.has(SEED_MATCH_ID, SEED_PLAYER_ID)).toBe(false);
    expect(watchRepo.deleted.length).toBe(1);
    expect(watchRepo.deleted[0]).toMatchObject({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
    });
  });

  it("succeeds (idempotent) when no Watch row exists", async () => {
    const { service, watchRepo } = makeService();
    // No Watch seeded — should not throw.

    const result = await service.execute({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
    });

    expect(result.status).toBe("ok");
    // deleteForUserAndMatch was still called (the fake records it).
    expect(watchRepo.deleted.length).toBe(1);
  });
});
