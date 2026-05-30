/**
 * MODULE: notifications.composition
 * PURPOSE: Composition root for the `notifications` bounded context. Wires the
 *          notification repository + the match_lifecycle repositories into the
 *          `UpdatesStateService` that `app/api/updates/state` imports.
 * LAYER: composition (cross-layer wiring)
 * DEPENDENCIES: ./application/*, ./infrastructure/*,
 *               src/match_lifecycle/infrastructure/repositories
 * CONSUMED BY: app/api/updates/state/route.ts
 * INVARIANTS:
 *   - Imported only from `app/`. Cross-context infra wiring (pulling the
 *     match_lifecycle repository singletons) is allowed in a composition root —
 *     mirrors match_lifecycle/composition pulling auth + chat repositories.
 * RELATED DOCS: docs/ARCHITECTURE.md §3 (dependency direction), §10 (polling).
 */
import { userRepository } from "@/src/auth/infrastructure/repositories";
import {
  adminMatchDeletionRepository,
  joinRequestRepository,
  matchRepository,
  watchRepository,
} from "@/src/match_lifecycle/infrastructure/repositories";
import { appBaseUrl } from "@/src/shared/config/env";

import { InboxTtlService } from "./application/inbox-ttl-service";
import { MorningReminderService } from "./application/morning-reminder-service";
import { UpdatesStateService } from "./application/updates-state-service";
import { emailSender } from "./infrastructure/email-sender";
import {
  notificationRepository,
  reminderSentRepository,
} from "./infrastructure/repositories";

export const updatesStateService = new UpdatesStateService(
  notificationRepository,
  matchRepository,
  joinRequestRepository,
  watchRepository,
  adminMatchDeletionRepository,
);

export const inboxTtlService = new InboxTtlService({
  notifications: notificationRepository,
  reminders: reminderSentRepository,
  watches: watchRepository,
  adminMatchDeletions: adminMatchDeletionRepository,
});

export const morningReminderService = new MorningReminderService({
  matches: matchRepository,
  joinRequests: joinRequestRepository,
  notifications: notificationRepository,
  reminders: reminderSentRepository,
  users: userRepository,
  emailSender,
  appBaseUrl,
});
