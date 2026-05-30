/**
 * MODULE: chat.domain.chat-realtime-publisher
 * PURPOSE: Port for fanning chat events out over a realtime transport (Ably in
 *          v1, self-hosted Socket.io in v2 — the port keeps the chat domain
 *          provider-agnostic). Defines the wire payloads exactly as the spec
 *          fixes them (§235-236) plus the shared channel name + event names so
 *          the server publisher and the client subscribe hook never drift.
 * LAYER: domain (port + value objects)
 * DEPENDENCIES: none (pure — strings only).
 * CONSUMED BY: src/chat/application/post-chat-message-service.ts,
 *              src/chat/application/delete-chat-message-service.ts,
 *              src/chat/infrastructure/ably-chat-realtime-publisher.ts,
 *              src/chat/infrastructure/noop-chat-realtime-publisher.ts,
 *              src/ui/hooks/use-ably-channel.ts (channel name + event names only).
 * INVARIANTS:
 *   - `message_created` carries `author_id` (raw), NOT the resolved author
 *     object that the poll payload's `messages[]` carries. The client resolves
 *     it against the lineup it already holds; polling reconciles otherwise.
 *     This is the spec's deliberate trade — no author read inside publish.
 *   - The channel name + event-name constants are the SINGLE source of truth.
 *     The server publishes to `chatChannelName(matchId)` with
 *     `CHAT_REALTIME_EVENTS.*`; the client subscribes to the exact same.
 *   - Implementations are best-effort: a publish failure is the CALLER's to
 *     swallow (the application service wraps it in try/catch + log). Polling is
 *     the source of truth (spec §229), so a dropped publish only adds latency.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Realtime chat transport" §227-256
 *   - docs/adr/0005-ably-realtime-chat-transport.md
 */

/** Channel name for a match's chat. One channel per match (spec §232). */
export function chatChannelName(matchId: string): string {
  return `match:${matchId}:chat`;
}

/** Event names on the channel (spec §234-236). Shared server ↔ client. */
export const CHAT_REALTIME_EVENTS = {
  messageCreated: "message_created",
  messageDeleted: "message_deleted",
} as const;

/**
 * `message_created` payload (spec §235) — same field set as a `messages[]`
 * entry in `GET /api/matches/:id/state`, EXCEPT the author is carried as a raw
 * `author_id` (the client resolves it against the lineup).
 */
export interface ChatMessageCreatedEvent {
  readonly id: string;
  readonly author_id: string;
  readonly text: string;
  readonly created_at: string; // ISO
}

/** `message_deleted` payload (spec §236). */
export interface ChatMessageDeletedEvent {
  readonly id: string;
  readonly deleted_at: string; // ISO
}

/**
 * Port — fans a chat event out to the realtime transport. Implementations MAY
 * throw (e.g. the Ably adapter on a network error); the application service
 * catches and logs, never surfacing the failure to the user.
 */
export interface ChatRealtimePublisher {
  publishMessageCreated(
    matchId: string,
    event: ChatMessageCreatedEvent,
  ): Promise<void>;
  publishMessageDeleted(
    matchId: string,
    event: ChatMessageDeletedEvent,
  ): Promise<void>;
}
