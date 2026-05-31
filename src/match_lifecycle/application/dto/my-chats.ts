/**
 * MODULE: match_lifecycle.application.dto.my-chats
 * PURPOSE: Read-model DTO for the `/chats` list — one card per match the
 *          viewer has chat access to (accepted or captain), decorated with the
 *          canonical slot math + on-read match status + an unread flag. The
 *          page renders these straight into the shared MatchCard.
 * LAYER: application (DTO)
 * CONSUMED BY: src/match_lifecycle/application/list-my-chats-service.ts,
 *              app/(private)/chats/page.tsx
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/chats"
 */
import type { MatchWithVenue } from "../../domain/match";
import type { MatchStatus } from "../../domain/match-status";
import type { SlotInfo } from "../../domain/slot-math";

export interface MyChatCardDto {
  readonly match: MatchWithVenue;
  readonly slots: SlotInfo;
  readonly matchStatus: MatchStatus;
  /**
   * True iff a non-deleted message from another author exists with
   * `created_at > lastReadAt` (or no read cursor yet). Drives the corner dot.
   */
  readonly unread: boolean;
  /**
   * Last-message preview for the Telegram-style footer on the chat card.
   * `null` when the chat has no messages yet.
   * `isOwn` is `true` when the viewer sent that message (prepend "You: ").
   */
  readonly lastMessage: { readonly text: string; readonly isOwn: boolean } | null;
}

export interface MyChatsPage {
  /**
   * Sorted: chats WITH messages first, by latest-message time DESC; chats
   * with no messages last, by `start_time` ASC (spec personal.md "/chats" →
   * "Sorting").
   */
  readonly chats: readonly MyChatCardDto[];
}
