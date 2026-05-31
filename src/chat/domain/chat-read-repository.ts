/**
 * MODULE: chat.domain.chat-read-repository
 * PURPOSE: Port for the per-(user, match) chat read cursor that backs the
 *          unread dot on `/chats`. Like ChatMessageRepository, it takes no
 *          `TransactionClient` — read-state is outside the advisory-lock
 *          domain (it never touches slots / roster / status).
 * LAYER: domain
 * DEPENDENCIES: src/auth/domain/user, src/match_lifecycle/domain/match
 * CONSUMED BY: src/chat/application/mark-chat-read-service,
 *              src/match_lifecycle/application/list-my-chats-service,
 *              src/chat/infrastructure/prisma-chat-read-repository
 * INVARIANTS:
 *   - `markRead` is an UPSERT keyed on (matchId, userId): insert a new cursor
 *     or advance `lastReadAt` on an existing one. The ONLY mark-as-read
 *     trigger is opening Tab Chat on `/matches/:id` (spec personal.md
 *     "/chats" → "Mark-as-read"); scroll position is not tracked.
 *   - `listLastReadForUser` returns ONLY the requested matches that have a
 *     cursor row — matches absent from the map have never been opened, so the
 *     caller treats every foreign message as unread.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/chats" → "Unread chat dots —
 *     data model"
 *   - docs/spec/pitchup-app-map.md → "ChatRead"
 *   - ADR-0003 (Repository ports + Prisma adapters)
 */
import type { UserId } from "@/src/auth/domain/user";
import type { MatchId } from "@/src/match_lifecycle/domain/match";

export interface ChatReadRepository {
  /**
   * Insert-or-advance the read cursor for (matchId, userId) to `lastReadAt`.
   * Idempotent on the key; a later timestamp simply overwrites the earlier
   * one.
   */
  markRead(matchId: MatchId, userId: UserId, lastReadAt: Date): Promise<void>;

  /**
   * Batch-read the `lastReadAt` cursor for `userId` across `matchIds`.
   * Missing entries (no row yet) are simply absent from the returned map.
   */
  listLastReadForUser(
    userId: UserId,
    matchIds: readonly MatchId[],
  ): Promise<Map<MatchId, Date>>;
}
