/**
 * MODULE: chat.infrastructure.repositories
 * PURPOSE: Single instances of the chat context's repositories, wrapping the
 *          Prisma singleton. Mirrors src/auth/infrastructure/repositories.ts
 *          and src/match_lifecycle/infrastructure/repositories.ts.
 * LAYER: infrastructure
 * DEPENDENCIES: src/shared/db/prisma.ts, ./prisma-chat-message-repository,
 *               ./prisma-chat-read-repository
 * CONSUMED BY: src/chat/composition.ts,
 *              src/match_lifecycle/composition.ts (ListMyChatsService)
 * RELATED DOCS: docs/ARCHITECTURE.md §8.
 */
import { prisma } from "@/src/shared/db/prisma";

import type { ChatMessageRepository } from "../domain/chat-message-repository";
import type { ChatReadRepository } from "../domain/chat-read-repository";
import { PrismaChatMessageRepository } from "./prisma-chat-message-repository";
import { PrismaChatReadRepository } from "./prisma-chat-read-repository";

export const chatMessageRepository: ChatMessageRepository =
  new PrismaChatMessageRepository(prisma);

export const chatReadRepository: ChatReadRepository =
  new PrismaChatReadRepository(prisma);
