/**
 * MODULE: match_lifecycle.domain.join-request-repository
 * PURPOSE: Port for JoinRequest persistence. Write methods + the reads they
 *          depend on accept a `TransactionClient` (Layer 4 — locked critical
 *          sections in join / approve / reject). Read methods are also
 *          callable WITHOUT a `tx` — Layer 5 chat role gating and the
 *          polling state assembler need unlocked snapshots. Same one-method-
 *          with-optional-tx convention as `MatchRepository.findById(id, tx?)`
 *          — see AGENTS gotchas.
 * LAYER: domain
 * DEPENDENCIES: ./join-request, ./match, src/auth/domain/user, src/shared/db/types
 * CONSUMED BY: src/match_lifecycle/application/{join,approve,reject}-*-service,
 *              src/match_lifecycle/infrastructure/prisma-join-request-repository
 * INVARIANTS:
 *   - `upsertToPending` is the SINGLE entry point that may create or revive a
 *     pending JoinRequest. It returns a discriminated result so the service
 *     can map status `{pending, accepted}` collisions to distinct domain
 *     errors without the adapter throwing.
 *   - `updateStatus` is unconditional UPDATE; the service is responsible for
 *     checking the current status under lock before calling.
 *   - `listAcceptedForMatch` returns rows with `status = 'accepted'` only —
 *     used by hard-cap computation in Approve. Pending is NOT included
 *     (spec: pending does not occupy a slot).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist" → POST /join,
 *     POST /approve, POST /reject
 *   - docs/spec/pitchup-spec-global.md → "Total spots — hard cap on approve"
 *   - ADR-0003
 */
import type { UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import type {
  JoinRequest,
  JoinRequestId,
  JoinRequestStatus,
} from "./join-request";
import type { MatchId } from "./match";

export interface UpsertToPendingInput {
  readonly matchId: MatchId;
  readonly userId: UserId;
  readonly guestCount: number;
  readonly message: string | null;
}

/**
 * Discriminated outcome of an UPSERT attempt. The repository never throws on
 * a status conflict — it reports the existing status and lets the service
 * choose the matching domain error (AlreadyRequestedError /
 * AlreadyInMatchError) without coupling to Prisma error codes.
 */
export type UpsertToPendingResult =
  | { readonly outcome: "inserted"; readonly row: JoinRequest }
  | { readonly outcome: "revived"; readonly row: JoinRequest }
  | {
      readonly outcome: "conflict";
      readonly existingStatus: Extract<JoinRequestStatus, "pending" | "accepted">;
      readonly row: JoinRequest;
    };

export interface JoinRequestRepository {
  findByMatchAndUser(
    matchId: MatchId,
    userId: UserId,
    tx?: TransactionClient,
  ): Promise<JoinRequest | null>;

  findById(
    id: JoinRequestId,
    tx?: TransactionClient,
  ): Promise<JoinRequest | null>;

  /**
   * UPSERT under UNIQUE(match_id, user_id):
   *   - no row              → INSERT pending, auto_reason=NULL
   *   - rejected/cancelled/left/kicked → UPDATE → pending, auto_reason=NULL,
   *                           message + guest_count overwritten, updated_at=now
   *   - pending / accepted  → no write, returned as `conflict`
   */
  upsertToPending(
    input: UpsertToPendingInput,
    tx: TransactionClient,
  ): Promise<UpsertToPendingResult>;

  /**
   * Unconditional UPDATE. Caller (under lock) must have already verified the
   * current status is acceptable for the transition.
   */
  updateStatus(
    id: JoinRequestId,
    status: JoinRequestStatus,
    autoReason: "match_started" | "match_cancelled" | null,
    tx: TransactionClient,
  ): Promise<void>;

  /** Rows with `status = 'accepted'` for the given match. */
  listAcceptedForMatch(
    matchId: MatchId,
    tx?: TransactionClient,
  ): Promise<readonly JoinRequest[]>;

  /**
   * Rows with `status = 'pending'` for the given match. Layer 5 reads only —
   * surfaced to the captain via the polling payload and the captain sheet.
   * Non-captains receive `pending: []` per spec match.md §216.
   */
  listPendingForMatch(
    matchId: MatchId,
    tx?: TransactionClient,
  ): Promise<readonly JoinRequest[]>;
}
