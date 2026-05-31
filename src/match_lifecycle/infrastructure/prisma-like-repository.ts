/**
 * MODULE: match_lifecycle.infrastructure.prisma-like-repository
 * PURPOSE: Prisma adapter for `LikeRepository` (Layer 6.X post-match likes).
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/match_lifecycle/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `insertIfAbsent` uses `createMany({ skipDuplicates: true })` — a true
 *     INSERT … ON CONFLICT DO NOTHING. `count === 1` ⇒ inserted, `0` ⇒ the
 *     row already existed (idempotent). Runs on the advisory-locked `tx`.
 *   - `countsByMatch` uses Prisma `groupBy` on `receiverId`; receivers with
 *     no likes simply don't appear in the result.
 *   - `filterMatchIdsWithLikeFromGiver` uses `distinct` so each match id
 *     appears at most once regardless of how many receivers the giver liked.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Post-match likes"
 */
import type { PrismaClient } from "@prisma/client";

import { asUserId, type UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import { asMatchId, type MatchId } from "../domain/match";
import type {
  LikeInsertOutcome,
  LikeReceiverCount,
  LikeRepository,
} from "../domain/like-repository";

export class PrismaLikeRepository implements LikeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insertIfAbsent(
    matchId: MatchId,
    giverId: UserId,
    receiverId: UserId,
    tx: TransactionClient,
  ): Promise<LikeInsertOutcome> {
    const result = await tx.like.createMany({
      data: [{ matchId, giverId, receiverId }],
      skipDuplicates: true,
    });
    return result.count === 1 ? "inserted" : "existed";
  }

  async countsByMatch(matchId: MatchId): Promise<readonly LikeReceiverCount[]> {
    const rows = await this.prisma.like.groupBy({
      by: ["receiverId"],
      where: { matchId },
      _count: { receiverId: true },
    });
    return rows.map((r) => ({
      receiverId: asUserId(r.receiverId),
      count: r._count.receiverId,
    }));
  }

  async listReceiverIdsLikedByGiver(
    matchId: MatchId,
    giverId: UserId,
  ): Promise<readonly UserId[]> {
    const rows = await this.prisma.like.findMany({
      where: { matchId, giverId },
      select: { receiverId: true },
    });
    return rows.map((r) => asUserId(r.receiverId));
  }

  async filterMatchIdsWithLikeFromGiver(
    giverId: UserId,
    candidateMatchIds: readonly MatchId[],
  ): Promise<readonly MatchId[]> {
    if (candidateMatchIds.length === 0) return [];
    const rows = await this.prisma.like.findMany({
      where: { giverId, matchId: { in: [...candidateMatchIds] } },
      select: { matchId: true },
      distinct: ["matchId"],
    });
    return rows.map((r) => asMatchId(r.matchId));
  }
}
