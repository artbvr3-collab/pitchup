/**
 * MODULE: auth.infrastructure.repositories
 * PURPOSE: Single instance of the User repository, wrapping the Prisma
 *          singleton. Lives at the infrastructure level (not composition.ts)
 *          because the Auth.js v5 `signIn` callback needs it *inside*
 *          `auth-config.ts` — pulling it from composition.ts would create
 *          a circular import (composition → auth → auth-config → composition).
 * LAYER: infrastructure
 * DEPENDENCIES: src/shared/db/prisma.ts, ./prisma-user-repository
 * CONSUMED BY: src/auth/infrastructure/auth-config.ts (signIn callback),
 *              src/auth/composition.ts (application services).
 * RELATED DOCS: docs/ARCHITECTURE.md §8.
 */
import { prisma } from "@/src/shared/db/prisma";
import type { UserRepository } from "../domain/user-repository";
import { PrismaUserRepository } from "./prisma-user-repository";

export const userRepository: UserRepository = new PrismaUserRepository(prisma);
