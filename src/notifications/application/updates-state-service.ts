/**
 * MODULE: notifications.application.updates-state-service
 * PURPOSE: Cross-context read-model assembler for the global poll
 *          `GET /api/updates/state`. Builds the wire payload
 *          `{ has_unread_notifications, new_notifications[], matches_changed[] }`
 *          (spec global.md → "Polling sync" → "Global poll"). Pure read — no
 *          mutation, no lock.
 * LAYER: application (cross-context: imports match_lifecycle/domain ports +
 *        deriveMatchChange, same pattern as MatchStateService importing
 *        chat/auth — application-layer composition across contexts is allowed).
 * DEPENDENCIES (ports): NotificationRepository (own context), MatchRepository,
 *                       JoinRequestRepository, WatchRepository (match_lifecycle)
 * CONSUMED BY: app/api/updates/state/route.ts
 * INVARIANTS:
 *   - `has_unread_notifications` is a boolean (red dot), never a count.
 *   - `new_notifications`: on FIRST poll (`since === null`) → the latest 20
 *     rows; on a delta poll → those of the latest 20 with `created_at > since`.
 *     We reuse `listRecent(20)` rather than a dedicated `listCreatedAfter`
 *     query: at v1 scale a 15-second window never produces >20 notifications,
 *     so the filter is exact in practice. The pathological "21+ new in one
 *     interval" case would still show every row in the panel (it reads the
 *     same 20) and keep the red dot lit — only a browser popup for the 21st+
 *     would be skipped. Acceptable; revisit with a `listCreatedAfter` port
 *     method if telemetry ever shows bursts.
 *   - `matches_changed`: EMPTY on the first poll (`since === null`). The RSC
 *     already rendered current state on page load; deltas start from the first
 *     `since`. This avoids a redundant `router.refresh()` on every fresh tab.
 *     On a delta poll we scan the viewer's full relationship set (captain
 *     matches + JoinRequests + watches — same fetch shape as
 *     ListMyMatchesService) and emit one entry per match whose JoinRequest or
 *     Match row changed since `since` (see `deriveMatchChange`). O(N) over the
 *     user's history per poll — acceptable for a personal endpoint.
 *   - Watching transitions are NOT emitted (deriveMatchChange skips them);
 *     watchers learn of a freed slot via the `spot_opened` notification in
 *     `new_notifications` (spec §448).
 *   - The 401-on-banned/deleted gate lives in `requireAuth` at the route, not
 *     here — this service is a pure read callable for any valid userId.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Polling sync" (payload shape,
 *     action enum, my_status table), docs/ARCHITECTURE.md §10
 */
import { asUserId, type UserId } from "@/src/auth/domain/user";

import {
  deriveMatchChange,
  type MatchChange,
  type MatchChangeAction,
  type PollMyStatus,
} from "@/src/match_lifecycle/domain/derive-match-change";
import type { JoinRequest } from "@/src/match_lifecycle/domain/join-request";
import type { JoinRequestRepository } from "@/src/match_lifecycle/domain/join-request-repository";
import { asMatchId, type MatchWithVenue } from "@/src/match_lifecycle/domain/match";
import type { MatchRepository } from "@/src/match_lifecycle/domain/match-repository";
import type { WatchRepository } from "@/src/match_lifecycle/domain/watch-repository";

import type { NotificationRow, NotificationType } from "../domain/notification";
import type { NotificationRepository } from "../domain/notification-repository";

export interface UpdatesStateInput {
  readonly userId: string;
  /** Cursor of the previous successful poll; `null` on first poll / reload. */
  readonly since: Date | null;
}

export interface UpdatesStateNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly match_id: string | null;
  readonly body: string;
  readonly ts: string;
}

export interface UpdatesStateMatchChanged {
  readonly match_id: string;
  readonly my_status: PollMyStatus;
  readonly action: MatchChangeAction;
}

export interface UpdatesStateResponse {
  readonly has_unread_notifications: boolean;
  readonly new_notifications: readonly UpdatesStateNotification[];
  readonly matches_changed: readonly UpdatesStateMatchChanged[];
}

export class UpdatesStateService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
  ) {}

  async execute(input: UpdatesStateInput): Promise<UpdatesStateResponse> {
    const userId = asUserId(input.userId);
    const { since } = input;

    const [hasUnread, recent, matchesChanged] = await Promise.all([
      this.notificationRepository.hasUnread(userId),
      this.notificationRepository.listRecent(userId, 20),
      since === null
        ? Promise.resolve<readonly MatchChange[]>([])
        : this.buildMatchesChanged(userId, since),
    ]);

    const newNotifications = (
      since === null ? recent : recent.filter((n) => n.createdAt > since)
    ).map(toWireNotification);

    return {
      has_unread_notifications: hasUnread,
      new_notifications: newNotifications,
      matches_changed: matchesChanged.map((c) => ({
        match_id: c.matchId,
        my_status: c.myStatus,
        action: c.action,
      })),
    };
  }

  private async buildMatchesChanged(
    userId: UserId,
    since: Date,
  ): Promise<readonly MatchChange[]> {
    const [captainMatches, joinRequests, watchedMatchIds] = await Promise.all([
      this.matchRepository.findCaptainMatches(userId),
      this.joinRequestRepository.listForUser(userId),
      this.watchRepository.listMatchIdsForUser(userId),
    ]);

    // Build a single map of every match the viewer relates to.
    const matchById = new Map<string, MatchWithVenue>();
    for (const m of captainMatches) matchById.set(m.id, m);

    const referenced = new Set<string>();
    for (const jr of joinRequests) referenced.add(jr.matchId);
    for (const id of watchedMatchIds) referenced.add(id);
    const missing = [...referenced].filter((id) => !matchById.has(id));
    if (missing.length > 0) {
      const more = await this.matchRepository.findByIds(missing.map(asMatchId));
      for (const m of more) matchById.set(m.id, m);
    }

    const jrByMatch = new Map<string, JoinRequest>();
    for (const jr of joinRequests) jrByMatch.set(jr.matchId, jr);
    const watchSet = new Set<string>(watchedMatchIds);

    const changes: MatchChange[] = [];
    for (const [matchId, match] of matchById) {
      const jr = jrByMatch.get(matchId) ?? null;
      const change = deriveMatchChange({
        matchId,
        matchUpdatedAt: match.updatedAt,
        matchCancelledAt: match.cancelledAt,
        isCaptain: match.captainId === userId,
        joinRequest: jr
          ? { status: jr.status, autoReason: jr.autoReason, updatedAt: jr.updatedAt }
          : null,
        hasWatchRecord: watchSet.has(matchId),
        since,
      });
      if (change) changes.push(change);
    }
    return changes;
  }
}

function toWireNotification(n: NotificationRow): UpdatesStateNotification {
  return {
    id: n.id,
    type: n.type,
    match_id: n.matchId,
    body: n.body,
    ts: n.createdAt.toISOString(),
  };
}
