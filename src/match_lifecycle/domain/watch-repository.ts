/**
 * MODULE: match_lifecycle.domain.watch-repository
 * PURPOSE: Port for "Notify me when a spot opens" subscriptions. Layer 4
 *          uses ONE method — idempotent delete inside the Join/Approve
 *          transactions, per spec: a successful Join wipes the user's Watch
 *          for that match in the same tx; Approve does the same as a safety
 *          (the user may have raced a Watch in just before approve).
 *          INSERT + isFull check live in the `POST /watch` endpoint, which
 *          lands in a later layer. The port grows then; do not pre-add
 *          methods we don't yet call.
 * LAYER: domain
 * DEPENDENCIES: ./match, src/auth/domain/user, src/shared/db/types
 * CONSUMED BY: src/match_lifecycle/application/{join,approve}-*-service,
 *              src/match_lifecycle/infrastructure/prisma-watch-repository
 * INVARIANTS:
 *   - `deleteForUserAndMatch` is idempotent: deleting a non-existent row is a
 *     no-op. Composite PK (match_id, user_id) makes this safe.
 *   - Spec: match.md → "Watching logic" → "What happens to the Watch record
 *     on Join", and Per-endpoint checklist → POST /approve (DELETE watch
 *     same tx).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Watching logic", "Per-endpoint checklist"
 *   - ADR-0003
 */
import type { UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import type { MatchId } from "./match";

export interface WatchRepository {
  /** Idempotent. No error if no row exists. */
  deleteForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
    tx: TransactionClient,
  ): Promise<void>;
}
