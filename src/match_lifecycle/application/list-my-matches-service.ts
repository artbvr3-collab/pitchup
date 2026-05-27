/**
 * MODULE: match_lifecycle.application.list-my-matches-service
 * PURPOSE: Cross-aggregate read-model assembler for `/my-matches`. Composes
 *          ports from match_lifecycle (match + join_request + watch + the
 *          existing pending-count read used by the captain section) into a
 *          single `MyMatchesPage` DTO. Bucketing into Captain / Upcoming /
 *          Past follows spec personal.md → "/my-matches" non-overlap rules.
 *
 *          `executePastPage` is the companion method called by the
 *          `GET /api/my-matches/past?cursor=` endpoint when the user taps
 *          `[Show more]`. Same data sources, just sliced by the keyset
 *          cursor on `(start_time DESC, id ASC)`.
 *
 *          Mirrors the cross-aggregate-assembler pattern established by
 *          `MatchStateService` (Layer 5) — application layer is allowed to
 *          compose ports from sibling contexts.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository.findCaptainMatches / findByIds,
 *                       JoinRequestRepository.listForUser /
 *                         listPendingForMatch / listAcceptedForMatch,
 *                       WatchRepository.listMatchIdsForUser
 * CONSUMED BY: app/(private)/my-matches/page.tsx (RSC initial snapshot),
 *              app/api/my-matches/past/route.ts (incremental Past page)
 * INVARIANTS:
 *   - Non-overlap: a match appears in AT MOST one of Captain / Upcoming /
 *     Past. Spec personal.md rule "Ended and Cancelled captain matches
 *     appear EXCLUSIVELY in Section Past with a Captain mini-badge".
 *   - Section Upcoming excludes `👀 Watching` cards when the match is
 *     InProgress (spec personal.md "Watching card disappears from Upcoming
 *     when the match transitions to InProgress").
 *   - Section Upcoming includes accepted players on InProgress matches —
 *     they're still "in the match" (spec "InProgress matches: the card
 *     stays in Section Upcoming, does not move to Past"). The card UI
 *     shows a 🔴 In progress indicator.
 *   - Pending on past/cancelled matches always goes to Past (with
 *     "Request declined · match started" / "...match was cancelled"
 *     sub-label). Captain mass-reject and cron auto-reject both flip
 *     `JoinRequest.status` to `rejected`, so by the time the card is
 *     fetched here the user-status branch already produces the right
 *     bucket.
 *   - Per-match `pendingCount` is fetched ONLY for live captain matches —
 *     N+1 read but capped at the small number of live captain matches a
 *     user has at once. Non-captain cards carry `pendingCount: null`.
 *   - Slot math + match status are computed via the canonical helpers
 *     (`computeSlots`, `deriveMatchStatus`) per AGENTS gotcha "Don't
 *     recompute slot math or match status".
 *   - Past pagination is in-memory keyset over the assembled set:
 *     1. Fetch ALL user's matches across the three sources.
 *     2. Bucket into Past (status ∈ {ended, cancelled} ∨ JR.status ∈
 *        {rejected, cancelled (self), left, kicked}).
 *     3. Sort `start_time DESC, id ASC`, apply cursor predicate, slice
 *        first `limit`.
 *     This is O(N) over the user's full history per call — acceptable for
 *     a personal page (history bounded in practice). When the SQL-side
 *     optimisation becomes necessary, it lands as a single raw-SQL method
 *     on `MatchRepository`; the DTO contract stays the same.
 *   - Likes reminder is empty for Layer 6 (Like aggregate ships in
 *     Layer 6.X).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/my-matches" (sections,
 *     non-overlap rules, sub-labels, [Show more])
 *   - docs/spec/pitchup-spec-global.md → "Polling sync" → my_status,
 *     "Slot math"
 */
import type { UserId } from "@/src/auth/domain/user";

import {
  deriveMyStatus,
  type MyStatus,
} from "../domain/derive-my-status";
import type { JoinRequest } from "../domain/join-request";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import type { MatchId, MatchWithVenue } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus, type MatchStatus } from "../domain/match-status";
import { computeSlots, type SlotInfo } from "../domain/slot-math";
import type { WatchRepository } from "../domain/watch-repository";
import {
  MY_MATCHES_PAST_PAGE_SIZE,
  type MyMatchCardDto,
  type MyMatchesPage,
  type MyMatchesPastCursor,
  type MyMatchesPastPage,
} from "./dto/my-matches";

export interface ListMyMatchesInput {
  readonly userId: UserId;
}

export interface ListMyMatchesPastInput {
  readonly userId: UserId;
  readonly cursor: MyMatchesPastCursor | null;
  /** Defaults to `MY_MATCHES_PAST_PAGE_SIZE`. */
  readonly limit?: number;
}

/**
 * Intermediate per-match envelope used during bucketing. Carries everything
 * needed to derive the final DTO without re-fetching.
 */
interface RawCard {
  readonly match: MatchWithVenue;
  readonly slots: SlotInfo;
  readonly matchStatus: MatchStatus;
  readonly myStatus: MyStatus;
  readonly isCaptain: boolean;
  readonly joinRequestStatus: MyMatchCardDto["joinRequestStatus"];
  readonly joinRequestAutoReason: MyMatchCardDto["joinRequestAutoReason"];
  readonly hasWatch: boolean;
  readonly pendingCount: number | null;
}

export class ListMyMatchesService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
  ) {}

  async execute(
    input: ListMyMatchesInput,
    now: Date,
  ): Promise<MyMatchesPage> {
    const cards = await this.assembleAllCards(input.userId, now);

    const captain: MyMatchCardDto[] = [];
    const upcoming: MyMatchCardDto[] = [];
    const past: MyMatchCardDto[] = [];

    for (const c of cards) {
      const dto = toDto(c);
      const bucket = bucketFor(c);
      if (bucket === "captain") captain.push(dto);
      else if (bucket === "upcoming") upcoming.push(dto);
      else past.push(dto);
    }

    captain.sort(sortByStartAsc);
    upcoming.sort(sortByStartAsc);
    past.sort(sortByStartDesc);

    const limit = MY_MATCHES_PAST_PAGE_SIZE;
    const firstPage = past.slice(0, limit);
    const nextCursor =
      past.length > limit ? cursorFor(firstPage[firstPage.length - 1]!) : null;

    return {
      captain,
      upcoming,
      past: firstPage,
      pastCursor: nextCursor,
      // Layer 6.X — Like aggregate doesn't exist yet.
      likesReminder: [],
    };
  }

  async executePastPage(
    input: ListMyMatchesPastInput,
    now: Date,
  ): Promise<MyMatchesPastPage> {
    const limit = input.limit ?? MY_MATCHES_PAST_PAGE_SIZE;
    const cards = await this.assembleAllCards(input.userId, now);

    const past: MyMatchCardDto[] = [];
    for (const c of cards) {
      if (bucketFor(c) === "past") past.push(toDto(c));
    }
    past.sort(sortByStartDesc);

    const filtered = input.cursor
      ? past.filter((row) => isStrictlyAfter(row, input.cursor!))
      : past;

    const page = filtered.slice(0, limit);
    const nextCursor =
      filtered.length > limit ? cursorFor(page[page.length - 1]!) : null;

    return { rows: page, pastCursor: nextCursor };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async assembleAllCards(
    userId: UserId,
    now: Date,
  ): Promise<readonly RawCard[]> {
    // 1. Fan out the three independent reads.
    const [captainMatches, joinRequests, watchMatchIds] = await Promise.all([
      this.matchRepository.findCaptainMatches(userId),
      this.joinRequestRepository.listForUser(userId),
      this.watchRepository.listMatchIdsForUser(userId),
    ]);

    // 2. Collect extra match ids (from JR + Watch) that aren't already in
    //    captainMatches.
    const captainIdSet = new Set<string>(captainMatches.map((m) => m.id));
    const jrByMatch = new Map<MatchId, JoinRequest>();
    for (const jr of joinRequests) jrByMatch.set(jr.matchId, jr);

    const extraIds = new Set<MatchId>();
    for (const jr of joinRequests) {
      if (!captainIdSet.has(jr.matchId)) extraIds.add(jr.matchId);
    }
    for (const id of watchMatchIds) {
      if (!captainIdSet.has(id)) extraIds.add(id);
    }

    const extraMatches = await this.matchRepository.findByIds([...extraIds]);
    const watchIdSet = new Set<string>(watchMatchIds);

    const allMatches: MatchWithVenue[] = [...captainMatches, ...extraMatches];

    // 3. Fetch accepted slots per match in parallel (N round-trips, capped
    //    by typical history size; acceptable per service-header invariant).
    const acceptedSlotPerMatch = await this.fetchAcceptedSlotsByMatch(
      allMatches,
    );

    // 4. Fetch pending count only for LIVE captain matches.
    const pendingCountByMatch = await this.fetchPendingCountsForLiveCaptain(
      captainMatches,
      acceptedSlotPerMatch,
      now,
    );

    // 5. Build RawCard envelopes.
    const cards: RawCard[] = [];
    for (const match of allMatches) {
      const isCaptain = match.captainId === userId;
      const jr = jrByMatch.get(match.id) ?? null;
      const hasWatch = watchIdSet.has(match.id);
      const acceptedSlots = acceptedSlotPerMatch.get(match.id) ?? 0;
      const slots = computeSlots(match, acceptedSlots);
      const matchStatus = deriveMatchStatus(match, slots, now);
      const myStatus = deriveMyStatus({
        joinRequestStatus: jr?.status ?? null,
        hasWatchRecord: hasWatch,
        matchCancelledAt: match.cancelledAt,
      });
      const pendingCount =
        isCaptain && isLiveStatus(matchStatus)
          ? pendingCountByMatch.get(match.id) ?? 0
          : null;

      cards.push({
        match,
        slots,
        matchStatus,
        myStatus,
        isCaptain,
        joinRequestStatus: jr?.status ?? null,
        joinRequestAutoReason: jr?.autoReason ?? null,
        hasWatch,
        pendingCount,
      });
    }
    return cards;
  }

  private async fetchAcceptedSlotsByMatch(
    matches: readonly MatchWithVenue[],
  ): Promise<Map<MatchId, number>> {
    const entries = await Promise.all(
      matches.map(
        async (m): Promise<[MatchId, number]> => {
          const rows =
            await this.joinRequestRepository.listAcceptedForMatch(m.id);
          let total = 0;
          for (const r of rows) total += 1 + r.guestCount;
          return [m.id, total];
        },
      ),
    );
    return new Map(entries);
  }

  private async fetchPendingCountsForLiveCaptain(
    captainMatches: readonly MatchWithVenue[],
    acceptedSlots: ReadonlyMap<MatchId, number>,
    now: Date,
  ): Promise<Map<MatchId, number>> {
    const live = captainMatches.filter((m) => {
      const slots = computeSlots(m, acceptedSlots.get(m.id) ?? 0);
      const status = deriveMatchStatus(m, slots, now);
      return isLiveStatus(status);
    });
    const entries = await Promise.all(
      live.map(
        async (m): Promise<[MatchId, number]> => {
          const rows =
            await this.joinRequestRepository.listPendingForMatch(m.id);
          return [m.id, rows.length];
        },
      ),
    );
    return new Map(entries);
  }
}

function isLiveStatus(status: MatchStatus): boolean {
  return (
    status === "open" ||
    status === "almostFull" ||
    status === "full" ||
    status === "inProgress"
  );
}

/**
 * Bucket non-overlap rules per spec personal.md /my-matches:
 *   - Captain section: isCaptain && match live (Open / AlmostFull / Full /
 *     InProgress).
 *   - Upcoming section: !isCaptain && myStatus ∈ {accepted, pending} &&
 *     match live; OR !isCaptain && myStatus === 'watching' && match in
 *     {Open, AlmostFull, Full} (NOT InProgress).
 *   - Past section: everything else where the user has SOME relationship
 *     (isCaptain || myStatus !== 'none').
 *   - myStatus === 'none' AND !isCaptain → drop (no relationship to render).
 */
function bucketFor(card: RawCard): "captain" | "upcoming" | "past" | null {
  if (card.isCaptain && isLiveStatus(card.matchStatus)) {
    return "captain";
  }

  // Upcoming branches — non-captain only. Captain matches on live are above.
  if (!card.isCaptain) {
    if (card.myStatus === "accepted" && isLiveStatus(card.matchStatus)) {
      // accepted on Open/AlmostFull/Full/InProgress → Upcoming (spec:
      // InProgress accepted stays in Upcoming with 🔴 indicator)
      return "upcoming";
    }
    if (
      card.myStatus === "pending" &&
      (card.matchStatus === "open" ||
        card.matchStatus === "almostFull" ||
        card.matchStatus === "full")
    ) {
      // pending on Open/AlmostFull/Full → Upcoming. By the time match goes
      // InProgress, cron has auto-rejected pending → myStatus flips to
      // 'declined' → falls through to Past below.
      return "upcoming";
    }
    if (
      card.myStatus === "watching" &&
      (card.matchStatus === "open" ||
        card.matchStatus === "almostFull" ||
        card.matchStatus === "full")
    ) {
      // watching on Open/AlmostFull/Full only (spec: 👀 Watching card
      // disappears from Upcoming when match transitions to InProgress).
      return "upcoming";
    }
  }

  // Past: any other case where the user is involved (captain on past, or
  // any terminal myStatus, or accepted on cancelled, etc.)
  if (card.isCaptain || card.myStatus !== "none") return "past";

  return null;
}

function toDto(c: RawCard): MyMatchCardDto {
  return {
    match: c.match,
    slots: c.slots,
    matchStatus: c.matchStatus,
    myStatus: c.myStatus,
    isCaptain: c.isCaptain,
    joinRequestStatus: c.joinRequestStatus,
    joinRequestAutoReason: c.joinRequestAutoReason,
    hasWatch: c.hasWatch,
    pendingCount: c.pendingCount,
  };
}

function sortByStartAsc(a: MyMatchCardDto, b: MyMatchCardDto): number {
  const d = a.match.startTime.getTime() - b.match.startTime.getTime();
  if (d !== 0) return d;
  return a.match.id.localeCompare(b.match.id);
}

function sortByStartDesc(a: MyMatchCardDto, b: MyMatchCardDto): number {
  const d = b.match.startTime.getTime() - a.match.startTime.getTime();
  if (d !== 0) return d;
  return a.match.id.localeCompare(b.match.id);
}

function cursorFor(card: MyMatchCardDto): MyMatchesPastCursor {
  return { startTime: card.match.startTime, id: card.match.id };
}

/**
 * Keyset predicate for Past pagination. Sort is `start_time DESC, id ASC`,
 * so "strictly after" the cursor means:
 *   row.startTime < cursor.startTime
 *   OR (row.startTime == cursor.startTime AND row.id > cursor.id)
 */
function isStrictlyAfter(
  row: MyMatchCardDto,
  cursor: MyMatchesPastCursor,
): boolean {
  const rt = row.match.startTime.getTime();
  const ct = cursor.startTime.getTime();
  if (rt < ct) return true;
  if (rt > ct) return false;
  return row.match.id > cursor.id;
}
