/**
 * MODULE: shared.db.with-match-lock
 * PURPOSE: Open a Prisma transaction that takes a Postgres advisory lock keyed
 *          by match id. Every match-mutating use case wraps its critical
 *          section in this helper so concurrent mutations on the same match
 *          are serialized while different matches still run in parallel.
 * LAYER: shared / infrastructure
 * DEPENDENCIES: ./prisma, @prisma/client (Prisma.sql tagged template)
 * CONSUMED BY: src/match_lifecycle/application/{join,approve,reject}-*-service
 *              (Layer 4); future leave/kick/cancel/edit/watch services.
 * INVARIANTS:
 *   - Lock key = hashtextextended('match:' || matchId, 0). Same formula across
 *     every endpoint, no per-call drift — see spec match.md "Advisory lock
 *     strategy".
 *   - Lock is `xact_lock`: released automatically on COMMIT / ROLLBACK; no
 *     unlock call here.
 *   - One advisory lock per transaction. No nesting, no second key — keeps
 *     deadlock impossible by construction.
 *   - Default isolation (READ COMMITTED) — under advisory lock all reads are
 *     consistent for the single match owned by this transaction.
 *   - `work(tx)` MUST use the `tx` client for any read/write that needs to
 *     see locked state. Falling back to the un-locked singleton client
 *     defeats the lock.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Concurrency & locking"
 *   - docs/ARCHITECTURE.md §8 (Persistence — advisory locks)
 *   - ADR-0003 (Repository ports + Prisma adapters)
 */
import { Prisma } from "@prisma/client";

import { prisma } from "./prisma";
import type { TransactionClient } from "./types";

export async function withMatchLock<T>(
  matchId: string,
  work: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  const lockKey = `match:${matchId}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
    return work(tx);
  });
}
