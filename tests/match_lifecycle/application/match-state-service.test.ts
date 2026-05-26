/**
 * MODULE: tests.match_lifecycle.application.match-state-service
 * PURPOSE: Cover every branch of MatchStateService — 404, lineup visibility
 *          rules (captain vs. non-captain vs. guest), message delta/full-history
 *          semantics (since=null, since=ISO, OR-branch for soft-deletes), user
 *          resolution (banned, deleted), status derivation, and watching_count.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/match-state-service.ts
 * MOCKS: none — pure read service, no locks. Repository ports are in-memory
 *        fakes from _helpers/fakes.ts.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Polling for match state" (§195-212),
 *     §213-216, "Tab Lineup", "Tab Chat"
 *   - docs/spec/pitchup-spec-global.md → "Polling sync"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asChatMessageId, type ChatMessage } from "@/src/chat/domain/chat-message";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import {
  MatchStateService,
  MESSAGE_FETCH_LIMIT,
} from "@/src/match_lifecycle/application/match-state-service";
import { asUserId } from "@/src/auth/domain/user";

import {
  FakeChatMessageRepository,
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeUserRepository,
  FakeWatchRepository,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  OTHER_PLAYER_ID,
  makeMatch,
  makeUser,
} from "../_helpers/fakes";

const NOW = new Date("2026-05-26T12:00:00Z");
// Start time well in the future so the match is "Open" by default.
const FUTURE_START = new Date("2026-07-01T17:00:00Z");

function makeService() {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const watchRepo = new FakeWatchRepository();
  const chatRepo = new FakeChatMessageRepository();
  const userRepo = new FakeUserRepository();

  // Seed a default live match and its captain user
  matchRepo.put(makeMatch({ startTime: FUTURE_START }));
  userRepo.seed(makeUser({ id: SEED_CAPTAIN_ID, name: "Captain" }));
  userRepo.seed(makeUser({ id: SEED_PLAYER_ID, name: "Player" }));
  userRepo.seed(makeUser({ id: OTHER_PLAYER_ID, name: "Other" }));

  const service = new MatchStateService(matchRepo, joinRepo, watchRepo, chatRepo, userRepo);
  return { service, matchRepo, joinRepo, watchRepo, chatRepo, userRepo };
}

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: asChatMessageId(`msg-${Date.now()}-0000-0000-0000-000000000000`),
    matchId: SEED_MATCH_ID,
    authorId: SEED_CAPTAIN_ID,
    text: "Hello",
    createdAt: new Date("2026-05-26T08:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("MatchStateService", () => {
  beforeEach(() => vi.clearAllMocks());

  // ---------------------------------------------------------------------------
  // 404 — match not found
  // ---------------------------------------------------------------------------

  it("throws MatchNotFoundError when match does not exist", async () => {
    const { service } = makeService();
    await expect(
      service.execute(
        { matchId: asMatchId("ffffffff-ffff-ffff-ffff-ffffffffffff"), viewerId: SEED_CAPTAIN_ID, since: null },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  // ---------------------------------------------------------------------------
  // Captain view — full lineup including pending
  // ---------------------------------------------------------------------------

  it("captain viewing live match — returns captain, accepted, pending in lineup", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, status: "accepted" });
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: OTHER_PLAYER_ID, status: "pending" });

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );

    expect(result.lineup.captain.id).toBe(SEED_CAPTAIN_ID);
    expect(result.lineup.accepted).toHaveLength(1);
    expect(result.lineup.accepted[0]!.user.id).toBe(SEED_PLAYER_ID);
    // Captain sees pending list
    expect(result.lineup.pending).toHaveLength(1);
    expect(result.lineup.pending[0]!.user.id).toBe(OTHER_PLAYER_ID);
  });

  // ---------------------------------------------------------------------------
  // Non-captain viewer — pending is hidden
  // ---------------------------------------------------------------------------

  it("accepted player viewer — lineup.pending is empty (captain-only per §216)", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, status: "accepted" });
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: OTHER_PLAYER_ID, status: "pending" });

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_PLAYER_ID, since: null },
      NOW,
    );

    expect(result.lineup.pending).toEqual([]);
    // Accepted list is still visible
    expect(result.lineup.accepted).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Guest viewer (viewerId === null) — pending hidden
  // ---------------------------------------------------------------------------

  it("guest viewer (viewerId=null) — lineup.pending is empty", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: OTHER_PLAYER_ID, status: "pending" });

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: null, since: null },
      NOW,
    );

    expect(result.lineup.pending).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // since=null — full history (capped at MESSAGE_FETCH_LIMIT)
  // ---------------------------------------------------------------------------

  it("since=null — returns full message history (capped at MESSAGE_FETCH_LIMIT)", async () => {
    const { service, chatRepo } = makeService();
    // Seed MESSAGE_FETCH_LIMIT + 5 messages
    for (let i = 0; i < MESSAGE_FETCH_LIMIT + 5; i++) {
      chatRepo.seed(
        makeChatMessage({
          id: asChatMessageId(`msg-${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`),
          createdAt: new Date(2026, 4, 26, 8, i),
        }),
      );
    }

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );

    expect(result.messages).toHaveLength(MESSAGE_FETCH_LIMIT);
  });

  // ---------------------------------------------------------------------------
  // since=ISO — returns only messages with created_at > since
  // ---------------------------------------------------------------------------

  it("since=ISO — returns only messages newer than the cursor", async () => {
    const { service, chatRepo } = makeService();
    const since = new Date("2026-05-26T09:00:00Z");

    chatRepo.seed(makeChatMessage({
      id: asChatMessageId("msg-00000001-0000-0000-0000-000000000000"),
      createdAt: new Date("2026-05-26T08:00:00Z"), // before since
    }));
    chatRepo.seed(makeChatMessage({
      id: asChatMessageId("msg-00000002-0000-0000-0000-000000000000"),
      createdAt: new Date("2026-05-26T10:00:00Z"), // after since
    }));

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since },
      NOW,
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.id).toBe("msg-00000002-0000-0000-0000-000000000000");
  });

  // ---------------------------------------------------------------------------
  // since=ISO — OR-branch: soft-deleted messages with deleted_at > since
  // even when created_at < since
  // ---------------------------------------------------------------------------

  it("since=ISO — includes message whose deleted_at > since even if created_at < since", async () => {
    const { service, chatRepo } = makeService();
    const since = new Date("2026-05-26T09:00:00Z");

    // Created before since, deleted after since
    chatRepo.seed(makeChatMessage({
      id: asChatMessageId("msg-00000003-0000-0000-0000-000000000000"),
      createdAt: new Date("2026-05-26T08:00:00Z"),
      deletedAt: new Date("2026-05-26T10:00:00Z"),
    }));

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since },
      NOW,
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.id).toBe("msg-00000003-0000-0000-0000-000000000000");
    expect(result.messages[0]!.deleted_at).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Banned user author
  // ---------------------------------------------------------------------------

  it("banned user as message author — author.banned === true, name still populated", async () => {
    const { service, chatRepo, userRepo } = makeService();
    const bannedId = asUserId("55555555-5555-5555-5555-555555555555");
    userRepo.seed(makeUser({ id: bannedId, name: "Banned Player", banned: true }));

    chatRepo.seed(makeChatMessage({
      id: asChatMessageId("msg-00000004-0000-0000-0000-000000000000"),
      authorId: bannedId,
    }));

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );

    expect(result.messages).toHaveLength(1);
    const author = result.messages[0]!.author;
    expect(author).not.toBeNull();
    expect(author!.banned).toBe(true);
    expect(author!.name).toBe("Banned Player");
  });

  // ---------------------------------------------------------------------------
  // Deleted user author (deletedAt non-null)
  // ---------------------------------------------------------------------------

  it("deleted user as message author — messages[].author === null", async () => {
    const { service, chatRepo, userRepo } = makeService();
    const deletedId = asUserId("66666666-6666-6666-6666-666666666666");
    userRepo.seed(makeUser({
      id: deletedId,
      name: "Deleted Player",
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    }));

    chatRepo.seed(makeChatMessage({
      id: asChatMessageId("msg-00000005-0000-0000-0000-000000000000"),
      authorId: deletedId,
    }));

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.author).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Status derivation
  // ---------------------------------------------------------------------------

  it("cancelled match → status is 'Cancelled'", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({
      startTime: FUTURE_START,
      cancelledAt: new Date("2026-05-26T09:00:00Z"),
    }));
    const userRepo = new FakeUserRepository();
    userRepo.seed(makeUser({ id: SEED_CAPTAIN_ID, name: "Captain" }));
    const service = new MatchStateService(
      matchRepo,
      new FakeJoinRequestRepository(),
      new FakeWatchRepository(),
      new FakeChatMessageRepository(),
      userRepo,
    );

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );

    expect(result.status).toBe("Cancelled");
  });

  it("live match with open slots → status is 'Open'", async () => {
    const { service } = makeService();
    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );
    expect(result.status).toBe("Open");
  });

  // ---------------------------------------------------------------------------
  // updated_at mirrors match row's updatedAt
  // ---------------------------------------------------------------------------

  it("updated_at equals the match row's updatedAt as ISO string", async () => {
    const { service, matchRepo } = makeService();
    const updatedAt = new Date("2026-05-26T11:30:00Z");
    matchRepo.put(makeMatch({ startTime: FUTURE_START, updatedAt }));

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );

    expect(result.updated_at).toBe(updatedAt.toISOString());
  });

  // ---------------------------------------------------------------------------
  // watching_count
  // ---------------------------------------------------------------------------

  it("watching_count reflects FakeWatchRepository state", async () => {
    const { service, watchRepo } = makeService();
    watchRepo.seed(SEED_MATCH_ID, SEED_PLAYER_ID);
    watchRepo.seed(SEED_MATCH_ID, OTHER_PLAYER_ID);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );

    expect(result.lineup.watching_count).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // crew snapshot from match.captainCrew
  // ---------------------------------------------------------------------------

  it("crew in lineup is copied from match.captainCrew", async () => {
    const { service, matchRepo } = makeService();
    matchRepo.put(makeMatch({ startTime: FUTURE_START, captainCrew: ["Alice", "Bob"] }));

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, viewerId: SEED_CAPTAIN_ID, since: null },
      NOW,
    );

    expect(result.lineup.crew).toEqual(["Alice", "Bob"]);
  });
});
