/**
 * MODULE: match_lifecycle.infrastructure.repositories
 * PURPOSE: Single instance of the Match repository, wrapping the Prisma
 *          singleton. Kept here (not composition.ts) for symmetry with
 *          src/auth/infrastructure/repositories.ts — composition.ts only
 *          wires application services.
 * LAYER: infrastructure
 * DEPENDENCIES: src/shared/db/prisma.ts, ./prisma-match-repository
 * CONSUMED BY: src/match_lifecycle/composition.ts
 * RELATED DOCS: docs/ARCHITECTURE.md §8.
 */
import { prisma } from "@/src/shared/db/prisma";
import type { MatchRepository } from "../domain/match-repository";
import { PrismaMatchRepository } from "./prisma-match-repository";

export const matchRepository: MatchRepository = new PrismaMatchRepository(prisma);
