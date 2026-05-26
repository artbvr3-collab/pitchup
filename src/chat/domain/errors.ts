/**
 * MODULE: chat.domain.errors
 * PURPOSE: Domain errors raised by chat services. Stable `code` strings —
 *          part of the API contract returned by the route handlers (mapped
 *          via shared/errors/http-mapping). Layer 5 introduces five codes;
 *          the role-gating ones (`chat_forbidden`) are 403 and the
 *          status-gating one (`chat_frozen`) is 409 per spec match.md §224.
 * LAYER: domain
 * DEPENDENCIES: src/shared/errors/app-error
 * CONSUMED BY: src/chat/application/*, src/shared/errors/http-mapping
 * INVARIANTS:
 *   - One concrete class per spec code, no overloading via `meta`. Same rule
 *     as match_lifecycle/domain/errors.ts.
 *   - `meta` carries the offending identifiers for the HTTP layer to log
 *     and for tests to assert on (no leakage to clients beyond the code).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist", §224
 *     (chat_frozen on Cancelled), "Tab Chat" (role-based read-only modes)
 */
import { AppError } from "@/src/shared/errors/app-error";

/**
 * `409 chat_frozen` — `POST /api/matches/:id/messages` against a Cancelled
 * match. The UI already hides the composer (spec match.md §224), this is
 * the direct-curl backstop. Captain moderation (DELETE) is NOT blocked by
 * this code — moderation works on Cancelled per spec §225.
 */
export class ChatFrozenError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("chat_frozen", "Chat is closed for this match", 409, meta);
  }
}

/**
 * `403 chat_forbidden` — the viewer's role does not permit the requested
 * chat operation. Three cases collapse to this code (the `meta.reason`
 * field distinguishes them in logs):
 *   - "not_member" — guest / none / pending / watching tries to POST a
 *     message. Pending sees the tab as disabled in the UI; the others
 *     either don't see the composer or aren't authenticated.
 *   - "not_captain" — non-captain tries to DELETE a message.
 *   - "pending_no_poll" — pending tries to GET /state (spec §216 —
 *     "Pending players do not poll").
 */
export class ChatForbiddenError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("chat_forbidden", "You can't perform this chat action", 403, meta);
  }
}

/**
 * `404 message_not_found` — the message id does not exist or does not
 * belong to the match id in the URL. Cross-match guard collapses to the
 * same code as plain "not found" — no need to distinguish for clients.
 */
export class MessageNotFoundError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("message_not_found", "Message not found", 404, meta);
  }
}

/**
 * `400 invalid_message_text` — empty after trim, or trimmed length exceeds
 * `CHAT_MESSAGE_MAX_LENGTH`. Two failure modes share one code because the
 * UI shows the same toast in both cases (the composer's char counter
 * prevents this in practice; this is a direct-curl backstop).
 */
export class InvalidMessageTextError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("invalid_message_text", "Message text is empty or too long", 400, meta);
  }
}
