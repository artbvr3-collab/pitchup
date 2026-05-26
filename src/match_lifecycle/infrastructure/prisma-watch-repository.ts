/**
 * MODULE: match_lifecycle.infrastructure.prisma-watch-repository
 * PURPOSE: Prisma adapter for `WatchRepository`. One method in Layer 4:
 *          idempotent delete of a `(match, user)` Watch row inside an
 *          advisory-locked transaction.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/match_lifecycle/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `deleteMany` is used over `delete` to keep the operation idempotent
 *     (no error when zero rows match).
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Watching logic"
 */
import type { UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import type { MatchId } from "../domain/match";
import type { WatchRepository } from "../domain/watch-repository";

export class PrismaWatchRepository implements WatchRepository {
  async deleteForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.watch.deleteMany({ where: { matchId, userId } });
  }
}
