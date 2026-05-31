/**
 * MODULE: moderation.composition
 * PURPOSE: Composition root for the `moderation` bounded context. Wires the
 *          admin user-management use cases from the moderation audit repository
 *          + cross-context ports (auth's `UserRepository`, match_lifecycle's
 *          `MatchRepository` + `CancelMatchService`) into singletons the
 *          `app/api/admin/**` Route Handlers consume.
 * LAYER: composition (cross-layer wiring)
 * DEPENDENCIES: ./application/*, ./infrastructure/repositories,
 *               src/auth/infrastructure/repositories,
 *               src/match_lifecycle/{composition, infrastructure/repositories}
 * CONSUMED BY: app/api/admin/users/[id]/<action>/route.ts
 * INVARIANTS:
 *   - Imported only from `app/`. Pulling concrete services from sibling
 *     contexts (the auth user repo, the match_lifecycle cancel service) is
 *     allowed HERE, at the composition root — same pattern as
 *     `auth/composition.ts` wiring `DeleteAccountService`.
 * RELATED DOCS: docs/ARCHITECTURE.md §3 (dependency direction).
 */
import { userRepository } from "@/src/auth/infrastructure/repositories";
import { cancelMatchService } from "@/src/match_lifecycle/composition";
import { matchRepository } from "@/src/match_lifecycle/infrastructure/repositories";

import { BanUserService } from "./application/ban-user-service";
import { DemoteUserService } from "./application/demote-user-service";
import { ListAdminReportsService } from "./application/list-admin-reports-service";
import { PromoteUserService } from "./application/promote-user-service";
import { SubmitReportService } from "./application/submit-report-service";
import { UnbanUserService } from "./application/unban-user-service";
import {
  adminActionRepository,
  reportRepository,
} from "./infrastructure/repositories";

export const banUserService = new BanUserService(
  userRepository,
  matchRepository,
  cancelMatchService,
  adminActionRepository,
);

export const unbanUserService = new UnbanUserService(
  userRepository,
  adminActionRepository,
);

export const promoteUserService = new PromoteUserService(
  userRepository,
  adminActionRepository,
);

export const demoteUserService = new DemoteUserService(
  userRepository,
  adminActionRepository,
);

// ─── Layer 9d — reports ──────────────────────────────────────────────────────

export const submitReportService = new SubmitReportService(
  reportRepository,
  userRepository,
  matchRepository,
);

export const listAdminReportsService = new ListAdminReportsService(
  reportRepository,
  userRepository,
  matchRepository,
);

/**
 * Re-exported for the thin admin report routes (mark-reviewed / dismiss) which
 * call the repository directly — same pattern as `/admin/users` reading
 * `userRepository.listForAdmin` and `/admin/venues` using `venueRepository`.
 */
export { reportRepository };
