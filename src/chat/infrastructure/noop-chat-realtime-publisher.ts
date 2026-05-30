/**
 * MODULE: chat.infrastructure.noop-chat-realtime-publisher
 * PURPOSE: No-op implementation of the ChatRealtimePublisher port — used when
 *          `ABLY_API_KEY` is absent (dev without keys, or before the owner
 *          provisions Ably). Chat then runs purely on polling; the realtime
 *          overlay is simply off. Counterpart to ConsoleEmailSender (ADR-0004).
 * LAYER: infrastructure (adapter)
 * DEPENDENCIES: ../domain/chat-realtime-publisher
 * CONSUMED BY: src/chat/infrastructure/chat-realtime-publisher.ts (singleton picker)
 * INVARIANTS:
 *   - Never throws, never logs (a missing key is an expected config state, not
 *     an error). The whole point is silent degradation to polling.
 * RELATED DOCS: docs/adr/0005-ably-realtime-chat-transport.md
 */
import type { ChatRealtimePublisher } from "../domain/chat-realtime-publisher";

export class NoopChatRealtimePublisher implements ChatRealtimePublisher {
  async publishMessageCreated(): Promise<void> {
    // Intentionally empty — Ably not configured; polling carries the message.
  }

  async publishMessageDeleted(): Promise<void> {
    // Intentionally empty — Ably not configured; polling carries the deletion.
  }
}
