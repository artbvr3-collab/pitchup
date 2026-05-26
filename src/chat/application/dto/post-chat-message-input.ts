/**
 * MODULE: chat.application.dto.post-chat-message-input
 * PURPOSE: Zod schema + TS type for the `POST /api/matches/:id/messages`
 *          request body. The route handler parses this before invoking
 *          `PostChatMessageService`. matchId + authorId come from the URL +
 *          session, NOT the body.
 * LAYER: application
 * DEPENDENCIES: zod, ../../domain/chat-message (CHAT_MESSAGE_MAX_LENGTH)
 * CONSUMED BY: app/api/matches/[id]/messages/route.ts, the service.
 * INVARIANTS:
 *   - Length validation runs twice: Zod here (cheap parser-level guard) AND
 *     `normalizeChatText` inside the service (post-trim canonical check).
 *     Tests pin both surfaces against the spec.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Text field validation"
 */
import { z } from "zod";

import { CHAT_MESSAGE_MAX_LENGTH } from "../../domain/chat-message";

export const PostChatMessageApiSchema = z.object({
  text: z.string().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
});

export type PostChatMessageApiInput = z.infer<typeof PostChatMessageApiSchema>;

export interface PostChatMessageServiceInput {
  readonly matchId: string;
  readonly authorId: string;
  readonly text: string;
}
