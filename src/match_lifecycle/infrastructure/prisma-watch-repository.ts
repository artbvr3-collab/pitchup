/**
 * MODULE: match_lifecycle.infrastructure.prisma-watch-repository
 * PURPOSE: Prisma adapter for `WatchRepository`.
 *          - Layer 4: idempotent delete of a `(match, user)` Watch row
 *            inside an advisory-locked transaction.
 *          - Layer 5: `countForMatch` — unlocked read, used by the polling
 *            state assembler for the `watching_count` field. Falls back to
 *            the module-singleton `prisma` injected via the constructor.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/match_lifecycle/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `deleteMany` is used over `delete` to keep the operation idempotent
 *     (no error when zero rows match).
 *   - `countForMatch` uses Prisma's `count` (single SQL `SELECT COUNT(*)`),
 *     not a fetched array — list payloads are unbounded.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Watching logic", "Tab Lineup"
 */
import type { PrismaClient } from "@prisma/client";

import type { UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import type { MatchId } from "../domain/match";
import type { WatchRepository } from "../domain/watch-repository";

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
}
