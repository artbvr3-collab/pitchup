/**
 * MODULE: tests.match_lifecycle.application.edit-match-service
 * PURPOSE: Cover happy path + per-endpoint checklist for PATCH
 *          /api/matches/:id + the race-matrix rows that route through
 *          EditMatchService:
 *            · Optimistic concurrency (Edit + Edit, two tabs)
 *            · capacity_below_filled (Edit total↓ or crew+ vs Approve)
 *            · Edit (remove stub) flipping isFull → notify-watching
 *            · Edit (total↑) flipping isFull → notify-watching
 *            · Surface Grass→Hard force-resets studs_allowed
 *            · Material vs non-material classification (Layer 7 hook —
 *              we don't assert notification rows yet, but the diff helper
 *              exposed by the service surface stays testable here).
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/edit-match-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id/edit",
 *     "Per-endpoint checklist" → PATCH /matches/:id, "Backend validation
 *     errors on edit save", "Race scenarios"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditMatchService } from "@/src/match_lifecycle/application/edit-match-service";
import {
  CapacityBelowFilledError,
  ConcurrentModificationError,
  InvalidCrewNameError,
  InvalidSurfaceError,
  MatchLockedError,
  MatchNotFoundError,
  NotCaptainError,
} from "@/src/match_lifecycle/domain/errors";
import { asMatchId } from "@/src/match_lifecycle/domain/match";

import {
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeNotificationRepository,
  FakeVenueRepository,
  FakeWatchRepository,
  OTHER_PLAYER_ID,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  SEED_VENUE_ID,
  makeMatch,
} from "../_helpers/fakes";
import {
  buildMatchUpdatedBody,
} from "@/src/notifications/domain/notification-bodies";

vi.mock("@/src/shared/db/with-match-lock", () => ({
  withMatchLock: <T,>(_id: string, work: (tx: unknown) => Promise<T>) =>
    work({}),
}));

const NOW = new Date("2026-05-26T12:00:00Z");
const INITIAL_UPDATED_AT = new Date("2026-05-26T00:00:00Z"); // from makeMatch

function makeService(matchOverrides = {}, venue?: FakeVenueRepository) {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const venueRepo = venue ?? new FakeVenueRepository();
  const notifications = new FakeNotificationRepository();
  matchRepo.put(makeMatch(matchOverrides));
  const service = new EditMatchService(
    matchRepo,
    joinRepo,
    watchRepo,
    venueRepo,
    notifications,
  );
  return { service, matchRepo, joinRepo, watchRepo, venueRepo, notifications };
}

describe("EditMatchService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: description change writes new updatedAt and bumps the column", async () => {
    const { service, matchRepo, notifications } = makeService();
    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        updatedAt: INITIAL_UPDATED_AT,
        patch: { description: "Bring water" },
      },
      NOW,
    );

    expect(result.status).toBe("updated");
    expect(result.notifiedWatcherCount).toBe(0);
    expect(result.updatedAt.getTime()).toBeGreaterThan(
      INITIAL_UPDATED_AT.getTime(),
    );

    const match = await matchRepo.findById(SEED_MATCH_ID);
    expect(match?.description).toBe("Bring water");

    // description-only is non-material — no match_updated notifications.
    expect(notifications.inserted.filter((n) => n.type === "match_updated").length).toBe(0);
  });

  it("MatchNotFoundError when the match id is unknown", async () => {
    const { service } = makeService();
    const unknownMatchId = asMatchId("99999999-9999-9999-9999-999999999999");

    await expect(
      service.execute(
        {
          matchId: unknownMatchId,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: { totalSpots: 15 },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  it("NotCaptainError when the calling user is not the match captain", async () => {
    const { service } = makeService();
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: OTHER_PLAYER_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: { totalSpots: 15 },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotCaptainError);
  });

  it("MatchLockedError when the match is cancelled", async () => {
    const { service } = makeService({
      cancelledAt: new Date("2026-05-26T11:00:00Z"),
    });
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: { totalSpots: 15 },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });

  it("MatchLockedError when start_time <= now (no edits during/after the match)", async () => {
    const { service } = makeService({
      startTime: new Date("2026-05-26T11:00:00Z"),
    });
    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: { totalSpots: 15 },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchLockedError);
  });

  it("ConcurrentModificationError when payload updatedAt is stale (Edit + Edit race)", async () => {
    const { service } = makeService();
    const stale = new Date("2026-05-26T00:00:00Z");
    stale.setMilliseconds(stale.getMilliseconds() + 50); // arbitrary mismatch

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: stale,
          patch: { description: "x" },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });

  it("ConcurrentModificationError fires AFTER a successful first edit — second submit with same payload mismatches", async () => {
    // Race "Edit + Edit": two tabs both loaded the same `updated_at`; the
    // first patch succeeds and bumps the column; the second sees the new
    // updated_at under the lock and 409s.
    const { service } = makeService();

    await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        updatedAt: INITIAL_UPDATED_AT,
        patch: { description: "tab-1" },
      },
      NOW,
    );

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT, // stale: tab-2 still has the first snapshot
          patch: { description: "tab-2" },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });

  it("CapacityBelowFilledError when total↓ would drop below current filled (Approve + Edit race)", async () => {
    // total=14, captain (1) + 4 crew + 1 accepted = 6 filled. Then captain
    // tries to lower total to 5 → would push filled past capacity.
    const { service, joinRepo } = makeService({
      totalSpots: 14,
      captainCrew: ["A", "B", "C", "D"],
    });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: { totalSpots: 5 },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(CapacityBelowFilledError);
  });

  it("CapacityBelowFilledError when adding stubs would push filled past total (crew + race)", async () => {
    // total=8, captain (1) + 6 crew + 1 accepted = 8 — full. Adding one
    // more stub would push to 9 → 409.
    const { service, joinRepo } = makeService({
      totalSpots: 8,
      captainCrew: ["A", "B", "C", "D", "E", "F"],
    });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: {
            captainCrew: ["A", "B", "C", "D", "E", "F", "G"],
          },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(CapacityBelowFilledError);
  });

  it("Edit (remove stub) flipping isFull true→false fires notify-watching (spec matrix)", async () => {
    // total=8, captain (1) + 6 crew + 1 accepted = 8 → isFull.
    // Removing one crew → 7 → !isFull → fan-out.
    const { service, joinRepo, watchRepo } = makeService({
      totalSpots: 8,
      captainCrew: ["A", "B", "C", "D", "E", "F"],
    });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        updatedAt: INITIAL_UPDATED_AT,
        patch: { captainCrew: ["A", "B", "C", "D", "E"] },
      },
      NOW,
    );

    expect(result.notifiedWatcherCount).toBe(1);
    expect(watchRepo.has(SEED_MATCH_ID, OTHER_PLAYER_ID)).toBe(false);
  });

  it("Edit (total↑) flipping isFull true→false fires notify-watching (spec §670)", async () => {
    // total=8, captain (1) + 6 crew + 1 accepted = 8 → isFull.
    // Raising to 9 → 8 filled / 9 capacity → !isFull → fan-out.
    const { service, joinRepo, watchRepo } = makeService({
      totalSpots: 8,
      captainCrew: ["A", "B", "C", "D", "E", "F"],
    });
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        updatedAt: INITIAL_UPDATED_AT,
        patch: { totalSpots: 9 },
      },
      NOW,
    );

    expect(result.notifiedWatcherCount).toBe(1);
    expect(watchRepo.bulkDeleted).toEqual([
      { matchId: SEED_MATCH_ID, count: 1 },
    ]);
  });

  it("Surface Grass→Hard force-resets studs_allowed=false even if the patch omitted it", async () => {
    // Venue offers both surfaces. Initial studsAllowed=true on grass.
    // Patch flips surface to hard WITHOUT touching studs — server folds
    // false in the same tx (spec §669).
    const venueRepo = new FakeVenueRepository(false);
    venueRepo.put({
      id: SEED_VENUE_ID,
      name: "Multi-Surface",
      address: "x",
      lat: 0,
      lng: 0,
      googleMapsUrl: null,
      photoUrl: null,
      surface: ["grass", "hard"],
      coverId: "c",
      active: true,
    });
    const { service, matchRepo, joinRepo, notifications } = makeService(
      { surface: "grass", studsAllowed: true },
      venueRepo,
    );
    // Seed one accepted player so match_updated notification is addressed.
    joinRepo.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        updatedAt: INITIAL_UPDATED_AT,
        patch: { surface: "hard" },
      },
      NOW,
    );

    const match = await matchRepo.findById(SEED_MATCH_ID);
    expect(match?.surface).toBe("hard");
    expect(match?.studsAllowed).toBe(false);

    // surface + studsAllowed (force-reset) are both material — one notification per accepted player.
    const updatedRows = notifications.inserted.filter((n) => n.type === "match_updated");
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]!.userId).toBe(SEED_PLAYER_ID);
    expect(updatedRows[0]!.body).toBe(buildMatchUpdatedBody(["surface", "studs"]));
  });

  it("Surface Grass→Hard with explicit studs:true in payload → still forced to false", async () => {
    // The fold-in wins over a user-supplied true — invalid combinations
    // must not reach the DB.
    const venueRepo = new FakeVenueRepository(false);
    venueRepo.put({
      id: SEED_VENUE_ID,
      name: "Multi-Surface",
      address: "x",
      lat: 0,
      lng: 0,
      googleMapsUrl: null,
      photoUrl: null,
      surface: ["grass", "hard"],
      coverId: "c",
      active: true,
    });
    const { service, matchRepo } = makeService(
      { surface: "grass", studsAllowed: true },
      venueRepo,
    );

    await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        updatedAt: INITIAL_UPDATED_AT,
        patch: { surface: "hard", studsAllowed: true },
      },
      NOW,
    );

    const match = await matchRepo.findById(SEED_MATCH_ID);
    expect(match?.studsAllowed).toBe(false);
  });

  it("InvalidSurfaceError when the requested surface is not in venue.surface", async () => {
    // Venue offers only grass; trying to switch to hard → 400.
    const { service } = makeService(); // default fake venue has only grass

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: { surface: "hard" },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidSurfaceError);
  });

  it("InvalidCrewNameError when a crew entry is blank after trim", async () => {
    const { service } = makeService();

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: { captainCrew: ["valid", "   "] },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidCrewNameError);
  });

  it("InvalidCrewNameError when a crew entry exceeds 30 chars", async () => {
    const { service } = makeService();
    const long = "a".repeat(31);

    await expect(
      service.execute(
        {
          matchId: SEED_MATCH_ID,
          captainId: SEED_CAPTAIN_ID,
          updatedAt: INITIAL_UPDATED_AT,
          patch: { captainCrew: [long] },
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidCrewNameError);
  });

  it("non-material only patch (description/totalSpots/captainCrew) — no watcher fan-out unless isFull flip", async () => {
    // Description-only change on a non-full match: no slot change at all.
    const { service, watchRepo } = makeService();
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID); // backstop — non-full, shouldn't fire

    const result = await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        updatedAt: INITIAL_UPDATED_AT,
        patch: { description: "Updated text" },
      },
      NOW,
    );

    expect(result.notifiedWatcherCount).toBe(0);
    expect(watchRepo.bulkDeleted).toEqual([]);
    expect(watchRepo.has(SEED_MATCH_ID, OTHER_PLAYER_ID)).toBe(true);
  });

  it("description: null patch deliberately clears the field", async () => {
    const { service, matchRepo } = makeService({ description: "Was set" });

    await service.execute(
      {
        matchId: SEED_MATCH_ID,
        captainId: SEED_CAPTAIN_ID,
        updatedAt: INITIAL_UPDATED_AT,
        patch: { description: null },
      },
      NOW,
    );

    const match = await matchRepo.findById(SEED_MATCH_ID);
    expect(match?.description).toBeNull();
  });
});
