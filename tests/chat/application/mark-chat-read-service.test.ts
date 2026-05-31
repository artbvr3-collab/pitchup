/**
 * MODULE: tests.chat.application.mark-chat-read-service
 * PURPOSE: Cover MarkChatReadService — the mark-as-read UPSERT behind the
 *          /chats unread dot. Verifies the cursor is written with the injected
 *          `now`, the matchId is branded from the raw string, and a second
 *          call advances the cursor (idempotent on the key).
 * LAYER: tests / application
 * TESTS FOR: src/chat/application/mark-chat-read-service.ts
 * MOCKS: none — no lock (chat read-state). FakeChatReadRepository from
 *        _helpers/fakes.ts.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/chats" → "Mark-as-read"
 */
import { describe, expect, it } from "vitest";

import { MarkChatReadService } from "@/src/chat/application/mark-chat-read-service";
import { asUserId } from "@/src/auth/domain/user";
import { asMatchId } from "@/src/match_lifecycle/domain/match";

import {
  FakeChatReadRepository,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
} from "../../match_lifecycle/_helpers/fakes";

const NOW = new Date("2026-05-26T12:00:00Z");

describe("MarkChatReadService", () => {
  it("writes the read cursor at `now` for (matchId, userId)", async () => {
    const repo = new FakeChatReadRepository();
    const service = new MarkChatReadService(repo);

    await service.execute({ matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID }, NOW);

    expect(repo.markReadCalls).toHaveLength(1);
    expect(repo.markReadCalls[0]).toEqual({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      lastReadAt: NOW,
    });
    const cursors = await repo.listLastReadForUser(SEED_PLAYER_ID, [SEED_MATCH_ID]);
    expect(cursors.get(SEED_MATCH_ID)).toEqual(NOW);
  });

  it("brands a raw-string matchId before hitting the repository", async () => {
    const repo = new FakeChatReadRepository();
    const service = new MarkChatReadService(repo);
    const rawId = "11111111-0000-0000-0000-000000000009";

    await service.execute({ matchId: rawId, userId: SEED_PLAYER_ID }, NOW);

    const cursors = await repo.listLastReadForUser(SEED_PLAYER_ID, [
      asMatchId(rawId),
    ]);
    expect(cursors.get(asMatchId(rawId))).toEqual(NOW);
  });

  it("advances the cursor on a second open (idempotent on the key)", async () => {
    const repo = new FakeChatReadRepository();
    const service = new MarkChatReadService(repo);
    const later = new Date("2026-05-26T13:30:00Z");

    await service.execute({ matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID }, NOW);
    await service.execute({ matchId: SEED_MATCH_ID, userId: SEED_PLAYER_ID }, later);

    const cursors = await repo.listLastReadForUser(SEED_PLAYER_ID, [SEED_MATCH_ID]);
    expect(cursors.get(SEED_MATCH_ID)).toEqual(later);
    // No duplicate rows — same key overwritten, distinct users untouched.
    const otherUser = await repo.listLastReadForUser(asUserId(
      "22222222-0000-0000-0000-000000000000",
    ), [SEED_MATCH_ID]);
    expect(otherUser.size).toBe(0);
  });
});
