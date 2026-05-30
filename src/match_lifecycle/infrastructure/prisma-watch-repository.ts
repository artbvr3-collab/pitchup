/**
 * MODULE: match_lifecycle.infrastructure.prisma-watch-repository
 * PURPOSE: Prisma adapter for `WatchRepository`.
 *          - Layer 4: idempotent delete of a `(match, user)` Watch row
 *            inside an advisory-locked transaction.
 *          - Layer 5: `countForMatch` / `existsForUserAndMatch` — unlocked
 *            reads for the polling state assembler and RSC viewer-role.
 *          - Layer 6: `upsertForUserAndMatch` (idempotent INSERT) +
 *            `listForMatch` / `deleteAllForMatch` (notify-watching fan-out)
 *            + `listMatchIdsForUser` (/my-matches Section Upcoming).
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/match_lifecycle/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `deleteMany` is used over `delete` to keep `deleteForUserAndMatch`
 *     idempotent (no error when zero rows match).
 *   - `upsertForUserAndMatch` is also idempotent — we read first and
 *     INSERT only on absence. The surrounding advisory lock guarantees no
 *     other writer races within the same match, so SELECT-then-INSERT is
 *     safe (same shape `PrismaJoinRequestRepository.upsertToPending` uses).
 *   - `listMatchIdsForUser` returns only the join key; rendering uses
 *     `MatchRepository.findByIds` to batch-load full match rows. Keeps
 *     Watch reads narrow.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Watching logic", "Tab Lineup"
 */
import type { PrismaClient } from "@prisma/client";

import { asUserId, type UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import { asMatchId, type MatchId } from "../domain/match";
import type {
  UpsertWatchOutcome,
  WatchRepository,
} from "../domain/watch-repository";

export class PrismaWatchRepository implements WatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async deleteForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.watch.deleteMany({ where: { matchId, userId } });
  }

  async countForMatch(matchId: MatchId): Promise<number> {
    return this.prisma.watch.count({ where: { matchId } });
  }

  async existsForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
  ): Promise<boolean> {
    const row = await this.prisma.watch.findUnique({
      where: { matchId_userId: { matchId, userId } },
      select: { matchId: true },
    });
    return row !== null;
  }

  async upsertForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
    tx: TransactionClient,
  ): Promise<UpsertWatchOutcome> {
    const existing = await tx.watch.findUnique({
      where: { matchId_userId: { matchId, userId } },
      select: { matchId: true },
    });
    if (existing) return "existed";
    await tx.watch.create({ data: { matchId, userId } });
    return "inserted";
  }

  async listForMatch(
    matchId: MatchId,
    tx: TransactionClient,
  ): Promise<readonly UserId[]> {
    const rows = await tx.watch.findMany({
      where: { matchId },
      select: { userId: true },
    });
    return rows.map((r) => asUserId(r.userId));
  }

  async deleteAllForMatch(
    matchId: MatchId,
    tx: TransactionClient,
  ): Promise<number> {
    const result = await tx.watch.deleteMany({ where: { matchId } });
    return result.count;
  }

  async listMatchIdsForUser(userId: UserId): Promise<readonly MatchId[]> {
    const rows = await this.prisma.watch.findMany({
      where: { userId },
      select: { matchId: true },
    });
    return rows.map((r) => asMatchId(r.matchId));
  }

  async deleteForMatchesStartingBefore(beforeStartTime: Date): Promise<number> {
    const res = await this.prisma.watch.deleteMany({
      where: { match: { startTime: { lt: beforeStartTime } } },
    });
    return res.count;
  }
}
