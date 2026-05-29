/**
 * MODULE: tests.auth.application.delete-account-service
 * PURPOSE: Cover happy path + last-admin guard + cascade-cancel + idempotent
 *          retry paths for `DELETE /api/me` (spec personal.md "ACCOUNT
 *          ACTIONS" → Delete account, global.md "Ban / account deletion").
 * LAYER: tests / application
 * TESTS FOR: src/auth/application/delete-account-service.ts
 *
 * COMPOSITION: We compose the REAL `CancelMatchService` with in-memory fakes
 * rather than mock it — exercises the spec invariant that the cascade goes
 * through the same code path captains use manually, including the
 * SYSTEM_CANCEL_REASONS string ending up in `Match.cancel_reason` and in
 * `notification.body` via `buildMatchCancelledBody`. `withMatchLock` is
 * mocked to call the work() inline (same pattern as cancel-match-service
 * tests).
 *
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "ACCOUNT ACTIONS" → Delete
 *     account, "Admin role management & safety"
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteAccountService } from "@/src/auth/application/delete-account-service";
import { LastAdminError } from "@/src/auth/domain/errors";
import { asUserId, type User } from "@/src/auth/domain/user";
import { CancelMatchService } from "@/src/match_lifecycle/application/cancel-match-service";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import {
  NOTIFICATION_BODIES,
  buildMatchCancelledBody,
} from "@/src/notifications/domain/notification-bodies";
import { SYSTEM_CANCEL_REASONS } from "@/src/match_lifecycle/domain/system-cancel-reasons";

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

const NOW = new Date("2026-05-26T12:00:00Z");

function makeService(opts: { isAdmin?: boolean } = {}) {
  const userRepo = new FakeUserRepository();
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const notifications = new FakeNotificationRepository();

  // Seed the user being deleted. `makeUser` defaults isAdmin=false.
  const user: User = {
    ...makeUser({ id: SEED_CAPTAIN_ID, name: "Captain" }),
    isAdmin: opts.isAdmin ?? false,
  };
  userRepo.seed(user);

  const cancelService = new CancelMatchService(
    matchRepo,
    joinRepo,
    watchRepo,
    notifications,
  );
  const service = new DeleteAccountService(
    userRepo,
    matchRepo,
    cancelService,
  );

  return {
    service,
    userRepo,
    matchRepo,
    joinRepo,
    watchRepo,
    notifications,
    user,
  };
}

describe("DeleteAccountService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path (no captain matches): markDeleted, returns empty cancelled list", async () => {
    const { service, userRepo } = makeService();

    const result = await service.execute({ userId: SEED_CAPTAIN_ID }, NOW);

    expect(result.cancelledMatchIds).toEqual([]);
    const user = await userRepo.findById(SEED_CAPTAIN_ID);
    expect(user?.deletedAt).not.toBeNull();
  });

  it("idempotent: re-calling on an already-deleted user is a no-op success", async () => {
    const { service, userRepo, user } = makeService();
    userRepo.seed({ ...user, deletedAt: new Date("2026-05-20T00:00:00Z") });

    const result = await service.execute({ userId: SEED_CAPTAIN_ID }, NOW);

    expect(result.cancelledMatchIds).toEqual([]);
  });

  it("missing user (race with admin hard-delete): no-op success", async () => {
    const userRepo = new FakeUserRepository();
    const matchRepo = new FakeMatchRepository();
    const cancelService = new CancelMatchService(
      matchRepo,
      new FakeJoinRequestRepository(),
      new FakeWatchRepository(),
      new FakeNotificationRepository(),
    );
    const service = new DeleteAccountService(userRepo, matchRepo, cancelService);

    const result = await service.execute(
      { userId: asUserId("ffffffff-ffff-ffff-ffff-ffffffffffff") },
      NOW,
    );

    expect(result.cancelledMatchIds).toEqual([]);
  });

  it("last-admin guard: throws LastAdminError when caller is sole active admin", async () => {
    const { service, userRepo } = makeService({ isAdmin: true });

    await expect(
      service.execute({ userId: SEED_CAPTAIN_ID }, NOW),
    ).rejects.toBeInstanceOf(LastAdminError);

    // markDeleted NOT called — account still active.
    const user = await userRepo.findById(SEED_CAPTAIN_ID);
    expect(user?.deletedAt).toBeNull();
  });

  it("last-admin guard: passes when another active admin exists", async () => {
    const { service, userRepo } = makeService({ isAdmin: true });
    userRepo.seed({
      ...makeUser({ id: OTHER_PLAYER_ID, name: "Other admin" }),
      isAdmin: true,
    });

    const result = await service.execute({ userId: SEED_CAPTAIN_ID }, NOW);

    expect(result.cancelledMatchIds).toEqual([]);
    const user = await userRepo.findById(SEED_CAPTAIN_ID);
    expect(user?.deletedAt).not.toBeNull();
  });

  it("last-admin guard: banned admin does NOT count toward the active total", async () => {
    const { service, userRepo } = makeService({ isAdmin: true });
    userRepo.seed({
      ...makeUser({ id: OTHER_PLAYER_ID, name: "Banned admin" }),
      isAdmin: true,
      banned: true,
    });

    await expect(
      service.execute({ userId: SEED_CAPTAIN_ID }, NOW),
    ).rejects.toBeInstanceOf(LastAdminError);
  });

  it("last-admin guard: soft-deleted admin does NOT count toward the active total", async () => {
    const { service, userRepo } = makeService({ isAdmin: true });
    userRepo.seed({
      ...makeUser({ id: OTHER_PLAYER_ID, name: "Deleted admin" }),
      isAdmin: true,
      deletedAt: new Date("2026-04-01T00:00:00Z"),
    });

    await expect(
      service.execute({ userId: SEED_CAPTAIN_ID }, NOW),
    ).rejects.toBeInstanceOf(LastAdminError);
  });

  it("non-admin: no last-admin guard probe; deletes regardless", async () => {
    const { service, userRepo } = makeService({ isAdmin: false });

    await service.execute({ userId: SEED_CAPTAIN_ID }, NOW);

    const user = await userRepo.findById(SEED_CAPTAIN_ID);
    expect(user?.deletedAt).not.toBeNull();
  });

  it("cascade: each upcoming captain match is cancelled with the canonical reason", async () => {
    const { service, matchRepo, joinRepo, watchRepo, notifications } =
      makeService();

    const matchA = makeMatch({
      id: asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01"),
      startTime: new Date("2026-06-01T17:00:00Z"),
    });
    const matchB = makeMatch({
      id: asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02"),
      startTime: new Date("2026-06-02T17:00:00Z"),
    });
    matchRepo.put(matchA);
    matchRepo.put(matchB);

    // Seed: matchA has one accepted player + one pending + one watcher.
    joinRepo.seed({
      matchId: matchA.id,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    joinRepo.seed({
      matchId: matchA.id,
      userId: OTHER_PLAYER_ID,
      status: "pending",
    });
    watchRepo.seed(matchA.id, SEED_PLAYER_ID);

    const result = await service.execute({ userId: SEED_CAPTAIN_ID }, NOW);

    expect(result.cancelledMatchIds).toContain(matchA.id);
    expect(result.cancelledMatchIds).toContain(matchB.id);

    // matchA: cancel_reason carries the spec string.
    const cancelledA = await matchRepo.findById(matchA.id);
    expect(cancelledA?.cancelledAt).not.toBeNull();
    expect(cancelledA?.cancelReason).toBe(
      SYSTEM_CANCEL_REASONS.organizerRemoved,
    );

    // Watch was wiped silently (no spot_opened notification for the watcher).
    expect(watchRepo.has(matchA.id, SEED_PLAYER_ID)).toBe(false);
    const spotOpened = notifications.inserted.filter(
      (n) => n.type === "spot_opened",
    );
    expect(spotOpened).toHaveLength(0);

    // Accepted player gets the standard cascade body.
    const acceptedBody = notifications.inserted.find(
      (n) => n.userId === SEED_PLAYER_ID && n.matchId === matchA.id,
    );
    expect(acceptedBody?.type).toBe("match_cancelled");
    expect(acceptedBody?.body).toBe(
      buildMatchCancelledBody(SYSTEM_CANCEL_REASONS.organizerRemoved),
    );

    // Former-pending player gets the fixed no-interpolation body.
    const pendingBody = notifications.inserted.find(
      (n) => n.userId === OTHER_PLAYER_ID && n.matchId === matchA.id,
    );
    expect(pendingBody?.type).toBe("match_cancelled");
    expect(pendingBody?.body).toBe(NOTIFICATION_BODIES.matchCancelledPending);
  });

  it("cascade: InProgress / past matches are NOT touched (start_time <= now)", async () => {
    const { service, matchRepo } = makeService();

    const past = makeMatch({
      id: asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03"),
      startTime: new Date("2026-05-20T17:00:00Z"), // before NOW
    });
    const upcoming = makeMatch({
      id: asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04"),
      startTime: new Date("2026-06-10T17:00:00Z"),
    });
    matchRepo.put(past);
    matchRepo.put(upcoming);

    const result = await service.execute({ userId: SEED_CAPTAIN_ID }, NOW);

    expect(result.cancelledMatchIds).toEqual([upcoming.id]);
    const pastAfter = await matchRepo.findById(past.id);
    expect(pastAfter?.cancelledAt).toBeNull();
  });

  it("cascade: already-cancelled matches are filtered out at fetch time", async () => {
    const { service, matchRepo } = makeService();

    const alreadyCancelled = makeMatch({
      id: asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05"),
      startTime: new Date("2026-06-01T17:00:00Z"),
      cancelledAt: new Date("2026-05-26T11:00:00Z"),
      cancelReason: "Captain changed mind",
    });
    matchRepo.put(alreadyCancelled);

    const result = await service.execute({ userId: SEED_CAPTAIN_ID }, NOW);

    expect(result.cancelledMatchIds).toEqual([]);
    // Cancel reason untouched (the cascade did not re-cancel).
    const after = await matchRepo.findById(alreadyCancelled.id);
    expect(after?.cancelReason).toBe("Captain changed mind");
  });

  it("does NOT touch matches captained by other users", async () => {
    const { service, matchRepo } = makeService();

    const others = makeMatch({
      id: asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06"),
      captainId: OTHER_PLAYER_ID,
      startTime: new Date("2026-06-01T17:00:00Z"),
    });
    matchRepo.put(others);

    const result = await service.execute({ userId: SEED_CAPTAIN_ID }, NOW);

    expect(result.cancelledMatchIds).toEqual([]);
    const after = await matchRepo.findById(others.id);
    expect(after?.cancelledAt).toBeNull();
  });

  it("markDeleted runs LAST: a cascade failure leaves the account active", async () => {
    const { service, matchRepo, userRepo, joinRepo } = makeService();

    const upcoming = makeMatch({
      id: asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa07"),
      startTime: new Date("2026-06-01T17:00:00Z"),
    });
    matchRepo.put(upcoming);

    // Force a non-recoverable error mid-cascade: make joinRepo.massRejectPending
    // throw a generic Error (not Already* / MatchAlreadyStarted, so it propagates).
    const originalMassReject = joinRepo.massRejectPending.bind(joinRepo);
    joinRepo.massRejectPending = vi.fn().mockRejectedValue(
      new Error("simulated DB failure"),
    );

    await expect(
      service.execute({ userId: SEED_CAPTAIN_ID }, NOW),
    ).rejects.toThrow("simulated DB failure");

    // Account NOT marked deleted; user can retry.
    const user = await userRepo.findById(SEED_CAPTAIN_ID);
    expect(user?.deletedAt).toBeNull();

    // Restore for the test runner cleanliness.
    joinRepo.massRejectPending = originalMassReject;
  });
});
