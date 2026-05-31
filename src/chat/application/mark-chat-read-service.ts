/**
 * MODULE: chat.application.mark-chat-read-service
 * PURPOSE: Mark a match chat as read for the viewer — the single mark-as-read
 *          trigger behind the `/chats` unread dot. Called by
 *          `POST /api/matches/:id/chat-read` when the user opens Tab Chat on
 *          `/matches/:id` (spec personal.md "/chats" → "Mark-as-read").
 * LAYER: application
 * DEPENDENCIES (ports): ChatReadRepository
 * CONSUMED BY: app/api/matches/[id]/chat-read/route.ts
 * INVARIANTS:
 *   - No membership check. The cursor is harmless for a non-member (it is
 *     only ever read back for matches where the user is accepted/captain, so
 *     a stray row never surfaces); the client only fires this for members,
 *     and `requireAuth` upstream guarantees a real user row for the FK. Kept
 *     a pure UPSERT to match the spec's "created lazily on first Tab Chat
 *     open" wording.
 *   - `now` is injected (testability + single clock source per request).
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/chats" → "Unread chat
 *               dots — data model"
 */
import type { UserId } from "@/src/auth/domain/user";
import { asMatchId } from "@/src/match_lifecycle/domain/match";

import type { ChatReadRepository } from "../domain/chat-read-repository";

export interface MarkChatReadInput {
  readonly matchId: string;
  readonly userId: UserId;
}

export class MarkChatReadService {
  constructor(private readonly chatReadRepository: ChatReadRepository) {}

  async execute(input: MarkChatReadInput, now: Date): Promise<void> {
    await this.chatReadRepository.markRead(
      asMatchId(input.matchId),
      input.userId,
      now,
    );
  }
}
