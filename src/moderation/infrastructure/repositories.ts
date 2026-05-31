/**
 * MODULE: moderation.infrastructure.repositories
 * PURPOSE: Concrete repository singletons for the moderation bounded context,
 *          bound to the shared Prisma client. Imported by composition.ts.
 * LAYER: infrastructure
 * DEPENDENCIES: src/shared/db/prisma, ./prisma-admin-action-repository
 * CONSUMED BY: src/moderation/composition.ts
 * RELATED DOCS: docs/ARCHITECTURE.md §8.
 */
import { prisma } from "@/src/shared/db/prisma";

import type { AdminActionRepository } from "../domain/admin-action-repository";
import type { ReportRepository } from "../domain/report-repository";
import { PrismaAdminActionRepository } from "./prisma-admin-action-repository";
import { PrismaReportRepository } from "./prisma-report-repository";

export const adminActionRepository: AdminActionRepository =
  new PrismaAdminActionRepository(prisma);

export const reportRepository: ReportRepository = new PrismaReportRepository(
  prisma,
);
