/**
 * MODULE: match_lifecycle.application.unwatch-match-service
 * PURPOSE: Use case — user removes their "Notify me" subscription.
 *          Implements `DELETE /api/matches/:id/watch`: pure idempotent
 *          DELETE (spec match.md → "Per-endpoint checklist" → DELETE
 *          /watch: "no checks, always 200").
 * LAYER: application
 * DEPENDENCIES (ports): WatchRepository (only)
 * CONSUMED BY: app/api/matches/[id]/watch/route.ts (DELETE handler)
 * INVARIANTS:
 *   - **No advisory lock.** The spec's per-endpoint checklist explicitly
 *     marks this endpoint as idempotent with no checks. DELETE on a Watch
 *     row doesn't mutate slot / status / roster, doesn't trigger
 *     `notifyWatching`, and doesn't race with any other endpoint in a way
 *     a lock would resolve — the underlying SQL DELETE WHERE
 *     (match_id, user_id) is atomic at the row level and idempotent. A
 *     lock here would be theatre (mirror of the `POST /messages` exception
 *     in Layer 5; see AGENTS gotcha "Chat writes are the second no-lock
 *     exception" — Unwatch is the third).
 *   - The repository's `deleteForUserAndMatch` is idempotent (deleteMany
 *     under the hood) — zero rows is a normal outcome.
 *   - Pre-existing port methods require a `tx` for symmetry with the
 *     under-lock callers (Join, Approve, notifyWatching). To honour that
 *     contract without holding a real lock, we wrap the single DELETE in
 *     `prisma.$transaction` via the standalone helper — see implementation
 *     below. The transaction here is purely for the `tx` typing; it
 *     auto-commits after the DELETE.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → DELETE /watch
 *   - AGENTS.md → "Chat writes are the second no-lock exception" gotcha
 *     (Layer 5) — Unwatch extends the same no-lock convention to a
 *     third write endpoint.
 */
import { asUserId } from "@/src/auth/domain/user";
import { prisma } from "@/src/shared/db/prisma";

import { asMatchId } from "../domain/match";
import type { WatchRepository } from "../domain/watch-repository";

export interface UnwatchMatchInput {
  readonly matchId: string;
  readonly userId: string;
}

export interface UnwatchMatchResult {
  readonly status: "ok";
}

export class UnwatchMatchService {
  constructor(private readonly watchRepository: WatchRepository) {}

  async execute(input: UnwatchMatchInput): Promise<UnwatchMatchResult> {
    const matchId = asMatchId(input.matchId);
    const userId = asUserId(input.userId);

    // Trivial $transaction — only present to satisfy the port's `tx` param.
    // No advisory lock taken (spec exception, see file header).
    await prisma.$transaction(async (tx) => {
      await this.watchRepository.deleteForUserAndMatch(matchId, userId, tx);
    });

    return { status: "ok" as const };
  }
}
