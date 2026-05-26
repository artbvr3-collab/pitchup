/**
 * MODULE: match_lifecycle.domain.join-request
 * PURPOSE: JoinRequest entity — persistence-shape, no behavior. State
 *          transitions live in application services (under advisory lock).
 * LAYER: domain
 * DEPENDENCIES: ./match (MatchId), src/auth/domain/user (UserId)
 * CONSUMED BY: src/match_lifecycle/domain/join-request-repository.ts,
 *              src/match_lifecycle/application/*, infrastructure adapters.
 * INVARIANTS:
 *   - One row per (match_id, user_id) pair — UNIQUE in the schema. Re-apply
 *     after rejected/cancelled/left/kicked is UPDATE → pending, NOT a new
 *     INSERT. Enforced by `upsertToPending` in the repository.
 *   - `guestCount ∈ [0, 4]` (validated at the API boundary; the DB allows
 *     0..4 by convention only — no CHECK constraint).
 *   - Only `status ∈ {pending, accepted}` counts as "active" for `(user, match)`
 *     conflict checks. The other four are terminal-but-replaceable.
 *   - `autoReason` is non-null only when the system rejected: `match_started`
 *     (cron) or `match_cancelled` (mass-reject). Captain reject → NULL.
 *   - `accepted` is the ONLY status that occupies slot(s) — 1 + guestCount.
 *     Spec: global.md → "Slot math".
 * RELATED DOCS:
 *   - docs/spec/pitchup-app-map.md → "JoinRequest"
 *   - docs/spec/pitchup-spec-match.md → "Player match states",
 *     "Per-endpoint checklist", "Reject / Kick / Leave flows"
 *   - docs/spec/pitchup-spec-global.md → "Guests (+N on join)"
 */
import type { UserId } from "@/src/auth/domain/user";

import type { MatchId } from "./match";

declare const joinRequestIdBrand: unique symbol;
export type JoinRequestId = string & { readonly [joinRequestIdBrand]: void };

export const asJoinRequestId = (value: string): JoinRequestId =>
  value as JoinRequestId;

export type JoinRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "left"
  | "kicked";

export type JoinRequestAutoReason = "match_started" | "match_cancelled" | null;

export interface JoinRequest {
  readonly id: JoinRequestId;
  readonly matchId: MatchId;
  readonly userId: UserId;
  readonly status: JoinRequestStatus;
  readonly guestCount: number;
  readonly message: string | null;
  readonly autoReason: JoinRequestAutoReason;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Statuses that are "active" for the same (match, user) pair — a Join attempt
 * against them is a conflict, not a re-apply. The complementary set is
 * `pending` / `accepted` excluded → `rejected` / `cancelled` / `left` /
 * `kicked` can be UPSERT-updated back to pending.
 */
export const ACTIVE_JOIN_REQUEST_STATUSES: readonly JoinRequestStatus[] = [
  "pending",
  "accepted",
];

/** Statuses the UPSERT path overwrites back to `pending`. */
export const RESETTABLE_JOIN_REQUEST_STATUSES: readonly JoinRequestStatus[] = [
  "rejected",
  "cancelled",
  "left",
  "kicked",
];
