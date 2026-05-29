/**
 * MODULE: notifications.infrastructure.repositories
 * PURPOSE: Single instances of the bounded context's repositories, wrapping
 *          the Prisma singleton. Kept here (not composition.ts) for symmetry
 *          with src/match_lifecycle/infrastructure/repositories.ts —
 *          composition.ts only wires application services.
 * LAYER: infrastructure
 * DEPENDENCIES: src/shared/db/prisma.ts, ./prisma-notification-repository
 * CONSUMED BY: src/notifications/composition.ts (future)
 * RELATED DOCS: docs/ARCHITECTURE.md §8.
 */
import { prisma } from "@/src/shared/db/prisma";

import type { NotificationRepository } from "../domain/notification-repository";
import { PrismaNotificationRepository } from "./prisma-notification-repository";

export const notificationRepository: NotificationRepository =
  new PrismaNotificationRepository(prisma);
