/**
 * MODULE: tests.moderation.application.admin-user-services
 * PURPOSE: Cover Ban / Unban / Promote / Demote use cases (Layer 9a,
 *          `/admin/users`) — happy paths, idempotency, self-modification
 *          guard, last-admin guard, target-not-found, and the ban cascade
 *          (reuse of CancelMatchService with the canonical organizer-removed
 *          reason; ban reason confined to the audit log).
 * LAYER: tests / application
 * TESTS FOR: src/moderation/application/{ban,unban,promote,demote}-user-service.ts
 *
 * COMPOSITION: real `CancelMatchService` + in-memory fakes (same approach as
 * delete-account-service.test) so the ban cascade exercises the actual
 * cancel path. `withMatchLock` is mocked inline. `FakeAdminActionRepository`
 * records the audit rows for assertion.
 *
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/users", "Admin role
 *     management & safety"
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LastAdminError } from "@/src/auth/domain/errors";
import { asUserId, type User } from "@/src/auth/domain/user";
import { CancelMatchService } from "@/src/match_lifecycle/application/cancel-match-service";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import { SYSTEM_CANCEL_REASONS } from "@/src/match_lifecycle/domain/system-cancel-reasons";
import type { RecordAdminActionInput } from "@/src/moderation/domain/admin-action";
import type { AdminActionRepository } from "@/src/moderation/domain/admin-action-repository";
import {
  AdminTargetNotFoundError,
  SelfModificationError,
} from "@/src/moderation/domain/errors";
import { BanUserService } from "@/src/moderation/application/ban-user-service";
import { DemoteUserService } from "@/src/moderation/application/demote-user-service";
import { PromoteUserService } from "@/src/moderation/application/promote-user-service";
import { UnbanUserService } from "@/src/moderation/application/unban-user-service";

import {
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeNotificationRepository,
  FakeUserRepository,
  FakeWatchRepository,
  SEED_CAPTAIN_ID,
  SEED_PLAYER_ID,
  OTHER_PLAYER_ID,
  makeMatch,
  makeUser,
} from "../../match_lifecycle/_helpers/fakes";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

const NOW = new Date("2026-05-31T12:00:00Z");
const ADMIN_ID = asUserId("dddddddd-dddd-dddd-dddd-dddddddddddd");

class FakeAdminActionRepository implements AdminActionRepository {
  readonly records: RecordAdminActionInput[] = [];
  async record(input: RecordAdminActionInput): Promise<void> {
    this.records.push(input);
  }
}

function makeCtx() {
  const userRepo = new FakeUserRepository();
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const notifications = new FakeNotificationRepository();
  const adminActions = new FakeAdminActionRepository();

  const cancelService = new CancelMatchService(
    matchRepo,
    joinRepo,
    watchRepo,
    notifications,
  );

  const ban = new BanUserService(
    userRepo,
    matchRepo,
    cancelService,
    adminActions,
  );
  const unban = new UnbanUserService(userRepo, adminActions);
  const promote = new PromoteUserService(userRepo, adminActions);
  const demote = new DemoteUserService(userRepo, adminActions);

  return {
    userRepo,
    matchRepo,
    joinRepo,
    watchRepo,
    notifications,
    adminActions,
    ban,
    unban,
    promote,
    demote,
  };
}

function seedUser(
  userRepo: FakeUserRepository,
  overrides: Partial<User> & { id: User["id"] },
): void {
  userRepo.seed({ ...makeUser({ id: overrides.id, name: "U" }), ...overrides });
}

describe("BanUserService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: bans a regular user, writes a ban audit row with reason", async () => {
    const { ban, userRepo, adminActions } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID });

    const result = await ban.execute(
      { actorAdminId: ADMIN_ID, targetUserId: SEED_PLAYER_ID, reason: "spam" },
      NOW,
    );

    expect(result.applied).toBe(true);
    expect((await userRepo.findById(SEED_PLAYER_ID))?.banned).toBe(true);
    expect(adminActions.records).toEqual([
      {
        actorAdminId: ADMIN_ID,
        targetUserId: SEED_PLAYER_ID,
        action: "ban",
        reason: "spam",
      },
    ]);
  });

  it("idempotent: already-banned target → applied false, no audit row", async () => {
    const { ban, userRepo, adminActions } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, banned: true });

    const result = await ban.execute(
      { actorAdminId: ADMIN_ID, targetUserId: SEED_PLAYER_ID, reason: "x" },
      NOW,
    );

    expect(result.applied).toBe(false);
    expect(adminActions.records).toHaveLength(0);
  });

  it("self-modification guard: actor === target → SelfModificationError, no ban", async () => {
    const { ban, userRepo } = makeCtx();
    seedUser(userRepo, { id: ADMIN_ID, isAdmin: true });

    await expect(
      ban.execute(
        { actorAdminId: ADMIN_ID, targetUserId: ADMIN_ID, reason: "x" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(SelfModificationError);
    expect((await userRepo.findById(ADMIN_ID))?.banned).toBe(false);
  });

  it("target not found → AdminTargetNotFoundError", async () => {
    const { ban } = makeCtx();
    await expect(
      ban.execute(
        {
          actorAdminId: ADMIN_ID,
          targetUserId: asUserId("ffffffff-ffff-ffff-ffff-ffffffffffff"),
          reason: "x",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AdminTargetNotFoundError);
  });

  it("last-admin guard: banning the sole active admin → LastAdminError, not banned", async () => {
    const { ban, userRepo } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, isAdmin: true });

    await expect(
      ban.execute(
        { actorAdminId: ADMIN_ID, targetUserId: SEED_PLAYER_ID, reason: "x" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(LastAdminError);
    expect((await userRepo.findById(SEED_PLAYER_ID))?.banned).toBe(false);
  });

  it("last-admin guard passes when another active admin exists; is_admin preserved on ban", async () => {
    const { ban, userRepo } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, isAdmin: true });
    seedUser(userRepo, { id: OTHER_PLAYER_ID, isAdmin: true });

    const result = await ban.execute(
      { actorAdminId: ADMIN_ID, targetUserId: SEED_PLAYER_ID, reason: "x" },
      NOW,
    );

    expect(result.applied).toBe(true);
    const target = await userRepo.findById(SEED_PLAYER_ID);
    expect(target?.banned).toBe(true);
    expect(target?.isAdmin).toBe(true); // is_admin is NOT reset on ban
  });

  it("cascade: upcoming captain match is cancelled with the canonical reason (NOT the ban reason)", async () => {
    const { ban, userRepo, matchRepo } = makeCtx();
    seedUser(userRepo, { id: SEED_CAPTAIN_ID });
    const match = makeMatch({
      id: asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01"),
      startTime: new Date("2026-06-01T17:00:00Z"),
    });
    matchRepo.put(match);

    const result = await ban.execute(
      {
        actorAdminId: ADMIN_ID,
        targetUserId: SEED_CAPTAIN_ID,
        reason: "abusive language",
      },
      NOW,
    );

    expect(result.cancelledMatchIds).toContain(match.id);
    const cancelled = await matchRepo.findById(match.id);
    expect(cancelled?.cancelReason).toBe(
      SYSTEM_CANCEL_REASONS.organizerRemoved,
    );
    // The admin's ban reason never leaks into the public cancel reason.
    expect(cancelled?.cancelReason).not.toBe("abusive language");
  });
});

describe("UnbanUserService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: lifts the ban, writes an unban audit row with null reason", async () => {
    const { unban, userRepo, adminActions } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, banned: true });

    const result = await unban.execute({
      actorAdminId: ADMIN_ID,
      targetUserId: SEED_PLAYER_ID,
    });

    expect(result.applied).toBe(true);
    expect((await userRepo.findById(SEED_PLAYER_ID))?.banned).toBe(false);
    expect(adminActions.records[0]).toMatchObject({
      action: "unban",
      reason: null,
    });
  });

  it("idempotent: not-banned target → applied false, no audit row", async () => {
    const { unban, userRepo, adminActions } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, banned: false });

    const result = await unban.execute({
      actorAdminId: ADMIN_ID,
      targetUserId: SEED_PLAYER_ID,
    });

    expect(result.applied).toBe(false);
    expect(adminActions.records).toHaveLength(0);
  });

  it("target not found → AdminTargetNotFoundError", async () => {
    const { unban } = makeCtx();
    await expect(
      unban.execute({
        actorAdminId: ADMIN_ID,
        targetUserId: asUserId("ffffffff-ffff-ffff-ffff-ffffffffffff"),
      }),
    ).rejects.toBeInstanceOf(AdminTargetNotFoundError);
  });
});

describe("PromoteUserService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: grants admin, writes a promote audit row with reason", async () => {
    const { promote, userRepo, adminActions } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID });

    const result = await promote.execute({
      actorAdminId: ADMIN_ID,
      targetUserId: SEED_PLAYER_ID,
      reason: "trusted organizer",
    });

    expect(result.applied).toBe(true);
    expect((await userRepo.findById(SEED_PLAYER_ID))?.isAdmin).toBe(true);
    expect(adminActions.records[0]).toMatchObject({
      action: "promote",
      reason: "trusted organizer",
    });
  });

  it("idempotent: already-admin target → applied false, no audit row", async () => {
    const { promote, userRepo, adminActions } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, isAdmin: true });

    const result = await promote.execute({
      actorAdminId: ADMIN_ID,
      targetUserId: SEED_PLAYER_ID,
      reason: "x",
    });

    expect(result.applied).toBe(false);
    expect(adminActions.records).toHaveLength(0);
  });

  it("self-modification guard: actor === target → SelfModificationError", async () => {
    const { promote, userRepo } = makeCtx();
    seedUser(userRepo, { id: ADMIN_ID, isAdmin: true });

    await expect(
      promote.execute({
        actorAdminId: ADMIN_ID,
        targetUserId: ADMIN_ID,
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(SelfModificationError);
  });
});

describe("DemoteUserService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: revokes admin when another active admin exists", async () => {
    const { demote, userRepo, adminActions } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, isAdmin: true });
    seedUser(userRepo, { id: OTHER_PLAYER_ID, isAdmin: true });

    const result = await demote.execute({
      actorAdminId: ADMIN_ID,
      targetUserId: SEED_PLAYER_ID,
      reason: "stepping down",
    });

    expect(result.applied).toBe(true);
    expect((await userRepo.findById(SEED_PLAYER_ID))?.isAdmin).toBe(false);
    expect(adminActions.records[0]).toMatchObject({
      action: "demote",
      reason: "stepping down",
    });
  });

  it("idempotent: non-admin target → applied false, no audit row", async () => {
    const { demote, userRepo, adminActions } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, isAdmin: false });

    const result = await demote.execute({
      actorAdminId: ADMIN_ID,
      targetUserId: SEED_PLAYER_ID,
      reason: "x",
    });

    expect(result.applied).toBe(false);
    expect(adminActions.records).toHaveLength(0);
  });

  it("self-modification guard: actor === target → SelfModificationError", async () => {
    const { demote, userRepo } = makeCtx();
    seedUser(userRepo, { id: ADMIN_ID, isAdmin: true });

    await expect(
      demote.execute({
        actorAdminId: ADMIN_ID,
        targetUserId: ADMIN_ID,
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(SelfModificationError);
  });

  it("last-admin guard: demoting the sole active admin → LastAdminError, still admin", async () => {
    const { demote, userRepo } = makeCtx();
    seedUser(userRepo, { id: SEED_PLAYER_ID, isAdmin: true });

    await expect(
      demote.execute({
        actorAdminId: ADMIN_ID,
        targetUserId: SEED_PLAYER_ID,
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(LastAdminError);
    expect((await userRepo.findById(SEED_PLAYER_ID))?.isAdmin).toBe(true);
  });
});
