/**
 * MODULE: tests.match_lifecycle.application.cancel-match-service
 * PURPOSE: Cover happy path + per-endpoint checklist for POST
 *          /api/matches/:id/cancel + the race-matrix rows that route
 *          through CancelMatchService (Join+Cancel late race, idempotency,
 *          watching silently wiped).
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/cancel-match-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST
 *     /cancel, "Reject / Kick / Leave flows" → "Match cancellation",
 *     "Race scenarios" → "Join + Cancel-match", "Approve + Cancel match",
 *     "Idempotency"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CancelMatchService } from "@/src/match_lifecycle/application/cancel-match-service";
import {
  AlreadyCancelledError,
  MatchAlreadyStartedError,
  MatchNotFoundError,
  NotCaptainError,
} from "@/src/match_lifecycle/domain/errors";
import { asMatchId } from "@/src/match_lifecycle/domain/match";

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
import {
  NOTIFICATION_BODIES,
  buildMatchCancelledBody,
} from "@/src/notifications/domain/notification-bodies";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

const NOW = new Date("2026-05-26T12:00:00Z");

function makeService(matchOverrides = {}) {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const notifications = new FakeNotificationRepository();
  matchRepo.put(makeMatch(matchOverrides));
  const service = new CancelMatchService(matchRepo, joinRepo, watchRepo, notifications);
  return { service, matchRepo, joinRepo, watchRepo, notifications };
}

describe("CancelMatchService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: writes cancelled_at + cancel_reason, mass-rejects pending, wipes watch", async () => {
    const { service, matchRepo, joinRepo, watchRepo, notifications } = makeService();
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: OTHER_PLAYER_ID,
      status: "accepted",
    });
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        cancelReason: "Field flooded",
      },
      NOW,
    );

    expect(result.status).toBe("cancelled");
    expect(result.rejectedPendingCount).toBe(1);
    expect(result.watchRowsDeleted).toBe(1);

    const match = await matchRepo.findById(SEED_MATCH_ID);
    expect(match?.cancelledAt).not.toBeNull();
    expect(match?.cancelReason).toBe("Field flooded");

    // The accepted JR remains accepted (spec §591 "their invite is not
    // revoked; the Cancelled match status disables the CTA anyway").
    const accepted = Array.from(joinRepo.rows.values()).find(
      (r) => r.userId === OTHER_PLAYER_ID,
    );
    expect(accepted?.status).toBe("accepted");

    // Pending → rejected(match_cancelled).
    const pending = Array.from(joinRepo.rows.values()).find(
      (r) => r.userId === SEED_PLAYER_ID,
    );
    expect(pending?.status).toBe("rejected");
    expect(pending?.autoReason).toBe("match_cancelled");

    // Watch wiped.
    expect(watchRepo.has(SEED_MATCH_ID, OTHER_PLAYER_ID)).toBe(false);

    // Notification assertions.
    const cancelledRow = notifications.inserted.find(
      (n) => n.userId === OTHER_PLAYER_ID,
    );
    expect(cancelledRow?.type).toBe("match_cancelled");
    expect(cancelledRow?.body).toBe(buildMatchCancelledBody("Field flooded"));

    const pendingRow = notifications.inserted.find(
      (n) => n.userId === SEED_PLAYER_ID,
    );
    expect(pendingRow?.type).toBe("match_cancelled");
    expect(pendingRow?.body).toBe(NOTIFICATION_BODIES.matchCancelledPending);
  });

  it("MatchNotFoundError when the match id is unknown", async () => {
    const { service } = makeService();
    const unknownMatchId = asMatchId("99999999-9999-9999-9999-999999999999");

    await expect(
      service.execute(
        {
          matchId: unknownMatchId,
          captainId: SEED_CAPTAIN_ID,
          cancelReason: "x",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  it("NotCaptainError when the calling user is not the captain", async () => {
    const { service } = makeService();

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: OTHER_PLAYER_ID,
          cancelReason: "x",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotCaptainError);
  });

  it("AlreadyCancelledError (idempotent) when the match is already cancelled", async () => {
    const { service } = makeService({
      cancelledAt: new Date("2026-05-26T11:00:00Z"),
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          cancelReason: "redo",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AlreadyCancelledError);
  });

  it("MatchAlreadyStartedError when start_time <= now (post-start cancel forbidden v1)", async () => {
    const { service } = makeService({
      startTime: new Date("2026-05-26T11:00:00Z"),
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          cancelReason: "too late",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchAlreadyStartedError);
  });

  it("race: Join + Cancel-match (Join first → cancel mass-rejects the new pending with auto_reason=match_cancelled)", async () => {
    // Spec matrix: "Join first → cancel proceeds; the new pending is
    // included in mass-reject(match_cancelled)."
    const { service, joinRepo } = makeService();
    const jr = joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "pending",
    });

    await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        cancelReason: "weather",
      },
      NOW,
    );

    const flipped = joinRepo.rows.get(jr.id);
    expect(flipped?.status).toBe("rejected");
    expect(flipped?.autoReason).toBe("match_cancelled");
  });

  it("watching wiped SILENTLY (no notifyWatching call) — spec §282", async () => {
    // Cancel does NOT route through notifyWatching (which would also
    // fire the captain push); spec §282 explicitly says watch is deleted
    // silently. We assert by checking the bulk delete count and that no
    // separate fan-out path was taken (the helper does not run, so no
    // captain-side push would happen). Watch row count after = 0.
    const { service, watchRepo } = makeService();
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        cancelReason: "no field",
      },
      NOW,
    );

    expect(result.watchRowsDeleted).toBe(2);
    expect(await watchRepo.countForMatch(SEED_MATCH_ID)).toBe(0);
    // bulkDeleted is the helper's tracker; the service uses
    // deleteAllForMatch directly (which the fake records into the same
    // log) — assertion is that both rows landed in one statement.
    expect(watchRepo.bulkDeleted).toEqual([
      { matchId: SEED_MATCH_ID, count: 2 },
    ]);
  });

  it("zero pending / zero watch — clean cancel with both counters at 0", async () => {
    const { service } = makeService();

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        cancelReason: "no players",
      },
      NOW,
    );

    expect(result.rejectedPendingCount).toBe(0);
    expect(result.watchRowsDeleted).toBe(0);
  });
});
