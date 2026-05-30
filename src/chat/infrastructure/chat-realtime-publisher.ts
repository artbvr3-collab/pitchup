/**
 * MODULE: chat.infrastructure.chat-realtime-publisher
 * PURPOSE: Construct the singleton `ChatRealtimePublisher` the chat composition
 *          root injects into the two write services. Transport is chosen by key
 *          presence (ADR-0005): `ABLY_API_KEY` set → real Ably fan-out;
 *          absent → no-op (chat runs on polling). Mirrors `emailSender`
 *          (ADR-0004) — config-driven adapter selection in one place.
 * LAYER: infrastructure (composition-adjacent — reads validated `env`)
 * DEPENDENCIES: src/shared/config/env, ./ably-chat-realtime-publisher,
 *               ./noop-chat-realtime-publisher
 * CONSUMED BY: src/chat/composition.ts
 * INVARIANTS:
 *   - Unlike `EMAIL_TRANSPORT=resend` (which hard-throws on a missing key),
 *     a missing `ABLY_API_KEY` is NOT an error — realtime is an enhancement,
 *     not a required channel. Silent degradation to the no-op adapter.
 * RELATED DOCS: docs/adr/0005-ably-realtime-chat-transport.md
 */
import { env } from "@/src/shared/config/env";

import type { ChatRealtimePublisher } from "../domain/chat-realtime-publisher";
import { AblyChatRealtimePublisher } from "./ably-chat-realtime-publisher";
import { NoopChatRealtimePublisher } from "./noop-chat-realtime-publisher";

function buildChatRealtimePublisher(): ChatRealtimePublisher {
  if (env.ABLY_API_KEY) {
    return new AblyChatRealtimePublisher(env.ABLY_API_KEY);
  }
  return new NoopChatRealtimePublisher();
}

export const chatRealtimePublisher: ChatRealtimePublisher =
  buildChatRealtimePublisher();
