/**
 * MODULE: chat.composition
 * PURPOSE: Composition root for the `chat` bounded context. Wires the
 *          ChatMessageRepository adapter into the two write use cases.
 *          The polling state assembler that ALSO reads chat lives in
 *          match_lifecycle/composition.ts (it composes match_lifecycle +
 *          chat ports — both are read directly there, no extra wiring here).
 * LAYER: composition (cross-layer wiring)
 * DEPENDENCIES: ./application/*, ./infrastructure/*,
 *               src/match_lifecycle/infrastructure/repositories
 * CONSUMED BY: app/api/matches/[id]/messages/route.ts,
 *              app/api/matches/[id]/messages/[msgId]/route.ts.
 * INVARIANTS:
 *   - Imported only from `app/`.
 * RELATED DOCS: docs/ARCHITECTURE.md §3.
 */
import {
  joinRequestRepository,
  matchRepository,
} from "@/src/match_lifecycle/infrastructure/repositories";

import { DeleteChatMessageService } from "./application/delete-chat-message-service";
import { PostChatMessageService } from "./application/post-chat-message-service";
import { chatMessageRepository } from "./infrastructure/repositories";

export const postChatMessageService = new PostChatMessageService(
  matchRepository,
  joinRequestRepository,
  chatMessageRepository,
);

export const deleteChatMessageService = new DeleteChatMessageService(
  matchRepository,
  chatMessageRepository,
);
