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
import { emailSender } from "@/src/notifications/infrastructure/email-sender";
import { notificationRepository } from "@/src/notifications/infrastructure/repositories";
import { appBaseUrl } from "@/src/shared/config/env";

import { ApproveJoinRequestService } from "./application/approve-join-request-service";
import { AutoRejectPendingService } from "./application/auto-reject-pending-service";
import { CancelJoinRequestService } from "./application/cancel-join-request-service";
import { CancelMatchService } from "./application/cancel-match-service";
import { CreateMatchService } from "./application/create-match-service";
import { CreateVenueService } from "./application/create-venue-service";
import { EditMatchService } from "./application/edit-match-service";
import { JoinMatchService } from "./application/join-match-service";
import { KickPlayerService } from "./application/kick-player-service";
import { LeaveMatchService } from "./application/leave-match-service";
import { ListDiscoverMatchesService } from "./application/list-discover-matches";
import { ListMapMatchesService } from "./application/list-map-matches";
import { ListMyMatchesService } from "./application/list-my-matches-service";
import { ListVenuesService } from "./application/list-venues-service";
import { MatchStateService } from "./application/match-state-service";
import { RejectJoinRequestService } from "./application/reject-join-request-service";
import { UnwatchMatchService } from "./application/unwatch-match-service";
import { UpdateVenueService } from "./application/update-venue-service";
import { WatchMatchService } from "./application/watch-match-service";
import {
  joinRequestRepository,
  matchRepository,
  venueRepository,
  watchRepository,
} from "./infrastructure/repositories";

export const listDiscoverMatchesService = new ListDiscoverMatchesService(
  matchRepository,
);

export const listMapMatchesService = new ListMapMatchesService(matchRepository);

export const createMatchService = new CreateMatchService(
  matchRepository,
  venueRepository,
);

export const listVenuesService = new ListVenuesService(venueRepository);

export const createVenueService = new CreateVenueService(venueRepository);

export const updateVenueService = new UpdateVenueService(venueRepository);

// Re-exported for the `/admin/venues` Server Component (direct read of the
// admin venue list), mirroring `auth/composition`'s `userRepository` export.
export { venueRepository };

export const joinMatchService = new JoinMatchService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
);

export const approveJoinRequestService = new ApproveJoinRequestService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
  notificationRepository,
  userRepository,
  emailSender,
  appBaseUrl,
);

export const rejectJoinRequestService = new RejectJoinRequestService(
  matchRepository,
  joinRequestRepository,
  notificationRepository,
);

export const matchStateService = new MatchStateService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
  chatMessageRepository,
  userRepository,
);

export const leaveMatchService = new LeaveMatchService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
  notificationRepository,
);

export const cancelJoinRequestService = new CancelJoinRequestService(
  joinRequestRepository,
);

export const watchMatchService = new WatchMatchService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
);

export const unwatchMatchService = new UnwatchMatchService(watchRepository);

export const listMyMatchesService = new ListMyMatchesService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
);

export const kickPlayerService = new KickPlayerService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
  notificationRepository,
  userRepository,
  emailSender,
  appBaseUrl,
);

export const cancelMatchService = new CancelMatchService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
  notificationRepository,
);

export const editMatchService = new EditMatchService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
  venueRepository,
  notificationRepository,
);

export const autoRejectPendingService = new AutoRejectPendingService(
  matchRepository,
  joinRequestRepository,
  watchRepository,
  notificationRepository,
);
