/**
 * MODULE: match_lifecycle.domain.watch-repository
 * PURPOSE: Port for "Notify me when a spot opens" subscriptions.
 *          - Layer 4: idempotent delete inside the Join/Approve transactions
 *            (a successful Join wipes the user's Watch for that match in the
 *            same tx; Approve does the same as a safety against a Watch race).
 *          - Layer 5: read-only `countForMatch` for the polling lineup
 *            snapshot — surfaces `watching_count` to all viewers (spec
 *            match.md "Tab Lineup → watching counter").
 *          INSERT + isFull check live in `POST /watch`, which lands in a
 *          later layer. The port grows when those methods are first called;
 *          do not pre-add methods we don't yet use.
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

  /**
   * Count of Watch rows for the given match. Unlocked read — used by the
   * polling state assembler to surface `watching_count`. Captain-facing UI
   * shows the number on the lineup tab; non-captain UI hides it. The poll
   * payload includes the count for everyone (cheap to send).
   */
  countForMatch(matchId: MatchId): Promise<number>;

  /**
   * True if the (match, user) pair has a Watch row. Used by the RSC
   * page-load path to derive the viewer's role (`watching` vs `none`).
   * Unlocked — viewer-role drives UI only; the Join transaction takes
   * the canonical lock and re-checks.
   */
  existsForUserAndMatch(matchId: MatchId, userId: UserId): Promise<boolean>;
}
