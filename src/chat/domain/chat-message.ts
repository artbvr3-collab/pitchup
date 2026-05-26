/**
 * MODULE: chat.domain.chat-message
 * PURPOSE: ChatMessage entity — persistence-shape, no behavior. The two
 *          write use cases (PostChatMessage / DeleteChatMessage) live in
 *          application/ and operate on the row via the repository port.
 * LAYER: domain
 * DEPENDENCIES: src/match_lifecycle/domain/match (MatchId),
 *               src/auth/domain/user (UserId)
 * CONSUMED BY: src/chat/domain/chat-message-repository.ts,
 *              src/chat/application/*, infrastructure adapter,
 *              src/match_lifecycle/application/match-state-service.ts
 *              (read-only inclusion in the polling payload).
 * INVARIANTS:
 *   - `text` is the persisted form: trimmed, length ∈ [1, 2000]. Validation
 *     belongs to `normalizeChatText()` below; services call it before insert.
 *   - `deletedAt !== null` ⇒ captain-moderated soft-delete. The row stays
 *     in the DB so authorship references and ordering remain intact; the UI
 *     renders a tombstone "[Message deleted]". Hard-delete is intentionally
 *     absent (spec match.md §225 — captain moderation works on Cancelled).
 *   - `authorId` is preserved verbatim even if the user is later banned or
 *     deleted — render-time resolution falls back to `[Removed user]`. The
 *     schema enforces this via `ON DELETE RESTRICT` on the author FK.
 *   - There is no `updated_at` and no edit operation — the only mutation is
 *     soft-delete. Editing a sent message is intentionally out of scope.
 * RELATED DOCS:
 *   - docs/spec/pitchup-app-map.md → "ChatMessage"
 *   - docs/spec/pitchup-spec-match.md → "Tab Chat", §220, §225, §546
 *   - docs/spec/pitchup-spec-global.md → "Text field validation & sanitization"
 */
import type { UserId } from "@/src/auth/domain/user";

import type { MatchId } from "@/src/match_lifecycle/domain/match";

declare const chatMessageIdBrand: unique symbol;
export type ChatMessageId = string & { readonly [chatMessageIdBrand]: void };

export const asChatMessageId = (value: string): ChatMessageId =>
  value as ChatMessageId;

export interface ChatMessage {
  readonly id: ChatMessageId;
  readonly matchId: MatchId;
  readonly authorId: UserId;
  readonly text: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * Upper bound on the persisted text. Matches the DB column
 * (`text VARCHAR(2000)`) and the spec ("Text field validation & sanitization"
 * in global.md). Re-using the constant here makes the limit visible to
 * services + tests without reaching into Prisma types.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

/**
 * Canonicalize the user-submitted text:
 *   - Trim leading/trailing whitespace (spec global.md).
 *   - Return `null` if the result is empty — caller treats that as an
 *     invalid submission. Empty messages never reach the DB.
 *   - Return `null` if the trimmed length exceeds `CHAT_MESSAGE_MAX_LENGTH`
 *     — caller maps this to a 400 with the same code. Truncation is
 *     intentionally NOT done here: silent truncation would hide a bug in
 *     the client and disagree with the count the user saw.
 *
 * This is a pure helper so application + tests share the rule.
 */
export function normalizeChatText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) return null;
  return trimmed;
}
