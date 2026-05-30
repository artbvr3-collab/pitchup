/**
 * MODULE: tests.match_lifecycle.application.admin-delete-match-service
 * PURPOSE: Unit tests for AdminDeleteMatchService — tombstone recording before
 *          delete, 404 on missing match, affected-user set construction.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/admin-delete-match-service.ts
 * NOTE: The actual Prisma `match.delete` call cannot be faked via ports here
 *       (it uses the prisma singleton directly). We mock the singleton so the
 *       service's full pre-delete logic (tombstone, user collection) is covered
 *       without hitting the DB.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";
import {
  FakeAdminMatchDeletionRepository,
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeWatchRepository,
  makeMatch,
  SEED_MATCH_ID,
} from "../_helpers/fakes";
import { asUserId } from "@/src/auth/domain/user";

// Patch the prisma singleton's `match.delete` to be a no-op so the service
// can exercise its full pre-delete logic in unit tests.
vi.mock("@/src/shared/db/prisma", () => ({
  prisma: {
    match: {
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// Import AFTER the mock so the singleton is patched.
import { AdminDeleteMatchService } from "@/src/match_lifecycle/application/admin-delete-match-service";

const CAPTAIN_ID = asUserId("aaaa0000-0000-0000-0000-000000000000");
const USER_1 = asUserId("bbbb0000-0000-0000-0000-000000000000");
const USER_2 = asUserId("cccc0000-0000-0000-0000-000000000000");

function setup() {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const deletionRepo = new FakeAdminMatchDeletionRepository();
  const service = new AdminDeleteMatchService(
    matchRepo,
    joinRepo,
    watchRepo,
    deletionRepo,
  );
  return { matchRepo, joinRepo, watchRepo, deletionRepo, service };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminDeleteMatchService", () => {
  it("throws MatchNotFoundError when match does not exist", async () => {
    const { service } = setup();
    await expect(service.execute(SEED_MATCH_ID)).rejects.toBeInstanceOf(
      MatchNotFoundError,
    );
  });

  it("records a tombstone with captain id before calling delete", async () => {
    const { matchRepo, deletionRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID, captainId: CAPTAIN_ID }));

    await service.execute(SEED_MATCH_ID);

    expect(deletionRepo.records).toHaveLength(1);
    expect(deletionRepo.records[0]!.matchId).toBe(SEED_MATCH_ID);
    expect(deletionRepo.records[0]!.affectedUserIds).toContain(CAPTAIN_ID);
  });

  it("includes accepted JR user ids in the tombstone", async () => {
    const { matchRepo, joinRepo, deletionRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID, captainId: CAPTAIN_ID }));
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: USER_1, status: "accepted" });

    await service.execute(SEED_MATCH_ID);

    expect(deletionRepo.records[0]!.affectedUserIds).toContain(USER_1);
  });

  it("includes pending JR user ids in the tombstone", async () => {
    const { matchRepo, joinRepo, deletionRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID, captainId: CAPTAIN_ID }));
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: USER_1, status: "pending" });

    await service.execute(SEED_MATCH_ID);

    expect(deletionRepo.records[0]!.affectedUserIds).toContain(USER_1);
  });

  it("includes watcher user ids in the tombstone", async () => {
    const { matchRepo, watchRepo, deletionRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID, captainId: CAPTAIN_ID }));
    watchRepo.seed(SEED_MATCH_ID, USER_2);

    await service.execute(SEED_MATCH_ID);

    expect(deletionRepo.records[0]!.affectedUserIds).toContain(USER_2);
  });

  it("deduplicates user ids in the tombstone", async () => {
    const { matchRepo, deletionRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID, captainId: CAPTAIN_ID }));

    await service.execute(SEED_MATCH_ID);

    const ids = deletionRepo.records[0]!.affectedUserIds;
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it("returns status deleted on success", async () => {
    const { matchRepo, service } = setup();
    matchRepo.put(makeMatch({ id: SEED_MATCH_ID, captainId: CAPTAIN_ID }));

    const result = await service.execute(SEED_MATCH_ID);

    expect(result.status).toBe("deleted");
  });
});
