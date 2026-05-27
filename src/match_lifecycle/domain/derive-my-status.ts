/**
 * MODULE: match_lifecycle.domain.derive-my-status
 * PURPOSE: Pure derivation of the `my_status` enum from the user's relationship
 *          to a match. Source of truth: spec global.md → "Polling sync" →
 *          "`my_status` — UI-derived, not equal to `JoinRequest.status`" table.
 *          `my_status` is NOT a DB column — it's a UI-state enum surfaced in
 *          the global polling payload (`matches_changed[]`) and used by
 *          `/my-matches` SSR to bucket cards into Captain / Upcoming / Past.
 * LAYER: domain (pure)
 * DEPENDENCIES: ./join-request (JoinRequestStatus only — type-only import)
 * CONSUMED BY: src/match_lifecycle/application/list-my-matches-service.ts,
 *              tests/match_lifecycle/domain/derive-my-status.test.ts,
 *              future Layer 7 polling-state assembler for `matches_changed`.
 * INVARIANTS:
 *   - The order of branches matters — `accepted + cancelledAt` collapses to
 *     `cancelled` before plain `accepted`, etc. Same precedence as the spec
 *     table. The function never throws; an unrecognized input maps to `none`.
 *   - `declined` collapses three different `auto_reason` values (NULL =
 *     captain-reject, `match_started` = cron, `match_cancelled` = mass-reject).
 *     The wording difference lives in `notification.body`, not here.
 *   - `watching` requires that the user is NOT in `pending` / `accepted` —
 *     pending + watching mutual exclusion is enforced at write time
 *     (Join service DELETEs Watch in same tx, POST /watch rejects active JR),
 *     but the derivation must still gate to avoid surfacing a stale Watch row
 *     during a brief race window.
 *   - Terminal join-request statuses `left` / `kicked` / `cancelled` (user
 *     self-cancel of own pending) collapse to `none` for the CTA / Section
 *     Upcoming purpose; Section Past on `/my-matches` reads
 *     `JoinRequest.status` directly to render sub-labels ("You left" /
 *     "You were removed" / "You cancelled your request") — that mapping does
 *     NOT go through this function.
 *   - `kicked` as a `MyStatus` value is exposed ONLY by the Layer 7 polling
 *     payload (signal to play the Upcoming → Past card animation). The
 *     on-read derivation here returns `none` for `kicked`, exactly like the
 *     spec note in global.md.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Polling sync" → `my_status` mapping
 *   - docs/spec/pitchup-spec-personal.md → "/my-matches" → Section Past
 *     sub-label table (reads `JoinRequest.status` directly, NOT `my_status`)
 */
import type { JoinRequestStatus } from "./join-request";

/**
 * UI-derived state of the (user, match) pair. NOT equal to
 * `JoinRequest.status`. The list is closed — adding a value MUST be mirrored
 * in the spec table and the Layer 7 polling payload Zod schema.
 *
 * `kicked` is documented for symmetry with the spec payload table but is NOT
 * a value `deriveMyStatus` ever returns on-read (see invariant above).
 */
export type MyStatus =
  | "accepted"
  | "pending"
  | "declined"
  | "cancelled"
  | "watching"
  | "none";

export interface DeriveMyStatusInput {
  /** `null` if no JoinRequest row exists for this (match, user) pair. */
  readonly joinRequestStatus: JoinRequestStatus | null;
  /** `true` if a Watch row exists for this (match, user) pair. */
  readonly hasWatchRecord: boolean;
  /**
   * `match.cancelled_at` — non-null hoists accepted → `cancelled` (spec
   * note: "JoinRequest.status does not change on match cancel; accepted
   * stays accepted; `cancelled` is derived from the match flag").
   */
  readonly matchCancelledAt: Date | null;
}

export function deriveMyStatus(input: DeriveMyStatusInput): MyStatus {
  const { joinRequestStatus, hasWatchRecord, matchCancelledAt } = input;

  // 1. accepted + cancelled match → `cancelled`. Must come BEFORE plain
  //    `accepted` — same JoinRequest.status, different UI bucket.
  if (joinRequestStatus === "accepted" && matchCancelledAt !== null) {
    return "cancelled";
  }

  // 2. accepted on a live match → `accepted`.
  if (joinRequestStatus === "accepted") return "accepted";

  // 3. pending → `pending`.
  if (joinRequestStatus === "pending") return "pending";

  // 4. rejected (any auto_reason) → `declined`.
  if (joinRequestStatus === "rejected") return "declined";

  // 5. watching is gated on no active JoinRequest. Terminal statuses (left /
  //    kicked / cancelled self) and the no-row case all fall through here.
  //    pending/accepted were handled above, so reaching this point means JR is
  //    null OR one of {rejected, left, kicked, cancelled} — but `rejected`
  //    already returned `declined`, so the remaining set is {null, left,
  //    kicked, cancelled}. For all of those Watch upgrades to `watching`.
  if (hasWatchRecord) return "watching";

  // 6. `left` / `kicked` / `cancelled` (self-cancel pending) / no-row →
  //    `none`. Re-apply via UPSERT puts them back to `pending` next time.
  return "none";
}
