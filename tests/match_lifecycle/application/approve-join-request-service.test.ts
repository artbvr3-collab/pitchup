/**
 * MODULE: tests.match_lifecycle.application.approve-join-request-service
 * PURPOSE: Cover happy path + per-endpoint checklist + race-matrix scenarios
 *          for POST /api/matches/:id/approve.
 * LAYER: tests / application
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Approve flow", "Per-endpoint
 *     checklist" → POST /approve, "Race scenarios — resolution matrix"
 *   - docs/spec/pitchup-spec-global.md → "Total spots — hard cap on approve"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApproveJoinRequestService } from "@/src/match_lifecycle/application/approve-join-request-service";
import {
  AlreadyProcessedError,
  MatchLockedError,
  MatchNotFoundError,
  NotCaptainError,
  OverCapacityError,
  RequestNotFoundError,
} from "@/src/match_lifecycle/domain/errors";
import { asJoinRequestId } from "@/src/match_lifecycle/domain/join-request";

import {
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeNotificationRepository,
  FakeWatchRepository,
  OTHER_PLAYER_ID,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  makeMatch,
} from "../_helpers/fakes";
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

const NOW = new Date("2026-05-26T12:00:00Z");

function makeService() {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const notifications = new FakeNotificationRepository();
  matchRepo.put(makeMatch());
  const service = new ApproveJoinRequestService(matchRepo, joinRepo, watchRepo, notifications);
  return { service, matchRepo, joinRepo, watchRepo, notifications };
}

describe("ApproveJoinRequestService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips pending → accepted and removes the user's Watch", async () => {
    const { service, joinRepo, watchRepo, notifications } = makeService();
    const req = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req.id },
      NOW,
    );

    expect(result.status).toBe("accepted");
    expect(joinRepo.rows.get(req.id)!.status).toBe("accepted");
    expect(watchRepo.has(SEED_MATCH_ID, SEED_PLAYER_ID)).toBe(false);

    expect(notifications.inserted).toHaveLength(1);
    const approvedRow = notifications.inserted[0]!;
    expect(approvedRow.type).toBe("approved");
    expect(approvedRow.body).toBe(NOTIFICATION_BODIES.approved);
    expect(approvedRow.userId).toBe(SEED_PLAYER_ID);
  });

  it("404s when the match id does not exist", async () => {
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

  it("404s when the request id does not exist", async () => {
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

  it("404s when the request belongs to a different match", async () => {
    const { service, joinRepo } = makeService();
    const req = joinRepo.seed({
      matchId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as never,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });
    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req.id },
        NOW,
      ),
    ).rejects.toBeInstanceOf(RequestNotFoundError);
  });

  it.each(["accepted", "rejected", "cancelled", "left", "kicked"] as const)(
    "409 already_processed when request is %s (race: cron / cancel / second-approve)",
    async (status) => {
      const { service, joinRepo } = makeService();
      const req = joinRepo.seed({
        matchId: SEED_MATCH_ID,
        userId: SEED_PLAYER_ID,
        status,
      });
      await expect(
        service.execute(
          {
            matchId: SEED_MATCH_ID,
            captainId: SEED_CAPTAIN_ID,
            requestId: req.id,
          },
          NOW,
        ),
      ).rejects.toBeInstanceOf(AlreadyProcessedError);
    },
  );

  it("rejects MatchLockedError when the match is cancelled", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ cancelledAt: new Date("2026-05-26T11:30:00Z") }));
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const notifications = new FakeNotificationRepository();
    const service = new ApproveJoinRequestService(matchRepo, joinRepo, watchRepo, notifications);
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

  it("rejects MatchLockedError on InProgress (race: approve + match start)", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ startTime: new Date("2026-05-26T11:00:00Z") }));
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const notifications = new FakeNotificationRepository();
    const service = new ApproveJoinRequestService(matchRepo, joinRepo, watchRepo, notifications);
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

  it("enforces hard cap (over_capacity) — single approve that would exceed total", async () => {
    // total=8, captain+6 crew = 7 filled. Pending with 1 guest needs 2 slots →
    // would make filled=9 > 8 → OverCapacityError.
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({
        totalSpots: 8,
        captainCrew: ["A", "B", "C", "D", "E", "F"],
      }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const notifications = new FakeNotificationRepository();
    const service = new ApproveJoinRequestService(matchRepo, joinRepo, watchRepo, notifications);
    const req = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
      guestCount: 1,
    });

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req.id },
        NOW,
      ),
    ).rejects.toBeInstanceOf(OverCapacityError);
    expect(joinRepo.rows.get(req.id)!.status).toBe("pending");
  });

  it("Approve + Approve race — second one trips over_capacity on the last slot", async () => {
    // total=8, captain alone = 1 filled, 7 free. Seed two pendings each with
    // guest_count=3 (4 slots each). First approve succeeds (5 filled → 3 free).
    // Second approve would push to 9 > 8 → OverCapacityError.
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ totalSpots: 8, captainCrew: [] }));
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const notifications = new FakeNotificationRepository();
    const service = new ApproveJoinRequestService(matchRepo, joinRepo, watchRepo, notifications);

    const req1 = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
      guestCount: 3,
    });
    const req2 = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: OTHER_PLAYER_ID,
      status: "pending",
      guestCount: 4,
    });

    await service.execute(
      { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req1.id },
      NOW,
    );
    expect(joinRepo.rows.get(req1.id)!.status).toBe("accepted");

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req2.id },
        NOW,
      ),
    ).rejects.toBeInstanceOf(OverCapacityError);
    expect(joinRepo.rows.get(req2.id)!.status).toBe("pending");
  });

  it("approve exactly fills the match (filled === capacity is allowed)", async () => {
    // total=8, captain+crew=4. Pending with 3 guests = 4 slots → filled=8.
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(
      makeMatch({ totalSpots: 8, captainCrew: ["A", "B", "C"] }),
    );
    const joinRepo = new FakeJoinRequestRepository();
    const watchRepo = new FakeWatchRepository();
    const notifications = new FakeNotificationRepository();
    const service = new ApproveJoinRequestService(matchRepo, joinRepo, watchRepo, notifications);
    const req = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
      guestCount: 3,
    });

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, captainId: SEED_CAPTAIN_ID, requestId: req.id },
      NOW,
    );
    expect(result.status).toBe("accepted");
  });
});
