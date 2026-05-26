/**
 * MODULE: match_lifecycle.application.join-match-service
 * PURPOSE: Use case — player submits a join request to a match. Implements
 *          the per-endpoint checklist for `POST /api/matches/:id/join`:
 *          re-read match under advisory lock → status / start_time / captain
 *          checks → UPSERT JoinRequest to pending → DELETE Watch for
 *          (user, match) in the same tx.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository, WatchRepository
 *                       + withMatchLock helper
 * CONSUMED BY: app/api/matches/[id]/join/route.ts
 * INVARIANTS:
 *   - Critical section runs inside `withMatchLock(matchId)` — every check
 *     and write below operates on the locked `tx` client.
 *   - Pending creation does NOT consult `free`. Spec global.md: "Join API
 *     does NOT check free" — pending may legitimately be submitted on a
 *     full match (watching race / hopeful captain-raise / direct curl).
 *     Hard cap fires on Approve, never on Join.
 *   - On `revived` (re-apply after rejected/cancelled/left/kicked):
 *     `auto_reason` is reset to NULL, message + guest_count overwritten.
 *     Spec match.md: "Player match states", "Reject / Kick / Leave flows".
 *   - Watch row for (user, match) is removed in the same transaction
 *     (spec match.md → "Watching logic → What happens to the Watch record
 *     on Join"). Idempotent delete — fine even if no watch existed.
 *   - Captain cannot Join their own match → 400 captain_cannot_join
 *     (defence in depth — the UI also hides the button).
 * TODO(Layer 7 — Notifications):
 *   - Spec match.md does NOT prescribe an in-app notification for the
 *     captain on a new pending request ("the captain does not receive a
 *     push/email on each new request" — Reject/Kick/Leave flows section).
 *     No notification insertion is required in this service.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Join flow", "Per-endpoint
 *     checklist" → POST /join, "Player match states"
 *   - docs/spec/pitchup-spec-global.md → "Total spots — hard cap on approve"
 *     ("Join API does NOT check free")
 */
import { asUserId, type UserId } from "@/src/auth/domain/user";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  AlreadyInMatchError,
  AlreadyRequestedError,
  CaptainCannotJoinError,
  MatchLockedError,
  MatchNotFoundError,
} from "../domain/errors";
import {
  asJoinRequestId,
  type JoinRequest,
  type JoinRequestId,
} from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId, type MatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type { WatchRepository } from "../domain/watch-repository";
import type { JoinMatchInput } from "./dto/join-match-input";

export interface JoinMatchResult {
  readonly requestId: JoinRequestId;
  readonly outcome: "created" | "revived";
}

export class JoinMatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
  ) {}

  async execute(input: JoinMatchInput, now: Date): Promise<JoinMatchResult> {
    const matchId = asMatchId(input.matchId);
    const userId = asUserId(input.userId);
    const guestCount = input.guestCount;
    const message = normalizeMessage(input.message);

    return withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      // 1. Captain cannot Join their own match (backstop; UI hides button).
      if (match.captainId === userId) {
        throw new CaptainCannotJoinError({ matchId, userId });
      }

      // 2. Match must be live. Computed on-read from start_time / duration /
      //    cancelled_at. `acceptedSlots` only affects open/almostFull/full —
      //    all three collapse to "live" for Join (spec global.md: "Join API
      //    does NOT check free"). Pending on a full match is legitimate.
      const accepted = await this.joinRequestRepository.listAcceptedForMatch(
        matchId,
        tx,
      );
      const acceptedSlots = sumAcceptedSlots(accepted);
      const slots = computeSlots(match, acceptedSlots);
      const status = deriveMatchStatus(match, slots, now);
      if (status !== "open" && status !== "almostFull" && status !== "full") {
        throw new MatchLockedError({ matchId, status });
      }

      // 3. UPSERT to pending. Conflict on {pending, accepted} mapped to the
      //    matching domain error.
      const upsert = await this.joinRequestRepository.upsertToPending(
        { matchId, userId, guestCount, message },
        tx,
      );
      if (upsert.outcome === "conflict") {
        if (upsert.existingStatus === "pending") {
          throw new AlreadyRequestedError({ matchId, userId });
        }
        throw new AlreadyInMatchError({ matchId, userId });
      }

      // 4. Same-tx DELETE Watch (idempotent). Spec: "What happens to the
      //    Watch record on Join".
      await this.watchRepository.deleteForUserAndMatch(matchId, userId, tx);

      return {
        requestId: asJoinRequestId(upsert.row.id),
        outcome: upsert.outcome === "inserted" ? "created" : "revived",
      };
    });
  }
}

function sumAcceptedSlots(requests: readonly JoinRequest[]): number {
  let total = 0;
  for (const r of requests) total += 1 + r.guestCount;
  return total;
}

function normalizeMessage(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Re-export type alias to keep MatchId path symmetrical with other services.
export type { MatchId, UserId };
