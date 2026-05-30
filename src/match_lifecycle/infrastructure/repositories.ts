/**
 * MODULE: match_lifecycle.infrastructure.repositories
 * PURPOSE: Single instances of the bounded context's repositories, wrapping
 *          the Prisma singleton. Kept here (not composition.ts) for symmetry
 *          with src/auth/infrastructure/repositories.ts — composition.ts only
 *          wires application services.
 * LAYER: infrastructure
 * DEPENDENCIES: src/shared/db/prisma.ts, ./prisma-*-repository
 * CONSUMED BY: src/match_lifecycle/composition.ts
 * RELATED DOCS: docs/ARCHITECTURE.md §8.
 */
import { prisma } from "@/src/shared/db/prisma";

import type { AdminMatchDeletionRepository } from "../domain/admin-match-deletion-repository";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import type { MatchRepository } from "../domain/match-repository";
import type { VenueRepository } from "../domain/venue-repository";
import type { WatchRepository } from "../domain/watch-repository";
import { PrismaAdminMatchDeletionRepository } from "./prisma-admin-match-deletion-repository";
import { PrismaJoinRequestRepository } from "./prisma-join-request-repository";
import { PrismaMatchRepository } from "./prisma-match-repository";
import { PrismaVenueRepository } from "./prisma-venue-repository";
import { PrismaWatchRepository } from "./prisma-watch-repository";

export const matchRepository: MatchRepository = new PrismaMatchRepository(prisma);
export const venueRepository: VenueRepository = new PrismaVenueRepository(prisma);
export const joinRequestRepository: JoinRequestRepository =
  new PrismaJoinRequestRepository(prisma);
export const watchRepository: WatchRepository = new PrismaWatchRepository(prisma);
export const adminMatchDeletionRepository: AdminMatchDeletionRepository =
  new PrismaAdminMatchDeletionRepository(prisma);
