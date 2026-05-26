/**
 * MODULE: match_lifecycle.application.match-state-service
 * PURPOSE: Read-model assembler for both the initial RSC page load on
 *          `/matches/:id` and the polling endpoint `GET /api/matches/:id/state`.
 *          Pure read — no advisory lock, no writes — gathers match + lineup +
 *          message-delta + status into the wire-shape DTO.
 *          Role gating (captain + accepted only for polling) lives in the
 *          route handler, NOT here, so the RSC can call the same assembler
 *          for a guest's initial view (lineup is publicly visible).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository.findById,
 *                       JoinRequestRepository.listAcceptedForMatch /
 *                       listPendingForMatch / findByMatchAndUser,
 *                       WatchRepository.countForMatch,
 *                       ChatMessageRepository.listForFeed,
 *                       UserRepository.findByIds
 * CONSUMED BY: app/api/matches/[id]/state/route.ts,
 *              app/matches/[id]/page.tsx (RSC initial snapshot)
 * INVARIANTS:
 *   - `pending` list is populated only when `viewerId === match.captainId`.
 *     Other viewers get `pending: []` per spec match.md §216 — non-captains
 *     should not see private roster coordination.
 *   - `messages` is a delta when `since !== null`, full history (capped at
 *     `MESSAGE_FETCH_LIMIT`) when `since === null`. The "since" branch
 *     includes soft-deletes whose `deleted_at > since` even if the original
 *     message predates `since` — surfaces deletes that happen while the
 *     client already has the message locally (port contract).
 *   - User resolution batches all ids (captain + accepted users + pending
 *     users + message authors) into a single `findByIds` call. Banned /
 *     deleted users are returned by the repo; the wire layer surfaces
 *     `banned: true` and the UI collapses to `[Removed user]`.
 *   - `updated_at` is the match row's own `updatedAt` — the spec uses this
 *     for optimistic concurrency on `PATCH /matches/:id`. The polling
 *     channel surfaces it so the client always carries the latest token.
 *   - This service does NOT do role-based 403. The route handler enforces
 *     "polling membership" (captain + accepted) by inspecting the same
 *     join-request row this service already fetches — the route reuses
 *     `joinRequestRepository.findByMatchAndUser` against the viewer id.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Polling for match state" (§195-212),
 *     §213-216 (chat access by role), "Tab Lineup", "Tab Chat"
 *   - docs/spec/pitchup-spec-global.md → "Polling sync"
 */
import type { User, UserId } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";

import type { ChatMessage } from "@/src/chat/domain/chat-message";
import type { ChatMessageRepository } from "@/src/chat/domain/chat-message-repository";

import { MatchNotFoundError } from "../domain/errors";
import type { JoinRequest } from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId, type MatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type { WatchRepository } from "../domain/watch-repository";
import {
  toWireStatus,
  type MatchStateLineupPending,
  type MatchStateLineupPlayer,
  type MatchStateMessage,
  type MatchStateMessageAuthor,
  type MatchStateResponse,
} from "./dto/match-state";

/**
 * Hard cap on the messages page returned by `listForFeed`. The full-history
 * branch (since=null) caps the initial page; the delta branch is far below
 * this in practice but we pass the same value to keep the port simple.
 * The spec defers pagination beyond v1 — when the cap matters, that's the
 * trigger to implement a separate "load older" endpoint.
 */
export const MESSAGE_FETCH_LIMIT = 200;

export interface MatchStateInput {
  readonly matchId: string;
  /** `null` when an unauthenticated guest hits the RSC. */
  readonly viewerId: string | null;
  /** `null` ⇒ full history, otherwise delta-since. */
  readonly since: Date | null;
}

export class MatchStateService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async execute(
    input: MatchStateInput,
    now: Date,
  ): Promise<MatchStateResponse> {
    const matchId = asMatchId(input.matchId);
    const match = await this.matchRepository.findById(matchId);
    if (!match) throw new MatchNotFoundError({ matchId });

    const isCaptain =
      input.viewerId !== null && match.captainId === input.viewerId;

    // Fan out the four reads in parallel — none depend on each other and
    // the polling endpoint runs every 15s, so cumulative latency matters.
    const [accepted, pending, watchingCount, messages] = await Promise.all([
      this.joinRequestRepository.listAcceptedForMatch(matchId),
      isCaptain
        ? this.joinRequestRepository.listPendingForMatch(matchId)
        : Promise.resolve([] as readonly JoinRequest[]),
      this.watchRepository.countForMatch(matchId),
      this.chatMessageRepository.listForFeed({
        matchId,
        since: input.since,
        limit: MESSAGE_FETCH_LIMIT,
      }),
    ]);

    // Resolve all user ids in one batch (captain + accepted + pending +
    // message authors). De-dup via Set so a chatty author isn't fetched twice.
    const userIds = new Set<UserId>([
      match.captainId,
      ...accepted.map((r) => r.userId),
      ...pending.map((r) => r.userId),
      ...messages.map((m) => m.authorId),
    ]);
    const users = await this.userRepository.findByIds([...userIds]);
    const usersById = new Map<UserId, User>(users.map((u) => [u.id, u]));

    const acceptedSlots = sumAcceptedSlots(accepted);
    const slots = computeSlots(match, acceptedSlots);
    const status = deriveMatchStatus(match, slots, now);

    return {
      messages: messages.map((m) => toWireMessage(m, usersById)),
      lineup: {
        captain: toWireAuthorRequired(match.captainId, usersById),
        accepted: accepted.map((r) => toWirePlayer(r, usersById)),
        pending: pending.map((r) => toWirePending(r, usersById)),
        crew: [...match.captainCrew],
        watching_count: watchingCount,
      },
      status: toWireStatus(status),
      updated_at: match.updatedAt.toISOString(),
      deleted: false,
    };
  }
}

function sumAcceptedSlots(requests: readonly JoinRequest[]): number {
  let total = 0;
  for (const r of requests) total += 1 + r.guestCount;
  return total;
}

function toWireAuthor(
  user: User | undefined,
): MatchStateMessageAuthor | null {
  if (!user) return null;
  // Soft-deleted users return null so the UI shows `[Removed user]`. Banned
  // users are returned with `banned: true` so the UI can collapse them too.
  if (user.deletedAt !== null) return null;
  return {
    id: user.id,
    name: user.name,
    avatar_url: user.avatarUrl,
    banned: user.banned,
  };
}

function toWireAuthorRequired(
  userId: UserId,
  byId: Map<UserId, User>,
): MatchStateMessageAuthor {
  const author = toWireAuthor(byId.get(userId));
  if (author) return author;
  // Captain row should always exist (a match without a captain is malformed).
  // Banned/deleted captains DO surface — the UI hides the match anyway via
  // the "captain account removed" cancellation flow (spec §290), but during
  // the same poll window the field must be non-null.
  return {
    id: userId,
    name: "Removed user",
    avatar_url: "",
    banned: true,
  };
}

function toWireMessage(
  message: ChatMessage,
  byId: Map<UserId, User>,
): MatchStateMessage {
  return {
    id: message.id,
    text: message.text,
    created_at: message.createdAt.toISOString(),
    deleted_at:
      message.deletedAt !== null ? message.deletedAt.toISOString() : null,
    author: toWireAuthor(byId.get(message.authorId)),
  };
}

function toWirePlayer(
  request: JoinRequest,
  byId: Map<UserId, User>,
): MatchStateLineupPlayer {
  return {
    user: toWireAuthorRequired(request.userId, byId),
    guest_count: request.guestCount,
  };
}

function toWirePending(
  request: JoinRequest,
  byId: Map<UserId, User>,
): MatchStateLineupPending {
  return {
    request_id: request.id,
    user: toWireAuthorRequired(request.userId, byId),
    guest_count: request.guestCount,
    message: request.message,
    created_at: request.createdAt.toISOString(),
  };
}

// Re-export for tests + downstream consumers that want the same numeric cap.
export type { MatchId };
