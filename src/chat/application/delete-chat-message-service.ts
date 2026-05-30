/**
 * MODULE: chat.application.delete-chat-message-service
 * PURPOSE: Use case — the captain soft-deletes a message in their match's
 *          chat. Implements `DELETE /api/matches/:id/messages/:msgId`:
 *            - 404 if message doesn't exist or belongs to a different match
 *              (cross-match guard — `:id` and `:msgId` must agree)
 *            - 403 chat_forbidden if viewer is not the captain
 *            - 200 idempotent on already-deleted messages
 *          Captain moderation works on every match status, including
 *          Cancelled (spec match.md §225) — there is intentionally no
 *          `chat_frozen` branch here.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository.findById (unlocked),
 *                       ChatMessageRepository.findById,
 *                       ChatMessageRepository.softDelete
 * CONSUMED BY: app/api/matches/[id]/messages/[msgId]/route.ts
 * INVARIANTS:
 *   - The match-id in the URL is verified against `message.matchId` — a
 *     captain of match A cannot delete a message from match B by guessing
 *     a UUID. Mismatch collapses to `MessageNotFoundError` (404), same as
 *     a truly-missing message; no need to distinguish for clients.
 *   - Soft-delete is idempotent (port contract). A captain hitting the
 *     button twice (or two captain tabs racing) both return 200 with the
 *     same `deletedAt`.
 *   - No advisory lock (chat-write exception, spec §546). The cross-match
 *     guard is enough — `withMatchLock` would not protect against the
 *     non-existent invariant being violated here.
 *   - Realtime fan-out (Layer 5.5 — ADR-0005) happens AFTER persistence,
 *     best-effort (try/catch + log) for the same reason as in
 *     PostChatMessageService.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → §225 (captain delete on Cancelled),
 *     §236 (message_deleted fan-out),
 *     §363 ("Captain's chat permissions → delete any message"),
 *     "Per-endpoint checklist" → DELETE /messages/:id
 *   - docs/adr/0005-ably-realtime-chat-transport.md
 */
import { asUserId } from "@/src/auth/domain/user";

import { asMatchId } from "@/src/match_lifecycle/domain/match";
import type { MatchRepository } from "@/src/match_lifecycle/domain/match-repository";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";

import {
  asChatMessageId,
  type ChatMessage,
} from "../domain/chat-message";
import type { ChatMessageRepository } from "../domain/chat-message-repository";
import type { ChatRealtimePublisher } from "../domain/chat-realtime-publisher";
import { ChatForbiddenError, MessageNotFoundError } from "../domain/errors";

export interface DeleteChatMessageServiceInput {
  readonly matchId: string;
  readonly messageId: string;
  readonly viewerId: string;
}

export class DeleteChatMessageService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly realtimePublisher: ChatRealtimePublisher,
  ) {}

  async execute(
    input: DeleteChatMessageServiceInput,
    now: Date,
  ): Promise<ChatMessage> {
    const matchId = asMatchId(input.matchId);
    const messageId = asChatMessageId(input.messageId);
    const viewerId = asUserId(input.viewerId);

    // 1. Match must exist (delete on a hard-deleted match is moot).
    const match = await this.matchRepository.findById(matchId);
    if (!match) throw new MatchNotFoundError({ matchId });

    // 2. Captain-only.
    if (match.captainId !== viewerId) {
      throw new ChatForbiddenError({
        matchId,
        viewerId,
        reason: "not_captain",
      });
    }

    // 3. Message must exist AND belong to this match (cross-match guard).
    const message = await this.chatMessageRepository.findById(messageId);
    if (!message || message.matchId !== matchId) {
      throw new MessageNotFoundError({ matchId, messageId });
    }

    // 4. Soft-delete (idempotent — port contract).
    const deleted = await this.chatMessageRepository.softDelete(messageId, now);

    // 5. Best-effort realtime fan-out (Layer 5.5 — ADR-0005). After the
    //    soft-delete is durable. `deletedAt` is non-null post-softDelete (on
    //    the idempotent path it's the original timestamp); fall back to `now`
    //    defensively. Failure is logged + swallowed — polling reconciles
    //    (spec match.md §236).
    try {
      await this.realtimePublisher.publishMessageDeleted(matchId, {
        id: deleted.id,
        deleted_at: (deleted.deletedAt ?? now).toISOString(),
      });
    } catch (err) {
      // eslint-disable-next-line no-console -- best-effort fan-out, no logger module yet.
      console.error("[chat] best-effort message_deleted publish failed", err);
    }

    return deleted;
  }
}
