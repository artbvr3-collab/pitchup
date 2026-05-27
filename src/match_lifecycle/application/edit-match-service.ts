/**
 * MODULE: match_lifecycle.application.edit-match-service
 * PURPOSE: Use case — captain edits their match (description, total_spots,
 *          captain_crew, surface, studs_allowed, price, field_booked).
 *          Implements `PATCH /api/matches/:id`: under advisory lock →
 *          captain check → live-status check → optimistic-concurrency check
 *          → surface→studs force-reset (Grass→Hard) → capacity_below_filled
 *          check → UPDATE → if isFull flips true→false (total↑ or stub
 *          removal) → `notifyWatching(triggeredByCaptain=true)`.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository, WatchRepository,
 *                       VenueRepository (surface validation against the chosen
 *                       venue's surface set) + notifyWatching helper +
 *                       withMatchLock
 * CONSUMED BY: app/api/matches/[id]/route.ts (PATCH)
 * INVARIANTS:
 *   - Field whitelist is enforced AT THE HTTP BOUNDARY by
 *     `EditMatchApiSchema` (see dto/edit-match-input.ts). The service
 *     trusts the patch shape — non-editable keys (start_time, duration,
 *     venue_id, cancelled_at, cancel_reason, …) cannot appear here. DO NOT
 *     re-validate the patch keys; this is the canonical whitelist site,
 *     spec match.md §647.
 *   - Optimistic concurrency: `payload.updatedAt.getTime() ===
 *     match.updatedAt.getTime()` UNDER LOCK. Strict `===` after pulling a
 *     fresh `match` row through the lock — guarantees two concurrent
 *     PATCHes can never both succeed (the second sees the first's bumped
 *     `updated_at` from Prisma `@updatedAt`). Comparing `getTime()` rather
 *     than ISO strings sidesteps serialisation drift between Prisma reads
 *     and ISO formats (`...Z` vs `...+00:00`, missing milliseconds, etc.).
 *   - Edit window is live statuses only — Open / AlmostFull / Full
 *     (`cancelled_at IS NULL` AND `now < start_time`). Full is intentionally
 *     included so the captain can raise `total_spots ↑` past the hard cap
 *     to approve an extra pending (spec §628). InProgress / Ended /
 *     Cancelled → `MatchLockedError 409`.
 *   - Surface Grass→Hard force-resets `studsAllowed=false` IN THE SAME tx
 *     (spec §669). Even if the captain sent `studs_allowed: true` in the
 *     same patch, the force-reset wins — studs are always forbidden on
 *     Hard surface. Folded into the patch before `update()`, so the DB
 *     row never holds the invalid combination.
 *   - Surface validation against the venue's surface set: the chosen
 *     `surface` must be a member of `venue.surface`. Re-uses the same
 *     `InvalidSurfaceError` as Layer 3 Create. Read of the venue is a
 *     simple `VenueRepository.findById` — no advisory lock on venues
 *     (admin-managed; not part of match_lifecycle's lock budget).
 *   - `capacity_below_filled` check: `computeSlots(after,
 *     acceptedSlotsBefore).filled <= after.totalSpots`. The fields that
 *     can push filled past total are `totalSpots ↓` or `captainCrew +`
 *     (removing a stub LOWERS filled, never raises it). Accepted players
 *     are counted via the snapshot pulled under lock — guards the race
 *     "Approve + Edit(total↓ or crew+)" from spec matrix.
 *   - notifyWatching fires when `isFull true → false`. Two paths trigger
 *     it: `totalSpots ↑` and stub removal from `captainCrew`. Other paths
 *     (price change, surface flip, description, etc.) cannot change
 *     `filled` or `capacity`, so the helper's own short-circuit handles
 *     them. `triggeredByCaptain: true` — captain self-trigger skip
 *     applies (spec match.md "notify watching" step 4).
 *   - The `description: null` patch value is a deliberate clear (different
 *     from `undefined = don't touch`). All other fields cannot be nulled.
 *   - Material vs non-material classification is in `dto/edit-match-input.ts`
 *     (`MATERIAL_EDIT_FIELDS`). In v1 only surface/studs_allowed/price/
 *     field_booked are editable AND material — the spec also lists
 *     start_time/duration/venue as material but those are not in the
 *     whitelist. Non-material (description, total_spots, captain_crew) is
 *     silent for accepted players — only watching gets a separate channel
 *     via notifyWatching on slot-freeing edits.
 * TODO(Layer 7 — Notifications):
 *   - Compute `changedMaterialFields` (intersection of MATERIAL_EDIT_FIELDS
 *     and the patch keys whose value actually differs from the pre-image)
 *     and, if non-empty, for each accepted JR insert:
 *       notification(type='match_updated', user_id=accepted.userId,
 *         match_id, body=`Match updated: ${changedMaterialFields.join(', ')}`)
 *       INSIDE tx.
 *   - Non-material changes (description / total_spots / captain_crew) →
 *     silent — no notification row. The accepted card refreshes via the
 *     next polling `matches_changed` entry (Layer 7 wires this on the read
 *     side).
 *   - Watching fan-out for `total_spots ↑` / stub removal already wired
 *     inside `notifyWatching` — see TODO markers there. NOT a
 *     `match_updated` notification (spec §654 explicit exception — separate
 *     channel).
 *   - We do NOT send email on edit (spec global.md "Notifications" — only
 *     approve / kick / morning reminder get email).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id/edit", "Per-endpoint
 *     checklist" → PATCH /matches/:id, "Race scenarios — resolution matrix"
 *     → "Approve + Edit(total↓ or crew+)", "Edit (remove stub) + Approve",
 *     "Edit (remove stub) + watching-notify"
 *   - docs/spec/pitchup-spec-global.md → "Total spots — hard cap on approve"
 */
import { asUserId } from "@/src/auth/domain/user";
import { withMatchLock } from "@/src/shared/db/with-match-lock";

import {
  CapacityBelowFilledError,
  ConcurrentModificationError,
  InvalidCrewNameError,
  InvalidSurfaceError,
  MatchLockedError,
  MatchNotFoundError,
  NotCaptainError,
  VenueNotFoundError,
} from "../domain/errors";
import type { JoinRequest } from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import { asMatchId, type Match } from "../domain/match";
import type {
  MatchRepository,
  UpdateMatchPatch,
} from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type { VenueRepository } from "../domain/venue-repository";
import type { WatchRepository } from "../domain/watch-repository";
import { notifyWatching } from "./notify-watching";

export interface EditMatchInputForService {
  readonly matchId: string;
  readonly captainId: string;
  /** Captured under the lock for the optimistic-concurrency comparison. */
  readonly updatedAt: Date;
  readonly patch: UpdateMatchPatch;
}

export interface EditMatchResult {
  readonly status: "updated";
  /** Fresh `updated_at` after the UPDATE. Client echoes it on next edit. */
  readonly updatedAt: Date;
  /** Number of watcher inboxes the helper notified (>=0). */
  readonly notifiedWatcherCount: number;
}

export class EditMatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
    private readonly venueRepository: VenueRepository,
  ) {}

  async execute(
    input: EditMatchInputForService,
    now: Date,
  ): Promise<EditMatchResult> {
    const matchId = asMatchId(input.matchId);
    const captainId = asUserId(input.captainId);

    return withMatchLock(matchId, async (tx) => {
      const match = await this.matchRepository.findById(matchId, tx);
      if (!match) throw new MatchNotFoundError({ matchId });

      // 1. Authorisation — only the captain may edit.
      if (match.captainId !== captainId) {
        throw new NotCaptainError({ matchId, captainId });
      }

      // 2. Live-status check (Open / AlmostFull / Full; reject InProgress /
      //    Ended / Cancelled). Slot info is computed below for the capacity
      //    check; for the status check the slots are part of the
      //    derivation but cancellation + start_time dominate.
      const acceptedBefore =
        await this.joinRequestRepository.listAcceptedForMatch(matchId, tx);
      const acceptedSlotsBefore = sumAcceptedSlots(acceptedBefore);
      const slotsBefore = computeSlots(match, acceptedSlotsBefore);
      const status = deriveMatchStatus(match, slotsBefore, now);
      if (status !== "open" && status !== "almostFull" && status !== "full") {
        throw new MatchLockedError({ matchId, status });
      }

      // 3. Optimistic concurrency — compare under lock against fresh row.
      //    Prisma `@updatedAt` auto-bumps on every UPDATE; the next stale
      //    payload will mismatch naturally.
      if (match.updatedAt.getTime() !== input.updatedAt.getTime()) {
        throw new ConcurrentModificationError({
          matchId,
          payloadUpdatedAt: input.updatedAt.toISOString(),
          dbUpdatedAt: match.updatedAt.toISOString(),
        });
      }

      // 4. Materialise the post-image (apply patch, fold Grass→Hard force
      //    reset, validate captain_crew names + venue surface set). The
      //    post-image is also what we'll write — `finalPatch` carries any
      //    server-side fold-ins so the UPDATE matches the in-memory model.
      const { afterMatch, finalPatch } = await this.applyAndValidatePatch(
        match,
        input.patch,
      );

      // 5. Capacity invariant — accepted players + crew + captain cannot
      //    exceed `total_spots`. Spec §634 — captain UI disables `[−]`
      //    below current filled, but a stale form / concurrent approve
      //    still needs the backend backstop. Race "Approve + Edit(total↓
      //    or crew+)" from spec matrix funnels here.
      const slotsAfter = computeSlots(afterMatch, acceptedSlotsBefore);
      if (slotsAfter.filled > slotsAfter.capacity) {
        throw new CapacityBelowFilledError({
          matchId,
          filled: slotsAfter.filled,
          capacity: slotsAfter.capacity,
        });
      }

      // 6. Persist. `update()` returns the freshly-bumped `updatedAt`.
      const newUpdatedAt = await this.matchRepository.update(
        matchId,
        finalPatch,
        tx,
      );

      // TODO(Layer 7): if changedMaterialFields.length > 0:
      //   for each accepted JR: notification(type='match_updated',
      //     user_id=accepted.userId, match_id,
      //     body=`Match updated: ${changedMaterialFields.join(', ')}`)
      //     INSIDE tx.
      // The diff helper (`computeChangedMaterialFields(match, afterMatch)`)
      // can be derived from the pre/post pair captured above. Non-material
      // fields are intentionally silent for accepted players (spec §653);
      // the watching fan-out below covers the slot-freeing exception.

      // 7. notifyWatching fires when isFull flips true → false. The helper
      //    short-circuits on no-op transitions. Captain self-trigger skip
      //    (spec match.md "notify watching" step 4) — watchers always get
      //    the push, the captain does not (they initiated the action).
      const watch = await notifyWatching(
        { watchRepository: this.watchRepository },
        {
          matchId,
          slotsBefore,
          slotsAfter,
          captainId: match.captainId,
          triggeredByCaptain: true,
          tx,
        },
      );

      return {
        status: "updated" as const,
        updatedAt: newUpdatedAt,
        notifiedWatcherCount: watch.watcherUserIds.length,
      };
    });
  }

  /**
   * Materialise the post-image of the match + return the patch to persist.
   * Folds in the Grass→Hard `studs_allowed=false` invariant and validates
   * field-level constraints that depend on database state (venue surface
   * set, crew name normalisation). Pure helper modulo the venue read —
   * deliberately not pulled out to a top-level function because every
   * branch needs access to the validated patch shape.
   */
  private async applyAndValidatePatch(
    match: Match,
    patch: UpdateMatchPatch,
  ): Promise<{ readonly afterMatch: Match; readonly finalPatch: UpdateMatchPatch }> {
    const finalPatch: { -readonly [K in keyof UpdateMatchPatch]: UpdateMatchPatch[K] } =
      { ...patch };

    // captain_crew — trim + reject blank-after-trim + max-length 30.
    // Spec global.md "Text field validation". Duplicates allowed.
    if (finalPatch.captainCrew !== undefined) {
      const normalised: string[] = [];
      for (const raw of finalPatch.captainCrew) {
        const trimmed = raw.trim();
        if (trimmed.length === 0 || trimmed.length > 30) {
          throw new InvalidCrewNameError({
            matchId: match.id,
            value: raw,
          });
        }
        normalised.push(trimmed);
      }
      finalPatch.captainCrew = normalised;
    }

    // surface validation against venue.surface set (re-use of Layer 3
    // logic). Only run when the patch actually changes surface; saving
    // venue-read latency on no-op patches.
    if (finalPatch.surface !== undefined && finalPatch.surface !== match.surface) {
      const venue = await this.venueRepository.findById(match.venueId);
      if (!venue) throw new VenueNotFoundError({ venueId: match.venueId });
      if (!venue.surface.includes(finalPatch.surface)) {
        throw new InvalidSurfaceError({
          matchId: match.id,
          requested: finalPatch.surface,
          available: venue.surface,
        });
      }
    }

    // Grass → Hard force-resets studs_allowed (spec §669). Applies even
    // when the patch did not include `studs_allowed` (the resulting row
    // would otherwise hold an invalid combination). When the patch did
    // include `studs_allowed: true`, the force-reset still wins.
    const effectiveSurface = finalPatch.surface ?? match.surface;
    if (effectiveSurface === "hard") {
      finalPatch.studsAllowed = false;
    }

    // Materialise the post-image as a `Match` shape so callers (capacity
    // check, notifyWatching slots) can use the same `computeSlots` and
    // `deriveMatchStatus` helpers without branching.
    const afterMatch: Match = {
      ...match,
      ...(finalPatch.description !== undefined
        ? { description: finalPatch.description }
        : {}),
      ...(finalPatch.totalSpots !== undefined
        ? { totalSpots: finalPatch.totalSpots }
        : {}),
      ...(finalPatch.captainCrew !== undefined
        ? { captainCrew: finalPatch.captainCrew }
        : {}),
      ...(finalPatch.surface !== undefined
        ? { surface: finalPatch.surface }
        : {}),
      ...(finalPatch.studsAllowed !== undefined
        ? { studsAllowed: finalPatch.studsAllowed }
        : {}),
      ...(finalPatch.price !== undefined ? { price: finalPatch.price } : {}),
      ...(finalPatch.fieldBooked !== undefined
        ? { fieldBooked: finalPatch.fieldBooked }
        : {}),
    };

    return { afterMatch, finalPatch };
  }
}

function sumAcceptedSlots(requests: readonly JoinRequest[]): number {
  let total = 0;
  for (const r of requests) total += 1 + r.guestCount;
  return total;
}
