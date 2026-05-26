/**
 * MODULE: tests.chat.application.delete-chat-message-service
 * PURPOSE: Cover every branch of DeleteChatMessageService — captain happy path,
 *          idempotent double-delete, and all error paths from the per-endpoint
 *          checklist for DELETE /api/matches/:id/messages/:msgId.
 * LAYER: tests / application
 * TESTS FOR: src/chat/application/delete-chat-message-service.ts
 * MOCKS: none — no withMatchLock (chat is the no-lock exception, spec §546).
 *        Repository ports are in-memory fakes from _helpers/fakes.ts.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → §225 (captain delete on Cancelled),
 *     §363, "Per-endpoint checklist" → DELETE /messages/:id
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteChatMessageService } from "@/src/chat/application/delete-chat-message-service";
import { asChatMessageId } from "@/src/chat/domain/chat-message";
import { ChatForbiddenError, MessageNotFoundError } from "@/src/chat/domain/errors";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import { asUserId } from "@/src/auth/domain/user";

import {
  FakeChatMessageRepository,
  FakeMatchRepository,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  makeMatch,
} from "../../match_lifecycle/_helpers/fakes";
import type { ChatMessage } from "@/src/chat/domain/chat-message";

const NOW = new Date("2026-05-26T12:00:00Z");
const OTHER_MATCH_ID = asMatchId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

function makeSeededMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: asChatMessageId("msg-00000001-0000-0000-0000-000000000000"),
    matchId: SEED_MATCH_ID,
    authorId: SEED_PLAYER_ID,
    text: "Hello match",
    createdAt: new Date("2026-05-26T09:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function makeService() {
  const matchRepo = new FakeMatchRepository();
  const chatRepo = new FakeChatMessageRepository();
  matchRepo.put(makeMatch());
  const service = new DeleteChatMessageService(matchRepo, chatRepo);
  return { service, matchRepo, chatRepo };
}

describe("DeleteChatMessageService", () => {
  beforeEach(() => vi.clearAllMocks());

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it("captain deletes a message — returns soft-deleted row with deletedAt set", async () => {
    const { service, chatRepo } = makeService();
    const msg = makeSeededMessage();
    chatRepo.seed(msg);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, messageId: msg.id, viewerId: SEED_CAPTAIN_ID },
      NOW,
    );

    expect(result.deletedAt).toEqual(NOW);
    expect(result.id).toBe(msg.id);
    // Row in store is now marked deleted
    const stored = chatRepo.rows.get(msg.id)!;
    expect(stored.deletedAt).toEqual(NOW);
  });

  // ---------------------------------------------------------------------------
  // Idempotent double-delete
  // ---------------------------------------------------------------------------

  it("captain deletes already-deleted message — returns row with original deletedAt unchanged", async () => {
    const { service, chatRepo } = makeService();
    const originalDeletedAt = new Date("2026-05-26T11:00:00Z");
    const msg = makeSeededMessage({ deletedAt: originalDeletedAt });
    chatRepo.seed(msg);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, messageId: msg.id, viewerId: SEED_CAPTAIN_ID },
      NOW,
    );

    // Must NOT update deletedAt — idempotent
    expect(result.deletedAt).toEqual(originalDeletedAt);
    expect(result.deletedAt).not.toEqual(NOW);
  });

  // ---------------------------------------------------------------------------
  // 404 — match not found
  // ---------------------------------------------------------------------------

  it("throws MatchNotFoundError when match does not exist", async () => {
    const { service, chatRepo } = makeService();
    const msg = makeSeededMessage({ matchId: asMatchId("ffffffff-ffff-ffff-ffff-ffffffffffff") });
    chatRepo.seed(msg);

    await expect(
      service.execute(
        {
          matchId: asMatchId("ffffffff-ffff-ffff-ffff-ffffffffffff"),
          messageId: msg.id,
          viewerId: SEED_CAPTAIN_ID,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MatchNotFoundError);
  });

  // ---------------------------------------------------------------------------
  // 403 — non-captain forbidden
  // ---------------------------------------------------------------------------

  it("throws ChatForbiddenError when viewer is an accepted player (not captain)", async () => {
    const { service, chatRepo } = makeService();
    const msg = makeSeededMessage();
    chatRepo.seed(msg);

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, messageId: msg.id, viewerId: SEED_PLAYER_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ChatForbiddenError);
  });

  // ---------------------------------------------------------------------------
  // 404 — message not found
  // ---------------------------------------------------------------------------

  it("throws MessageNotFoundError when message id does not exist", async () => {
    const { service } = makeService();
    const nonExistentId = asChatMessageId("msg-99999999-0000-0000-0000-000000000000");

    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, messageId: nonExistentId, viewerId: SEED_CAPTAIN_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MessageNotFoundError);
  });

  it("throws MessageNotFoundError on cross-match guard (message belongs to different match)", async () => {
    const { service, matchRepo, chatRepo } = makeService();
    // Seed a second match
    matchRepo.put(makeMatch({ id: OTHER_MATCH_ID }));
    // Message belongs to OTHER_MATCH_ID
    const msg = makeSeededMessage({ matchId: OTHER_MATCH_ID });
    chatRepo.seed(msg);

    // Captain of SEED_MATCH_ID tries to delete a message from OTHER_MATCH_ID
    await expect(
      service.execute(
        { matchId: SEED_MATCH_ID, messageId: msg.id, viewerId: SEED_CAPTAIN_ID },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MessageNotFoundError);
  });

  // ---------------------------------------------------------------------------
  // Captain CAN delete on Cancelled match (spec §225)
  // ---------------------------------------------------------------------------

  it("captain can delete a message on a cancelled match (no chat_frozen block)", async () => {
    const matchRepo = new FakeMatchRepository();
    matchRepo.put(makeMatch({ cancelledAt: new Date("2026-05-26T09:00:00Z") }));
    const chatRepo = new FakeChatMessageRepository();
    const service = new DeleteChatMessageService(matchRepo, chatRepo);

    const msg = makeSeededMessage();
    chatRepo.seed(msg);

    const result = await service.execute(
      { matchId: SEED_MATCH_ID, messageId: msg.id, viewerId: SEED_CAPTAIN_ID },
      NOW,
    );

    // Should succeed — no ChatFrozenError
    expect(result.deletedAt).toEqual(NOW);
  });
});
