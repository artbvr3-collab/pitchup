/**
 * MODULE: chat.infrastructure.repositories
 * PURPOSE: Single instances of the chat context's repositories, wrapping the
 *          Prisma singleton. Mirrors src/auth/infrastructure/repositories.ts
 *          and src/match_lifecycle/infrastructure/repositories.ts.
 * LAYER: infrastructure
 * DEPENDENCIES: src/shared/db/prisma.ts, ./prisma-chat-message-repository
 * CONSUMED BY: src/chat/composition.ts
 * RELATED DOCS: docs/ARCHITECTURE.md §8.
 */
import { prisma } from "@/src/shared/db/prisma";

import type { ChatMessageRepository } from "../domain/chat-message-repository";
import { PrismaChatMessageRepository } from "./prisma-chat-message-repository";

export const chatMessageRepository: ChatMessageRepository =
  new PrismaChatMessageRepository(prisma);
