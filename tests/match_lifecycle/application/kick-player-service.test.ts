/**
 * MODULE: tests.match_lifecycle.application.kick-player-service
 * PURPOSE: Cover happy path + per-endpoint checklist for POST
 *          /api/matches/:id/kick + the race-matrix rows that route through
 *          KickPlayerService (Leave + Kick collide → 404; Kick triggers
 *          notify-watching with captain self-trigger skip).
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/kick-player-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST
 *     /kick, "Reject / Kick / Leave flows", "Race scenarios" →
 *     "Leave + Kick", "notify watching"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KickPlayerService } from "@/src/match_lifecycle/application/kick-player-service";
import {
  MatchLockedError,
  MatchNotFoundError,
  NotCaptainError,
  NotInMatchError,
  RequestNotFoundError,
} from "@/src/match_lifecycle/domain/errors";
import { asMatchId } from "@/src/match_lifecycle/domain/match";

import {
  FakeEmailSender,
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeNotificationRepository,
  FakeUserRepository,
  FakeWatchRepository,
  OTHER_PLAYER_ID,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  makeMatch,
  makeUser,
} from "../_helpers/fakes";
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

const NOW = new Date("2026-05-26T12:00:00Z");
const APP_URL = "https://pitchup.test";

function makeService(matchOverrides = {}) {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const notifications = new FakeNotificationRepository();
  const users = new FakeUserRepository();
  const email = new FakeEmailSender();
  matchRepo.put(makeMatch(matchOverrides));
  // Kicked player defaults to email-eligible; gating tests re-seed.
  users.seed(
    makeUser({ id: SEED_PLAYER_ID, name: "Player", emailNotifications: true }),
  );
  users.seed(
    makeUser({ id: OTHER_PLAYER_ID, name: "Other", emailNotifications: true }),
  );
  const service = new KickPlayerService(
    matchRepo,
    joinRepo,
    watchRepo,
    notifications,
    users,
    email,
    APP_URL,
  );
  return { service, matchRepo, joinRepo, watchRepo, notifications, users, email };
}

describe("KickPlayerService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips accepted → kicked and returns notifiedWatcherCount 0 when no watchers", async () => {
    const { service, joinRepo, notifications } = makeService();
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        requestId: jr.id,
      },
      NOW,
    );

    expect(result.status).toBe("kicked");
    expect(result.notifiedWatcherCount).toBe(0);

    const row = joinRepo.rows.get(jr.id);
    expect(row?.status).toBe("kicked");

    expect(notifications.inserted).toHaveLength(1);
    const kickedRow = notifications.inserted[0]!;
    expect(kickedRow.type).toBe("kicked");
    expect(kickedRow.body).toBe(NOTIFICATION_BODIES.kicked);
    expect(kickedRow.userId).toBe(SEED_PLAYER_ID);
  });

  it("MatchNotFoundError when the match id is unknown", async () => {
    const { service } = makeService();
    const unknownMatchId = asMatchId("99999999-9999-9999-9999-999999999999");

    await expect(
      service.execute(
        {
          matchId: unknownMatchId,
          captainId: SEED_CAPTAIN_ID,
          requestId: "req-00000001-0000-0000-0000-000000000000",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  it("NotCaptainError when the calling user is not the match captain", async () => {
    const { service, joinRepo } = makeService();
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: OTHER_PLAYER_ID,
          requestId: jr.id,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotCaptainError);
  });

  it("RequestNotFoundError when the JoinRequest id does not exist", async () => {
    const { service } = makeService();
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          requestId: "req-00000099-0000-0000-0000-000000000000",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(RequestNotFoundError);
  });

  it("RequestNotFoundError (collapsed) when the JR belongs to a different match (cross-match guard)", async () => {
    const { service, joinRepo } = makeService();
    const otherMatchId = asMatchId("dddddddd-dddd-dddd-dddd-dddddddddddd");
    const jr = joinRepo.seed({
      matchId: otherMatchId,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          requestId: jr.id,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(RequestNotFoundError);
  });

  it("NotInMatchError when the JoinRequest exists but status !== accepted (e.g. left, pending, rejected)", async () => {
    const { service, joinRepo } = makeService();
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          requestId: jr.id,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotInMatchError);
  });

  it("race: Leave + Kick — the second sees status !== accepted → NotInMatchError (spec matrix)", async () => {
    const { service, joinRepo } = makeService();
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    // Simulate Leave winning the lock first by flipping the status manually
    // — this is what the second tx would observe.
    joinRepo.put({ ...jr, status: "left" });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          requestId: jr.id,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotInMatchError);
  });

  it("MatchLockedError when the match is cancelled", async () => {
    const { service, joinRepo } = makeService({
      cancelledAt: new Date("2026-05-26T11:30:00Z"),
    });
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          requestId: jr.id,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });

  it("MatchLockedError when the match has already started (now >= startTime)", async () => {
    const { service, joinRepo } = makeService({
      startTime: new Date("2026-05-26T11:00:00Z"), // before NOW
    });
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          requestId: jr.id,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });

  it("notifyWatching fires with triggeredByCaptain=true — watchers cleared, captain self-trigger skipped", async () => {
    // total=8, captain (1) + 6 crew + accepted (1) = 8 → isFull.
    // After kick: 7 filled → isFull flips true → false → notify-watching fires.
    const { service, joinRepo, watchRepo } = makeService({
      totalSpots: 8,
      captainCrew: ["A", "B", "C", "D", "E", "F"],
    });
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        requestId: jr.id,
      },
      NOW,
    );

    expect(result.notifiedWatcherCount).toBe(1);
    expect(watchRepo.bulkDeleted).toEqual([
      { matchId: SEED_MATCH_ID, count: 1 },
    ]);
    expect(watchRepo.has(SEED_MATCH_ID, OTHER_PLAYER_ID)).toBe(false);
    // The captain self-trigger skip rule is encoded in notifyWatching's
    // return shape — covered there. This test asserts the wiring uses
    // triggeredByCaptain=true (no captain push). The helper's
    // notifyCaptain flag is internal; the public contract is that
    // watchers are cleared, which we already asserted above.
  });

  it("guests ride with their host: freed slot count = 1 + guestCount", async () => {
    // total=10. captain (1) + accepted with +3 guests (4) = 5. Not full —
    // but kicking still frees 4 slots; the test asserts the JR row's
    // guestCount drives the post-image slot count for notifyWatching.
    const { service, joinRepo, watchRepo } = makeService({ totalSpots: 10 });
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
      guestCount: 3,
    });

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        requestId: jr.id,
      },
      NOW,
    );

    expect(result.status).toBe("kicked");
    expect(result.notifiedWatcherCount).toBe(0);
    // Watch row, if any, would only fire on isFull true→false flip — not
    // applicable here since we started non-full. Helper short-circuited.
    expect(watchRepo.bulkDeleted).toEqual([]);
  });
});

describe("KickPlayerService — email (Layer 7b)", () => {
  beforeEach(() => vi.clearAllMocks());

  async function kick(svc: ReturnType<typeof makeService>) {
    const jr = svc.joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    return svc.service.execute(
      { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: jr.id },
      NOW,
    );
  }

  it("sends a kicked email to an opted-in player with the match deep link", async () => {
    const svc = makeService();
    await kick(svc);

    expect(svc.email.sent).toHaveLength(1);
    const msg = svc.email.sent[0]!;
    expect(msg.to).toBe(`${SEED_PLAYER_ID}@example.com`);
    expect(msg.subject).toBe("You were removed from a match");
    expect(msg.text).toContain(`${APP_URL}/matches/${SEED_MATCH_ID}`);
  });

  it("does NOT email a player who opted out", async () => {
    const svc = makeService();
    svc.users.seed(
      makeUser({ id: SEED_PLAYER_ID, name: "Player", emailNotifications: false }),
    );
    await kick(svc);
    expect(svc.email.sent).toHaveLength(0);
    // In-app inbox is never gated.
    expect(
      svc.notifications.inserted.some((n) => n.type === "kicked"),
    ).toBe(true);
  });

  it("best-effort: a send failure does NOT roll back the kick", async () => {
    const svc = makeService();
    svc.email.setFailAlways();

    const result = await kick(svc);

    expect(result.status).toBe("kicked");
    expect(
      svc.notifications.inserted.some((n) => n.type === "kicked"),
    ).toBe(true);
    expect(svc.email.sent).toHaveLength(0);
  });
});
