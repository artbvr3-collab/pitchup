/**
 * MODULE: chat.application.post-chat-message-service
 * PURPOSE: Use case — the captain or an accepted player sends a chat message.
 *          Implements the role + status gating for
 *          `POST /api/matches/:id/messages`:
 *            - 404 if match not found
 *            - 409 chat_frozen on Cancelled match
 *            - 403 chat_forbidden if viewer is not captain and not accepted
 *            - 400 invalid_message_text if text is empty after trim or too long
 *          Persists the row and returns it. No advisory lock — chat writes
 *          don't mutate slot/status/roster (spec match.md §546).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository.findById (unlocked),
 *                       JoinRequestRepository.findByMatchAndUser (unlocked),
 *                       ChatMessageRepository.insert
 * CONSUMED BY: app/api/matches/[id]/messages/route.ts
 * INVARIANTS:
 *   - No `withMatchLock` wrapper — this is the documented exception family
 *     together with `POST /api/matches` (spec match.md "Concurrency &
 *     locking" → exceptions; AGENTS gotchas → "Create-match has no advisory
 *     lock; the other no-lock exception is POST /messages").
 *   - Role gate runs BEFORE persistence to avoid orphan rows on a 403.
 *   - Match-not-found maps to the canonical `MatchNotFoundError` from
 *     match_lifecycle — chat doesn't redefine the 404 code (the client
 *     handles it the same as the rest of the match-id endpoints).
 *   - `chat_frozen` (Cancelled) fires before `chat_forbidden` so a kicked
 *     player on a cancelled match sees the more informative reason. Per
 *     spec match.md §224 the composer is hidden anyway; this is the
 *     direct-curl path.
 *   - `// TODO(Layer 5.5)` realtime publish marker is recorded as a
 *     side-effect AFTER insert, never inside it — keeps the persisted row
 *     authoritative even if the publish fails (matches the wider "polling
 *     is source of truth" stance from spec §229).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Tab Chat", §213 (chat access by
 *     role), §224 (cancelled chat frozen), §546 (no lock), "Per-endpoint
 *     checklist" → POST /messages
 *   - docs/spec/pitchup-spec-global.md → "Text field validation"
 */
import { asUserId } from "@/src/auth/domain/user";

import type { JoinRequestRepository } from "@/src/match_lifecycle/domain/join-request-repository";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import type { MatchRepository } from "@/src/match_lifecycle/domain/match-repository";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";

import {
  type ChatMessage,
  normalizeChatText,
} from "../domain/chat-message";
import type { ChatMessageRepository } from "../domain/chat-message-repository";
import {
  ChatForbiddenError,
  ChatFrozenError,
  InvalidMessageTextError,
} from "../domain/errors";

import type { PostChatMessageServiceInput } from "./dto/post-chat-message-input";

export class PostChatMessageService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly chatMessageRepository: ChatMessageRepository,
  ) {}

  async execute(input: PostChatMessageServiceInput): Promise<ChatMessage> {
    const matchId = asMatchId(input.matchId);
    const authorId = asUserId(input.authorId);

    // 1. Match must exist. Hard-deleted matches surface this too (the row
    //    is gone — the polling layer returns `deleted: true` for the client).
    const match = await this.matchRepository.findById(matchId);
    if (!match) throw new MatchNotFoundError({ matchId });

    // 2. Cancelled matches freeze chat for everyone (spec §224). This must
    //    fire before the role check so an accepted-but-now-cancelled player
    //    sees the "chat_frozen" code rather than "chat_forbidden".
    if (match.cancelledAt !== null) {
      throw new ChatFrozenError({ matchId });
    }

    // 3. Role gate. Captain bypasses the JoinRequest lookup.
    const isCaptain = match.captainId === authorId;
    if (!isCaptain) {
      const request = await this.joinRequestRepository.findByMatchAndUser(
        matchId,
        authorId,
      );
      if (!request || request.status !== "accepted") {
        throw new ChatForbiddenError({
          matchId,
          authorId,
          reason: "not_member",
        });
      }
    }

    // 4. Validate text. Zod has already checked min(1).max(2000) at the API
    //    boundary; this is the canonical post-trim guard (whitespace-only
    //    messages reach here as 4-char strings that fail trim).
    const normalised = normalizeChatText(input.text);
    if (normalised === null) {
      throw new InvalidMessageTextError({ matchId });
    }

    // 5. Persist.
    const row = await this.chatMessageRepository.insert({
      matchId,
      authorId,
      text: normalised,
    });

    // TODO(Layer 5.5): publish "message_created" to Ably channel
    //   match:{matchId}:chat after commit. Failure is logged, not surfaced —
    //   polling delivers the row within 15s. See spec match.md §229, §234.

    return row;
  }
}
