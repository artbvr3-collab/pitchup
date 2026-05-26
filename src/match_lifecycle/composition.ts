/**
 * MODULE: match_lifecycle.composition
 * PURPOSE: Composition root for the `match_lifecycle` bounded context. Wires
 *          concrete repositories into application services that `app/`
 *          (Server Components, Route Handlers) imports directly.
 * LAYER: composition (cross-layer wiring)
 * DEPENDENCIES: ./application/*, ./infrastructure/*
 * CONSUMED BY: app/(public)/games/page.tsx (Layer 2),
 *              app/api/matches/route.ts (Layer 3),
 *              app/api/matches/[id]/{join,approve,reject}/route.ts (Layer 4),
 *              app/matches/[id]/page.tsx + app/api/matches/[id]/state/route.ts
 *              (Layer 5 — match detail page + polling endpoint).
 * INVARIANTS:
 *   - Imported only from `app/`. Never from `domain/` or `application/`
 *     (would invert the dependency direction).
 * RELATED DOCS: docs/ARCHITECTURE.md §3 (dependency direction).
 */
import { userRepository } from "@/src/auth/infrastructure/repositories";
import { chatMessageRepository } from "@/src/chat/infrastructure/repositories";

import { ApproveJoinRequestService } from "./application/approve-join-request-service";
import { CreateMatchService } from "./application/create-match-service";
import { JoinMatchService } from "./application/join-match-service";
import { ListDiscoverMatchesService } from "./application/list-discover-matches";
import { ListVenuesService } from "./application/list-venues-service";
import { MatchStateService } from "./application/match-state-service";
import { RejectJoinRequestService } from "./application/reject-join-request-service";
import {
  joinRequestRepository,
  matchRepository,
  venueRepository,
  watchRepository,
} from "./infrastructure/repositories";

export const listDiscoverMatchesService = new ListDiscoverMatchesService(
  matchRepository,
);

export const createMatchService = new CreateMatchService(
  matchRepository,
  venueRepository,
);

export const listVenuesService = new ListVenuesService(venueRepository);

export const joinMatchService = new JoinMatchService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
);

export const approveJoinRequestService = new ApproveJoinRequestService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
);

export const rejectJoinRequestService = new RejectJoinRequestService(
  matchRepository,
  joinRequestRepository,
);

export const matchStateService = new MatchStateService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
  chatMessageRepository,
  userRepository,
);
