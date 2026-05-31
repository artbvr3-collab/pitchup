/**
 * MODULE: tests.match_lifecycle.application.list-my-chats-service
 * PURPOSE: Cover ListMyChatsService — the /chats read-model assembler. Verifies
 *          the access filter (accepted/captain only), past + cancelled
 *          inclusion, on-read unread computation (ChatRead cursor vs latest
 *          foreign message, own/deleted messages ignored), and the
 *          activity-then-start_time sort.
 * LAYER: tests / application
 * TESTS FOR: src/match_lifecycle/application/list-my-chats-service.ts
 * MOCKS: none — pure read assembler, no locks. Repository ports are in-memory
 *        fakes from _helpers/fakes.ts.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/chats"
 */
import { describe, expect, it } from "vitest";

import {
  asChatMessageId,
  type ChatMessage,
} from "@/src/chat/domain/chat-message";
import { asMatchId, type MatchId } from "@/src/match_lifecycle/domain/match";
import { ListMyChatsService } from "@/src/match_lifecycle/application/list-my-chats-service";

import {
  FakeChatMessageRepository,
  FakeChatReadRepository,
  FakeJoinRequestRepository,
  FakeMatchRepository,
  OTHER_PLAYER_ID,
  SEED_PLAYER_ID,
  makeMatch,
} from "../_helpers/fakes";

const NOW = new Date("2026-05-26T12:00:00Z");
const FUTURE = new Date("2026-07-01T17:00:00Z");
const PAST = new Date("2026-05-01T17:00:00Z");
const EARLIER_PAST = new Date("2026-04-01T17:00:00Z");

// Viewer for every test.
const ME = SEED_PLAYER_ID;

const M = (n: number): MatchId =>
  asMatchId(`11111111-0000-0000-0000-${String(n).padStart(12, "0")}`);

let msgSeq = 0;
function msg(
  matchId: MatchId,
  authorId: typeof SEED_PLAYER_ID,
  createdAt: Date,
  deletedAt: Date | null = null,
): ChatMessage {
  msgSeq += 1;
  return {
    id: asChatMessageId(
      `msg-${String(msgSeq).padStart(8, "0")}-0000-0000-0000-000000000000`,
    ),
    matchId,
    authorId,
    text: "hi",
    createdAt,
    deletedAt,
  };
}

function makeService() {
  const matchRepo = new FakeMatchRepository();
  const joinRepo = new FakeJoinRequestRepository();
  const chatRepo = new FakeChatMessageRepository();
  const readRepo = new FakeChatReadRepository();
  const service = new ListMyChatsService(
    matchRepo,
    joinRepo,
    chatRepo,
    readRepo,
  );
  return { service, matchRepo, joinRepo, chatRepo, readRepo };
}

describe("ListMyChatsService", () => {
  it("returns an empty list when the user has no captain/accepted matches", async () => {
    const { service } = makeService();
    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Access filter
  // -------------------------------------------------------------------------

  it("includes captain + accepted; excludes pending / left / rejected (and watching has no row at all)", async () => {
    const { service, matchRepo, joinRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(1), captainId: ME, startTime: FUTURE }));
    matchRepo.put(makeMatch({ id: M(2), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    matchRepo.put(makeMatch({ id: M(3), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    matchRepo.put(makeMatch({ id: M(4), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    matchRepo.put(makeMatch({ id: M(5), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    joinRepo.seed({ matchId: M(2), userId: ME, status: "accepted" });
    joinRepo.seed({ matchId: M(3), userId: ME, status: "pending" });
    joinRepo.seed({ matchId: M(4), userId: ME, status: "left" });
    joinRepo.seed({ matchId: M(5), userId: ME, status: "rejected" });

    const page = await service.execute({ userId: ME }, NOW);
    const ids = page.chats.map((c) => c.match.id);

    expect(ids).toContain(M(1)); // captain
    expect(ids).toContain(M(2)); // accepted
    expect(ids).not.toContain(M(3)); // pending
    expect(ids).not.toContain(M(4)); // left
    expect(ids).not.toContain(M(5)); // rejected
    expect(page.chats).toHaveLength(2);
  });

  it("includes past captain matches and cancelled accepted matches", async () => {
    const { service, matchRepo, joinRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(1), captainId: ME, startTime: PAST }));
    matchRepo.put(
      makeMatch({
        id: M(2),
        captainId: OTHER_PLAYER_ID,
        startTime: FUTURE,
        cancelledAt: new Date("2026-05-20T00:00:00Z"),
      }),
    );
    joinRepo.seed({ matchId: M(2), userId: ME, status: "accepted" });

    const page = await service.execute({ userId: ME }, NOW);
    const ids = page.chats.map((c) => c.match.id);

    expect(ids).toContain(M(1));
    expect(ids).toContain(M(2));
    expect(page.chats.find((c) => c.match.id === M(1))!.matchStatus).toBe("ended");
    expect(page.chats.find((c) => c.match.id === M(2))!.matchStatus).toBe(
      "cancelled",
    );
  });

  // -------------------------------------------------------------------------
  // Unread computation
  // -------------------------------------------------------------------------

  it("unread = true when a foreign message exists and there is no read cursor", async () => {
    const { service, matchRepo, joinRepo, chatRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(2), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    joinRepo.seed({ matchId: M(2), userId: ME, status: "accepted" });
    chatRepo.seed(msg(M(2), OTHER_PLAYER_ID, new Date("2026-05-26T10:00:00Z")));

    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats[0]!.unread).toBe(true);
  });

  it("unread = false when the read cursor is after the latest foreign message", async () => {
    const { service, matchRepo, joinRepo, chatRepo, readRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(2), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    joinRepo.seed({ matchId: M(2), userId: ME, status: "accepted" });
    chatRepo.seed(msg(M(2), OTHER_PLAYER_ID, new Date("2026-05-26T10:00:00Z")));
    readRepo.seed(M(2), ME, new Date("2026-05-26T11:00:00Z"));

    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats[0]!.unread).toBe(false);
  });

  it("unread = true when the read cursor is before the latest foreign message", async () => {
    const { service, matchRepo, joinRepo, chatRepo, readRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(2), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    joinRepo.seed({ matchId: M(2), userId: ME, status: "accepted" });
    chatRepo.seed(msg(M(2), OTHER_PLAYER_ID, new Date("2026-05-26T10:00:00Z")));
    readRepo.seed(M(2), ME, new Date("2026-05-26T09:00:00Z"));

    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats[0]!.unread).toBe(true);
  });

  it("unread = false when the only messages are the viewer's own", async () => {
    const { service, matchRepo, joinRepo, chatRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(2), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    joinRepo.seed({ matchId: M(2), userId: ME, status: "accepted" });
    chatRepo.seed(msg(M(2), ME, new Date("2026-05-26T10:00:00Z")));

    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats[0]!.unread).toBe(false);
  });

  it("unread = false when the only foreign message is soft-deleted", async () => {
    const { service, matchRepo, joinRepo, chatRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(2), captainId: OTHER_PLAYER_ID, startTime: FUTURE }));
    joinRepo.seed({ matchId: M(2), userId: ME, status: "accepted" });
    chatRepo.seed(
      msg(
        M(2),
        OTHER_PLAYER_ID,
        new Date("2026-05-26T10:00:00Z"),
        new Date("2026-05-26T10:05:00Z"),
      ),
    );

    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats[0]!.unread).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  it("sorts chats with messages by latest message DESC, no-message chats last", async () => {
    const { service, matchRepo, chatRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(1), captainId: ME, startTime: FUTURE }));
    matchRepo.put(makeMatch({ id: M(2), captainId: ME, startTime: FUTURE }));
    matchRepo.put(makeMatch({ id: M(3), captainId: ME, startTime: FUTURE })); // no messages
    chatRepo.seed(msg(M(1), ME, new Date("2026-05-26T10:00:00Z"))); // older
    chatRepo.seed(msg(M(2), ME, new Date("2026-05-26T11:00:00Z"))); // newer

    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats.map((c) => c.match.id)).toEqual([M(2), M(1), M(3)]);
  });

  it("ranks any message chat above message-less chats, then sorts the rest by start_time ASC", async () => {
    const { service, matchRepo, chatRepo } = makeService();
    // Past match WITH a message — must rank first despite being in the past.
    matchRepo.put(makeMatch({ id: M(1), captainId: ME, startTime: PAST }));
    chatRepo.seed(msg(M(1), ME, new Date("2026-05-25T10:00:00Z")));
    // Two message-less matches — ASC by start_time among themselves.
    matchRepo.put(makeMatch({ id: M(2), captainId: ME, startTime: FUTURE }));
    matchRepo.put(makeMatch({ id: M(3), captainId: ME, startTime: EARLIER_PAST }));

    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats.map((c) => c.match.id)).toEqual([M(1), M(3), M(2)]);
  });

  it("does not double-count a match the user both captains and (impossibly) has a JR on", async () => {
    // Defensive: captainMatches + accepted are unioned by excluding captain
    // ids from the accepted set. A stray accepted JR on an own match must not
    // duplicate the card.
    const { service, matchRepo, joinRepo } = makeService();
    matchRepo.put(makeMatch({ id: M(1), captainId: ME, startTime: FUTURE }));
    joinRepo.seed({ matchId: M(1), userId: ME, status: "accepted" });

    const page = await service.execute({ userId: ME }, NOW);
    expect(page.chats).toHaveLength(1);
    expect(page.chats[0]!.match.id).toBe(M(1));
  });
});
