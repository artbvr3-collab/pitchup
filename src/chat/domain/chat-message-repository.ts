/**
 * MODULE: chat.domain.chat-message-repository
 * PURPOSE: Port for ChatMessage persistence. Chat does NOT take the advisory
 *          lock (spec match.md §546 — chat messages don't mutate slot/status/
 *          roster), so methods do not accept a `TransactionClient`. The
 *          repository is consumed directly by the chat services and by the
 *          read-only `MatchStateService` polling assembler.
 * LAYER: domain
 * DEPENDENCIES: ./chat-message, src/auth/domain/user,
 *               src/match_lifecycle/domain/match
 * CONSUMED BY: src/chat/application/post-chat-message-service,
 *              src/chat/application/delete-chat-message-service,
 *              src/match_lifecycle/application/match-state-service,
 *              src/chat/infrastructure/prisma-chat-message-repository
 * INVARIANTS:
 *   - `insert` returns the persisted row (server-assigned id + createdAt).
 *     Services need both to fan-out a freshly-published payload.
 *   - `softDelete` is idempotent — a second call on an already-deleted row
 *     is a no-op and returns the same row. The route handler still returns
 *     200 so retries on flaky networks are safe (spec match.md captain
 *     moderation is destructive-but-idempotent by design).
 *   - `listForFeed` returns messages in `created_at ASC` order, NOT NULL
 *     `deleted_at` rows INCLUDED — the UI renders tombstones in place
 *     (spec match.md "Captain delete on messages").
 *   - `listForFeed` is the single read entry point used by both the initial
 *     RSC page load (`since = null` ⇒ full history, capped at `limit`) and
 *     the polling delta (`since = ISO ⇒ messages with created_at > since
 *     OR (deleted_at IS NOT NULL AND deleted_at > since)`). The OR-branch
 *     surfaces soft-deletes as delta events even when the message itself
 *     was created before `since` — without it, the frontend would never
 *     learn about a delete that happens later than the original message.
 *   - `activityByMatches` only considers NON-deleted rows (`deleted_at IS
 *     NULL`). Matches with no non-deleted messages are absent from the map —
 *     the `/chats` assembler sorts them to the bottom by `start_time`.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Tab Chat", §195 ("Polling for
 *     match state"), §225 (captain delete on Cancelled)
 *   - docs/spec/pitchup-app-map.md → "ChatMessage"
 *   - ADR-0003 (Repository ports + Prisma adapters)
 */
import type { UserId } from "@/src/auth/domain/user";
import type { MatchId } from "@/src/match_lifecycle/domain/match";

import type { ChatMessage, ChatMessageId } from "./chat-message";

/**
 * Per-match chat activity used by the `/chats` list (Layer /chats):
 *   - `lastAt`: timestamp of the latest non-deleted message (any author) —
 *     drives the chat-list sort (DESC).
 *   - `lastForeignAt`: timestamp of the latest non-deleted message from
 *     someone OTHER than the viewer — combined with the viewer's ChatRead
 *     cursor to decide the unread dot. `null` when the only messages are the
 *     viewer's own.
 */
export interface ChatActivity {
  readonly lastAt: Date;
  readonly lastForeignAt: Date | null;
}

export interface InsertChatMessageInput {
  readonly matchId: MatchId;
  readonly authorId: UserId;
  /** Already-normalised text — services call `normalizeChatText` before this. */
  readonly text: string;
}

export interface ListChatMessagesForFeedOptions {
  readonly matchId: MatchId;
  /**
   * Delta cursor. `null` ⇒ return the full history (capped at `limit`),
   * for the initial RSC load. ISO timestamp ⇒ return messages whose
   * `created_at > since` OR `deleted_at > since` (see invariant above).
   */
  readonly since: Date | null;
  /**
   * Hard cap on the number of rows returned. The polling delta is rarely
   * close to this in practice (15 s of chat in a 14-spot match), but the
   * limit guards against a long offline gap.
   */
  readonly limit: number;
}

export interface ChatMessageRepository {
  insert(input: InsertChatMessageInput): Promise<ChatMessage>;

  findById(id: ChatMessageId): Promise<ChatMessage | null>;

  /**
   * Set `deleted_at = now()` on the row. Idempotent — if already deleted,
   * keeps the original `deleted_at` and returns the row as-is.
   */
  softDelete(id: ChatMessageId, now: Date): Promise<ChatMessage>;

  listForFeed(
    options: ListChatMessagesForFeedOptions,
  ): Promise<readonly ChatMessage[]>;

  /**
   * Batch chat-activity probe for the `/chats` list. For each requested match
   * id that has at least one non-deleted message, returns its `ChatActivity`
   * ({@link ChatActivity}). Match ids with no non-deleted messages are absent
   * from the map. `userId` is the viewer — it splits "any author" (`lastAt`)
   * from "another author" (`lastForeignAt`) in a single round trip.
   */
  activityByMatches(
    userId: UserId,
    matchIds: readonly MatchId[],
  ): Promise<Map<MatchId, ChatActivity>>;
}
