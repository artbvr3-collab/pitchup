/**
 * MODULE: chat.infrastructure.prisma-chat-read-repository
 * PURPOSE: Prisma adapter for `ChatReadRepository`. Backs the `/chats` unread
 *          dot — one cursor row per (match, user), UPSERTed on Tab Chat open.
 *          No advisory lock (read-state, spec match.md §546 chat exception
 *          family).
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/chat/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `markRead` uses the composite-PK UPSERT (`matchId_userId`) so the first
 *     open inserts and every subsequent open advances `lastReadAt`.
 *   - `listLastReadForUser` reads only the requested (userId, matchIds) rows;
 *     missing rows are simply absent from the returned map.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/chats" → "Unread chat
 *               dots — data model"
 */
import type { PrismaClient } from "@prisma/client";

import type { UserId } from "@/src/auth/domain/user";
import { asMatchId, type MatchId } from "@/src/match_lifecycle/domain/match";

import type { ChatReadRepository } from "../domain/chat-read-repository";

export class PrismaChatReadRepository implements ChatReadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async markRead(
    matchId: MatchId,
    userId: UserId,
    lastReadAt: Date,
  ): Promise<void> {
    await this.prisma.chatRead.upsert({
      where: { matchId_userId: { matchId, userId } },
      create: { matchId, userId, lastReadAt },
      update: { lastReadAt },
    });
  }

  async listLastReadForUser(
    userId: UserId,
    matchIds: readonly MatchId[],
  ): Promise<Map<MatchId, Date>> {
    if (matchIds.length === 0) return new Map();
    const rows = await this.prisma.chatRead.findMany({
      where: { userId, matchId: { in: matchIds as readonly string[] as string[] } },
    });
    const out = new Map<MatchId, Date>();
    for (const row of rows) {
      out.set(asMatchId(row.matchId), row.lastReadAt);
    }
    return out;
  }
}
