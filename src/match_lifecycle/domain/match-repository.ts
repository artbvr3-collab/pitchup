/**
 * MODULE: match_lifecycle.domain.match-repository
 * PURPOSE: Repository port for the Match aggregate. Domain owns the contract;
 *          infrastructure provides the Prisma-backed adapter.
 *          Layer 2.5 scope: filtered + paged Discover. `findDiscoverPage()`
 *          accepts a fully-resolved filter DTO (date already clamped to the
 *          21-day horizon, cursor decoded) and returns one page plus an
 *          optional `nextCursor` for "Show more".
 *          Layer 3 scope: `create()` inserts a new Match row. No advisory
 *          lock is taken — the id doesn't exist yet (spec: "Concurrency &
 *          locking" → exceptions).
 *          Layer 4 scope: `findById(id, tx?)` — read a single match by id,
 *          optionally inside a caller-controlled transaction (advisory-lock
 *          critical section). No separate `findByIdForUpdate` because the
 *          advisory lock already serializes mutations on the match;
 *          `SELECT ... FOR UPDATE` would be theatre on top.
 * LAYER: domain
 * DEPENDENCIES: ./match, src/auth/domain/user
 * CONSUMED BY: src/match_lifecycle/application/list-discover-matches.ts,
 *              src/match_lifecycle/application/create-match-service.ts,
 *              src/match_lifecycle/infrastructure/prisma-match-repository.ts
 * INVARIANTS:
 *   - Sort order is `startTime ASC, id ASC` — stable for keyset pagination.
 *   - Cancelled matches (cancelledAt IS NOT NULL) are excluded.
 *   - Past matches (startTime < `now`) are excluded; the day-window already
 *     restricts to a future Prague day, but `now` is honored explicitly so
 *     "today" still hides games that have already kicked off.
 *   - The `distanceKm` filter requires a `location` — when absent it is
 *     silently ignored (per spec). The repository never throws on missing
 *     location; the UI surfaces a banner separately.
 *   - `create()` returns the persisted `MatchId`; the row's `coverId` is the
 *     snapshot value passed in (callers resolve it from the chosen venue).
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games",
 *               docs/spec/pitchup-spec-match.md → "/matches/new",
 *               docs/ARCHITECTURE.md §8, ADR-0003.
 */
import type { UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";
import type { Match, MatchId, MatchWithVenue } from "./match";
import type { Surface, VenueId } from "./venue";

export type DiscoverTimeOfDay = "morning" | "afternoon" | "evening";
export type DiscoverSpotsBucket = "1" | "2-3" | "4+";

export interface DiscoverLocation {
  readonly lat: number;
  readonly lng: number;
}

export interface DiscoverCursorInput {
  readonly startTime: Date;
  readonly id: string;
}

export interface FindDiscoverPageOptions {
  /** Reference time; matches whose startTime < `now` are excluded. */
  readonly now: Date;
  /** Half-open UTC interval for the selected Prague calendar day. */
  readonly dayUtcStart: Date;
  readonly dayUtcEnd: Date;
  /** Page size (caller-controlled; spec default = 50). */
  readonly limit: number;
  /** Keyset cursor (last seen row), `null` = first page. */
  readonly cursor: DiscoverCursorInput | null;
  /** Empty array = any time-of-day. */
  readonly timeOfDay: readonly DiscoverTimeOfDay[];
  /** N-a-side chips (mapped to `total_spots` bands by the adapter). */
  readonly gameSize: readonly number[];
  /** Spots-left bucket; `null` = Any (includes full). */
  readonly spotsLeft: DiscoverSpotsBucket | null;
  /** Price = 0 filter. */
  readonly freeOnly: boolean;
  /** Field-booked-only filter. */
  readonly fieldBookedOnly: boolean;
  /** Case-insensitive venue-name substring. Empty = no filter. */
  readonly venueSearch: string;
  /** Radius (km) from `location`. `null` = no distance filter. */
  readonly distanceKm: number | null;
  /** Required iff `distanceKm` should be honored; otherwise filter is dropped. */
  readonly location: DiscoverLocation | null;
}

export interface FindDiscoverPageResult {
  readonly rows: readonly MatchWithVenue[];
  /** Cursor to pass back for the next page; `null` when there is no next. */
  readonly nextCursor: DiscoverCursorInput | null;
}

export interface CreateMatchPersistenceInput {
  readonly captainId: UserId;
  readonly venueId: VenueId;
  readonly startTime: Date;
  readonly duration: number;
  readonly totalSpots: number;
  readonly price: number;
  readonly surface: Surface;
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly description: string | null;
  readonly captainCrew: readonly string[];
  /** Snapshot of `venue.coverId` taken at INSERT time. Immutable thereafter. */
  readonly coverId: string;
}

/**
 * Layer 6.5 — patch shape for `PATCH /matches/:id` (captain edit). Every
 * field is optional; `undefined` means "don't touch". Field whitelist is
 * enforced at the HTTP boundary via a Zod schema — the service receives
 * only allowed keys (description, totalSpots, captainCrew, surface,
 * studsAllowed, price, fieldBooked). `description: null` is a deliberate
 * clear (different from `undefined`); other fields cannot be nulled.
 * Spec match.md → "/matches/:id/edit" → "What can be changed".
 */
export interface UpdateMatchPatch {
  readonly description?: string | null;
  readonly totalSpots?: number;
  readonly captainCrew?: readonly string[];
  readonly surface?: Surface;
  readonly studsAllowed?: boolean;
  readonly price?: number;
  readonly fieldBooked?: boolean;
}

/**
 * Layer 8 — map view options (no date filter, no cursor; returns all matches
 * in the 21-day Prague horizon that pass the sheet filters).
 */
export interface FindMapMatchesOptions {
  readonly now: Date;
  /** UTC end of today+20 Prague day (inclusive horizon boundary). */
  readonly horizonUtcEnd: Date;
  readonly timeOfDay: readonly DiscoverTimeOfDay[];
  readonly gameSize: readonly number[];
  readonly spotsLeft: DiscoverSpotsBucket | null;
  readonly freeOnly: boolean;
  readonly fieldBookedOnly: boolean;
  readonly venueSearch: string;
  readonly distanceKm: number | null;
  readonly location: DiscoverLocation | null;
}

export interface FindMapMatchesResult {
  readonly rows: readonly MatchWithVenue[];
}

export interface MatchRepository {
  findDiscoverPage(
    options: FindDiscoverPageOptions,
  ): Promise<FindDiscoverPageResult>;
  create(input: CreateMatchPersistenceInput): Promise<MatchId>;
  /**
   * Read a single match by id. Pass `tx` from `withMatchLock` to read under
   * the advisory lock; omit it for unlocked reads (e.g. future detail page).
   */
  findById(id: MatchId, tx?: TransactionClient): Promise<Match | null>;

  /**
   * Layer 6 — all matches the user is captain of, any status (live + past +
   * cancelled). Joined with venue. Used by `ListMyMatchesService` to render
   * Section Captain (live statuses) and to surface captain history in
   * Section Past. Returned in `start_time ASC` order so callers can both
   * walk-forward for Captain section and re-sort DESC for Past.
   */
  findCaptainMatches(userId: UserId): Promise<readonly MatchWithVenue[]>;

  /**
   * Layer 6 — batch lookup by id. Returned in arbitrary order; missing ids
   * are simply absent. Joined with venue. Used by `ListMyMatchesService` to
   * resolve matches referenced by JoinRequest / Watch listings without N
   * round-trips. Mirrors the convention from `UserRepository.findByIds`.
   */
  findByIds(ids: readonly MatchId[]): Promise<readonly MatchWithVenue[]>;

  /**
   * Layer 6.5 — apply a partial update to the editable subset of fields.
   * Caller (under lock) is responsible for: optimistic-concurrency check
   * (compare `match.updatedAt` vs payload `updated_at`), capacity check
   * (`computeSlots(after).filled <= total`), surface→studs force-reset
   * (already folded into the patch by the service before calling).
   *
   * The `@updatedAt` Prisma decorator on `Match.updated_at` auto-bumps the
   * column on every UPDATE — that is how the optimistic-concurrency check
   * advances for the next stale payload. Returns the new `updatedAt` so the
   * service can echo it back to the client (avoids a re-read).
   */
  update(
    id: MatchId,
    patch: UpdateMatchPatch,
    tx: TransactionClient,
  ): Promise<Date>;

  /**
   * Layer 6.5 — mark the match as Cancelled. Writes `cancelled_at = now()`
   * and the captain-supplied `cancel_reason` (already NFC-normalized + trim
   * + length-checked by the service). Idempotency / start-time guards live
   * in the service (`AlreadyCancelledError` / `MatchAlreadyStartedError`);
   * this method is unconditional UPDATE.
   */
  cancel(
    id: MatchId,
    cancelReason: string,
    tx: TransactionClient,
  ): Promise<void>;

  /**
   * Layer 7.5 — captain's upcoming, not-yet-cancelled matches. Predicate:
   * `captainId = $userId AND cancelled_at IS NULL AND start_time > $now`.
   * Used by:
   *   1. `DeleteAccountService` cascade — iterates and re-cancels each one
   *      through the existing `CancelMatchService` so the per-match lock,
   *      mass-reject, watch wipe, and notification fan-out all happen.
   *   2. `/me` page rendering — `.length` feeds the "N upcoming match(es)"
   *      figure in the delete-confirm modal (spec personal.md §147).
   *
   * Excludes InProgress matches per spec global.md "Ghost match" — they
   * continue normally; the captain just becomes `[Removed user]` on Lineup.
   * Excludes already-cancelled rows so a retry after a partial cascade
   * doesn't re-enter `CancelMatchService` (which would throw
   * `AlreadyCancelledError`; we'd swallow, but skipping at fetch-time is
   * cheaper).
   *
   * Returns plain `Match[]` (no venue join) — the cascade only needs ids,
   * and the modal copy only needs the count.
   */
  findUpcomingByCaptain(
    userId: UserId,
    now: Date,
  ): Promise<readonly Match[]>;

  /**
   * Layer 7b cron #3 (auto-reject pending on match start, every 5 min):
   * return the distinct ids of matches whose `start_time <= now` AND which
   * still have at least one `JoinRequest.status='pending'` row. Service
   * then iterates the list and processes each match under its own
   * advisory lock.
   *
   * Returned in arbitrary order; caller doesn't sort. Empty array is a
   * normal outcome (no eligible matches in this 5-min window) and short-
   * circuits the cron loop.
   *
   * Unlocked read — no transaction. Spec match.md → "Cron jobs → Cron
   * auto-reject pending on match start" + per-endpoint checklist → "Cron
   * auto-reject pending".
   */
  findMatchIdsWithPendingStartedBefore(
    now: Date,
  ): Promise<readonly MatchId[]>;

  /**
   * Layer 7b crons #1 and #2 (morning-of-match reminder, 10:00 / 20:00
   * Europe/Prague): return every match whose `start_time` falls within the
   * half-open UTC interval `[start, end)` AND that is not cancelled.
   *
   * Cancelled matches are excluded because their accepted players were
   * already told via the `match_cancelled` flow; a "Match today" reminder
   * for a cancelled match would be wrong.
   *
   * Returned in arbitrary order; caller doesn't sort. Empty array is a
   * normal outcome (low-traffic 12-hour window) and short-circuits the
   * cron loop.
   *
   * Unlocked read — no transaction.
   */
  findActiveStartingInWindow(
    start: Date,
    end: Date,
  ): Promise<readonly Match[]>;

  /**
   * Layer 8 — map view. Returns every non-cancelled, non-past match within
   * the 21-day Prague horizon that passes the sheet filters. No pagination —
   * the map renders all pins at once. The caller decorates each row with
   * `computeSlots` + `deriveMatchStatus` and filters out Cancelled / Ended.
   */
  findMapMatches(options: FindMapMatchesOptions): Promise<FindMapMatchesResult>;

  /**
   * Layer 9c — admin match list. Returns all matches (any status, including
   * Cancelled + Ended) with venue join, captain info, and accepted slot count
   * for the "participants" column. Capped at 200 rows (no pagination, same
   * policy as `listForAdmin` in UserRepository). Optional filters:
   *   - `search`: case-insensitive substring on venue name or captain name.
   *   - `status`: whitelist of match statuses derived on-read; if empty all
   *     statuses are included.
   * Sorted `start_time DESC` (most recent / future first) so the admin sees
   * today's matches at the top.
   */
  findForAdmin(options: FindForAdminOptions): Promise<readonly AdminMatchRow[]>;

  /**
   * Layer 9d — batch admin-row lookup by id. Same `AdminMatchRow` shape as
   * `findForAdmin` (venue name, captain, accepted count, hide flags, etc.) but
   * keyed on a set of ids and unsorted/uncapped. Used by `ListAdminReports
   * Service` to resolve every match-report target in one query (status +
   * hide-flag state for the Review modal). Missing ids are simply absent.
   */
  findForAdminByIds(ids: readonly string[]): Promise<readonly AdminMatchRow[]>;

  /**
   * Layer 9c — no-lock update for the admin hide-flag pair
   * (`description_hidden`, `cancel_reason_hidden`). Only the provided keys
   * are updated; `undefined` means "don't touch". No advisory lock — admin
   * single-tab, these flags have no invariants requiring serialization.
   * Returns `null` when the match does not exist.
   */
  updateFlags(
    id: MatchId,
    flags: UpdateMatchFlags,
  ): Promise<{ descriptionHidden: boolean; cancelReasonHidden: boolean } | null>;
}

/** Options for the admin match list query. */
export interface FindForAdminOptions {
  readonly now: Date;
  readonly search: string;
  /** Empty array = any status. */
  readonly statusFilter: readonly string[];
  readonly limit: number;
}

/** Wire shape for one admin match table row. */
export interface AdminMatchRow {
  readonly id: string;
  readonly venueName: string;
  readonly captainName: string;
  readonly captainId: string;
  readonly startTime: Date;
  readonly duration: number;
  readonly totalSpots: number;
  readonly captainCrewLength: number;
  readonly acceptedCount: number;
  readonly cancelledAt: Date | null;
  readonly description: string | null;
  readonly descriptionHidden: boolean;
  readonly cancelReason: string | null;
  readonly cancelReasonHidden: boolean;
  readonly updatedAt: Date;
}

/** No-lock flag update for admin hide-text. */
export interface UpdateMatchFlags {
  readonly descriptionHidden?: boolean;
  readonly cancelReasonHidden?: boolean;
}
