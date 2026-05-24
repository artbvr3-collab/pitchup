/**
 * MODULE: shared.db.prisma
 * PURPOSE: Singleton Prisma client. Module-level instance reused across the
 *          Next.js hot-reload boundary in dev to avoid exhausting Postgres
 *          connections.
 * LAYER: shared / infrastructure
 * DEPENDENCIES: @prisma/client
 * CONSUMED BY: src/<context>/infrastructure/*-repository.ts, middleware.ts
 * INVARIANTS:
 *   - Exactly one PrismaClient per process.
 *   - Never imported from src/<context>/domain/ or application/.
 * RELATED DOCS: docs/ARCHITECTURE.md §8 (Persistence).
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
