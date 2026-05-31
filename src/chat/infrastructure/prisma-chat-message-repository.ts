/**
 * MODULE: chat.infrastructure.prisma-chat-message-repository
 * PURPOSE: Prisma adapter for `ChatMessageRepository`. No advisory lock —
 *          chat writes are the deliberate exception (spec match.md §546);
 *          the adapter operates directly on the singleton client.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/chat/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `softDelete` reads-then-writes: if `deleted_at` is already non-null
 *     it returns the existing row without an UPDATE (preserves the original
 *     timestamp so the captain's first delete is the canonical one).
 *   - `listForFeed` ordering is `created_at ASC` so the polling frontend can
 *     merge by id without resorting; `deleted_at` rows ARE included (the UI
 *     renders a tombstone in place — spec match.md §225 captain moderation).
 *   - `listForFeed` `since` predicate is `(created_at > $since) OR
 *     (deleted_at IS NOT NULL AND deleted_at > $since)` — see the port
 *     contract; surfaces deletes that happen after the message was already
 *     in the client's local state.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Tab Chat", §195, §225
 */
import type { ChatMessage as ChatMessageRow, PrismaClient } from "@prisma/client";

import { asUserId } from "@/src/auth/domain/user";
import { asMatchId } from "@/src/match_lifecycle/domain/match";

import type { UserId } from "@/src/auth/domain/user";
import type { MatchId } from "@/src/match_lifecycle/domain/match";

import {
  asChatMessageId,
  type ChatMessage,
  type ChatMessageId,
} from "../domain/chat-message";
import type {
  ChatActivity,
  ChatMessageRepository,
  InsertChatMessageInput,
  ListChatMessagesForFeedOptions,
} from "../domain/chat-message-repository";

export class PrismaChatMessageRepository implements ChatMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(input: InsertChatMessageInput): Promise<ChatMessage> {
    const row = await this.prisma.chatMessage.create({
      data: {
        matchId: input.matchId,
        authorId: input.authorId,
        text: input.text,
      },
    });
    return toDomain(row);
  }

  async findById(id: ChatMessageId): Promise<ChatMessage | null> {
    const row = await this.prisma.chatMessage.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async softDelete(id: ChatMessageId, now: Date): Promise<ChatMessage> {
    const existing = await this.prisma.chatMessage.findUnique({ where: { id } });
    // Caller (service) has already verified existence + captain authority.
    // softDelete is invariant-idempotent at the port level, so if we somehow
    // race a missing id here we return a synthesised null-like via throw —
    // the service path always pre-checks. In practice the row exists.
    if (!existing) throw new Error("softDelete: row vanished mid-call");
    if (existing.deletedAt !== null) return toDomain(existing);

    const updated = await this.prisma.chatMessage.update({
      where: { id },
      data: { deletedAt: now },
    });
    return toDomain(updated);
  }

  async listForFeed(
    options: ListChatMessagesForFeedOptions,
  ): Promise<readonly ChatMessage[]> {
    const where =
      options.since === null
        ? { matchId: options.matchId }
        : {
            matchId: options.matchId,
            OR: [
              { createdAt: { gt: options.since } },
              { deletedAt: { gt: options.since } },
            ],
          };
    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: options.limit,
    });
    return rows.map(toDomain);
  }

  async activityByMatches(
    userId: UserId,
    matchIds: readonly MatchId[],
  ): Promise<Map<MatchId, ChatActivity>> {
    if (matchIds.length === 0) return new Map();
    const ids = matchIds as readonly string[] as string[];

    // Two grouped MAX(created_at) probes, run in parallel: one over every
    // non-deleted message (drives the sort), one excluding the viewer's own
    // (drives the unread dot). Cheaper + simpler than a raw FILTER aggregate
    // and stays within the Prisma client typing.
    const [allAgg, foreignAgg] = await Promise.all([
      this.prisma.chatMessage.groupBy({
        by: ["matchId"],
        where: { matchId: { in: ids }, deletedAt: null },
        _max: { createdAt: true },
      }),
      this.prisma.chatMessage.groupBy({
        by: ["matchId"],
        where: { matchId: { in: ids }, deletedAt: null, authorId: { not: userId } },
        _max: { createdAt: true },
      }),
    ]);

    const foreignByMatch = new Map<string, Date>();
    for (const row of foreignAgg) {
      if (row._max.createdAt) foreignByMatch.set(row.matchId, row._max.createdAt);
    }

    const out = new Map<MatchId, ChatActivity>();
    for (const row of allAgg) {
      if (!row._max.createdAt) continue;
      out.set(asMatchId(row.matchId), {
        lastAt: row._max.createdAt,
        lastForeignAt: foreignByMatch.get(row.matchId) ?? null,
      });
    }
    return out;
  }
}

function toDomain(row: ChatMessageRow): ChatMessage {
  return {
    id: asChatMessageId(row.id),
    matchId: asMatchId(row.matchId),
    authorId: asUserId(row.authorId),
    text: row.text,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}
