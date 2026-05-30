/**
 * MODULE: chat.infrastructure.ably-chat-realtime-publisher
 * PURPOSE: Ably implementation of the ChatRealtimePublisher port. Uses
 *          `Ably.Rest` (stateless publish — no persistent connection needed on
 *          the server) to fan `message_created` / `message_deleted` out to
 *          `match:{matchId}:chat`. This is the v1 transport (ADR-0005);
 *          v2 swaps this adapter for a Socket.io emit, same port.
 * LAYER: infrastructure (adapter)
 * DEPENDENCIES: ably (Rest client), ../domain/chat-realtime-publisher
 * CONSUMED BY: src/chat/infrastructure/chat-realtime-publisher.ts (singleton picker)
 * INVARIANTS:
 *   - Server-side only: constructed with the full `ABLY_API_KEY`. Never bundled
 *     to the client (the client uses the subscribe-only key in the browser).
 *   - `publish*` MAY reject (network / quota). The calling service swallows it
 *     (best-effort fan-out, spec §233) — this adapter does not pre-catch, so
 *     the failure is visible to the service's logger.
 *   - Event names + channel name come from the domain (single source of truth).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md §233-236
 *   - docs/adr/0005-ably-realtime-chat-transport.md
 */
import * as Ably from "ably";

import {
  CHAT_REALTIME_EVENTS,
  chatChannelName,
  type ChatMessageCreatedEvent,
  type ChatMessageDeletedEvent,
  type ChatRealtimePublisher,
} from "../domain/chat-realtime-publisher";

export class AblyChatRealtimePublisher implements ChatRealtimePublisher {
  private readonly client: Ably.Rest;

  constructor(apiKey: string) {
    this.client = new Ably.Rest(apiKey);
  }

  async publishMessageCreated(
    matchId: string,
    event: ChatMessageCreatedEvent,
  ): Promise<void> {
    await this.client.channels
      .get(chatChannelName(matchId))
      .publish(CHAT_REALTIME_EVENTS.messageCreated, event);
  }

  async publishMessageDeleted(
    matchId: string,
    event: ChatMessageDeletedEvent,
  ): Promise<void> {
    await this.client.channels
      .get(chatChannelName(matchId))
      .publish(CHAT_REALTIME_EVENTS.messageDeleted, event);
  }
}
