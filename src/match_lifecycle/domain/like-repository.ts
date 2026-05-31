/**
 * MODULE: match_lifecycle.domain.like-repository
 * PURPOSE: Port for the post-match "Like a teammate" aggregate (Layer 6.X).
 *          Composite-key value object `(matchId, giverId, receiverId)` — no
 *          separate id, no entity file (mirrors `Watch`, which is also a
 *          composite-key flag with no `watch.ts`). Surfaces:
 *            · `insertIfAbsent` — idempotent INSERT ON CONFLICT DO NOTHING
 *              under the advisory lock (POST /matches/:id/likes).
 *            · `countsByMatch` — per-receiver like totals for the Lineup
 *              "👍 N" display + the Like modal counters (unlocked read,
 *              rides the match-state poll).
 *            · `listReceiverIdsLikedByGiver` — receiver ids the viewer has
 *              already liked on a match; drives `liked_by_viewer` per roster
 *              member, the modal's "already liked" state, and the auto-open
 *              decision (giver has liked nobody ⇒ length 0).
 *            · `filterMatchIdsWithLikeFromGiver` — of a candidate set, the
 *              match ids where the giver has placed ≥1 like; the /my-matches
 *              Likes-reminder is `candidates − this`.
 * LAYER: domain
 * DEPENDENCIES: ./match, src/auth/domain/user, src/shared/db/types
 * CONSUMED BY: src/match_lifecycle/application/{like-teammate,match-state,
 *              list-my-matches}-service,
 *              src/match_lifecycle/infrastructure/prisma-like-repository
 * INVARIANTS:
 *   - `insertIfAbsent` is idempotent — an existing row counts as success
 *     (`existed`); the service maps both branches to `200 OK` (spec §600).
 *   - Likes are irreversible: the port has NO delete method by design.
 *   - All reads lead with `matchId` (or `matchId`+`giverId`), covered by the
 *     composite PK — no secondary index exists or is needed.
 *   - Spec: match.md → "Post-match likes", "Per-endpoint checklist" → POST
 *     /matches/:id/likes, "Race & idempotency" → Like rows.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Post-match likes"
 *   - docs/spec/pitchup-spec-personal.md → "Likes reminder section"
 *   - ADR-0003
 */
import type { UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import type { MatchId } from "./match";

export type LikeInsertOutcome = "inserted" | "existed";

/** Per-receiver like total for a single match. */
export interface LikeReceiverCount {
  readonly receiverId: UserId;
  readonly count: number;
}

export interface LikeRepository {
  /**
   * INSERT ON CONFLICT DO NOTHING under the advisory lock. Returns
   * `inserted` on a fresh row, `existed` when the `(match, giver, receiver)`
   * triple was already present (idempotent re-tap / double submit). The
   * service exposes both as `200 OK`.
   */
  insertIfAbsent(
    matchId: MatchId,
    giverId: UserId,
    receiverId: UserId,
    tx: TransactionClient,
  ): Promise<LikeInsertOutcome>;

  /**
   * Per-receiver like totals for the match. Unlocked read — rides the
   * match-state poll (every 15s). Receivers with zero likes are omitted;
   * the caller defaults missing ids to 0.
   */
  countsByMatch(matchId: MatchId): Promise<readonly LikeReceiverCount[]>;

  /**
   * Receiver ids the given giver has already liked on the match. Unlocked
   * read. Used to mark `liked_by_viewer` per roster member, to render the
   * modal's "Liked ✓" state, and (via `length === 0`) to decide the modal
   * auto-open on the first Ended visit.
   */
  listReceiverIdsLikedByGiver(
    matchId: MatchId,
    giverId: UserId,
  ): Promise<readonly UserId[]>;

  /**
   * Of `candidateMatchIds`, the subset where the giver has placed at least
   * one like. The /my-matches Likes-reminder is `candidateMatchIds` minus
   * this set. Empty input short-circuits to `[]`. Unlocked read.
   */
  filterMatchIdsWithLikeFromGiver(
    giverId: UserId,
    candidateMatchIds: readonly MatchId[],
  ): Promise<readonly MatchId[]>;
}
