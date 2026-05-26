/**
 * MODULE: tests.chat.application.post-chat-message-service
 * PURPOSE: Cover every branch of PostChatMessageService — happy paths for
 *          captain and accepted-player authors, plus all error paths from
 *          the per-endpoint checklist for POST /api/matches/:id/messages.
 * LAYER: tests / application
 * TESTS FOR: src/chat/application/post-chat-message-service.ts
 * MOCKS: none — no withMatchLock (chat is the no-lock exception, spec §546).
 *        Repository ports are in-memory fakes from _helpers/fakes.ts.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Tab Chat", §213, §224, §546,
 *     "Per-endpoint checklist" → POST /messages
 *   - docs/spec/pitchup-spec-global.md → "Text field validation"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PostChatMessageService } from "@/src/chat/application/post-chat-message-service";
import {
  ChatForbiddenError,
  ChatFrozenError,
  InvalidMessageTextError,
} from "@/src/chat/domain/errors";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";
import { asMatchId } from "@/src/match_lifecycle/domain/match";

import {
  FakeChatMessageRepository,
  FakeJoinRequestRepository,
  FakeMatchRepository,
  OTHER_PLAYER_ID,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  makeMatch,
} from "../../match_lifecycle/_helpers/fakes";

function makeService() {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const chatRepo = new FakeChatMessageRepository();
  matchRepo.put(makeMatch());
  const service = new PostChatMessageService(matchRepo, joinRepo, chatRepo);
  return { service, matchRepo, joinRepo, chatRepo };
}

describe("PostChatMessageService", () => {
  beforeEach(() => vi.clearAllMocks());

  // ---------------------------------------------------------------------------
  // Happy paths
  // ---------------------------------------------------------------------------

  it("captain posts — inserts ChatMessage with correct fields and returns it", async () => {
    const { service, chatRepo } = makeService();

    const result = await service.execute({
      matchId: SEED_MATCH_ID,
      authorId: SEED_CAPTAIN_ID,
      text: "  Let's kick off at 5  ",
    });

    expect(chatRepo.rows.size).toBe(1);
    const row = [...chatRepo.rows.values()][0]!;
    expect(row.matchId).toBe(SEED_MATCH_ID);
    expect(row.authorId).toBe(SEED_CAPTAIN_ID);
    // Text must be trimmed before persistence
    expect(row.text).toBe("Let's kick off at 5");
    expect(row.deletedAt).toBeNull();
    expect(result).toEqual(row);
  });

  it("accepted player posts — ChatMessage inserted successfully", async () => {
    const { service, joinRepo, chatRepo } = makeService();
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, status: "accepted" });

    const result = await service.execute({
      matchId: SEED_MATCH_ID,
      authorId: SEED_PLAYER_ID,
      text: "Ready!",
    });

    expect(chatRepo.rows.size).toBe(1);
    expect(result.authorId).toBe(SEED_PLAYER_ID);
    expect(result.text).toBe("Ready!");
  });

  // ---------------------------------------------------------------------------
  // 404 — match not found
  // ---------------------------------------------------------------------------

  it("throws MatchNotFoundError when match does not exist", async () => {
    const { service } = makeService();
    await expect(
      service.execute({
        matchId: asMatchId("ffffffff-ffff-ffff-ffff-ffffffffffff"),
        authorId: SEED_CAPTAIN_ID,
        text: "hello",
      }),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  // ---------------------------------------------------------------------------
  // 409 — chat frozen (cancelled match)
  // ---------------------------------------------------------------------------

  it("throws ChatFrozenError on a cancelled match", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ cancelledAt: new Date("2026-05-26T09:00:00Z") }));
    const service = new PostChatMessageService(
      matchRepo,
      new FakeJoinRequestRepository(),
      new FakeChatMessageRepository(),
    );

    await expect(
      service.execute({ matchId: SEED_MATCH_ID, authorId: SEED_CAPTAIN_ID, text: "hi" }),
    ).rejects.toBeInstanceOf(ChatFrozenError);
  });

  // ---------------------------------------------------------------------------
  // 403 — chat forbidden
  // ---------------------------------------------------------------------------

  it("throws ChatForbiddenError when viewer has no JoinRequest (not a member)", async () => {
    const { service } = makeService();
    await expect(
      service.execute({
        matchId: SEED_MATCH_ID,
        authorId: OTHER_PLAYER_ID,
        text: "Can I post?",
      }),
    ).rejects.toBeInstanceOf(ChatForbiddenError);
  });

  it("throws ChatForbiddenError when viewer JoinRequest is pending", async () => {
    const { service, joinRepo } = makeService();
    joinRepo.seed({ matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, status: "pending" });

    await expect(
      service.execute({
        matchId: SEED_MATCH_ID,
        authorId: SEED_PLAYER_ID,
        text: "Am I in?",
      }),
    ).rejects.toBeInstanceOf(ChatForbiddenError);
  });

  it.each(["rejected", "cancelled", "left", "kicked"] as const)(
    "throws ChatForbiddenError when viewer JoinRequest status is %s",
    async (status) => {
      const { service, joinRepo } = makeService();
      joinRepo.seed({ matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID, status });

      await expect(
        service.execute({
          matchId: SEED_MATCH_ID,
          authorId: SEED_PLAYER_ID,
          text: "Still here?",
        }),
      ).rejects.toBeInstanceOf(ChatForbiddenError);
    },
  );

  // ---------------------------------------------------------------------------
  // 400 — invalid message text
  // ---------------------------------------------------------------------------

  it("throws InvalidMessageTextError on whitespace-only text", async () => {
    const { service } = makeService();
    await expect(
      service.execute({
        matchId: SEED_MATCH_ID,
        authorId: SEED_CAPTAIN_ID,
        text: "   ",
      }),
    ).rejects.toBeInstanceOf(InvalidMessageTextError);
  });

  it("throws InvalidMessageTextError when trimmed text exceeds 2000 chars", async () => {
    const { service } = makeService();
    const longText = "a".repeat(2001);
    await expect(
      service.execute({
        matchId: SEED_MATCH_ID,
        authorId: SEED_CAPTAIN_ID,
        text: longText,
      }),
    ).rejects.toBeInstanceOf(InvalidMessageTextError);
  });

  // ---------------------------------------------------------------------------
  // Text trimming before persistence
  // ---------------------------------------------------------------------------

  it("stores trimmed text even when leading/trailing spaces were present", async () => {
    const { service, chatRepo } = makeService();
    await service.execute({
      matchId: SEED_MATCH_ID,
      authorId: SEED_CAPTAIN_ID,
      text: "  hello world  ",
    });
    const row = [...chatRepo.rows.values()][0]!;
    expect(row.text).toBe("hello world");
  });
});
