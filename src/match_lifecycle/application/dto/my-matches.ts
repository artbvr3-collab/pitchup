/**
 * MODULE: match_lifecycle.application.dto.my-matches
 * PURPOSE: Wire-shape DTOs for `/my-matches` (RSC + `GET /api/my-matches/past`).
 *          The page renders three sections + a "Likes reminder" placeholder
 *          (Layer 6.X). The past page can be requested incrementally via a
 *          base64url cursor (keyset on `start_time DESC, id ASC`).
 * LAYER: application
 * DEPENDENCIES: ./derive-my-status (MyStatus), ../../domain/*
 * CONSUMED BY: src/match_lifecycle/application/list-my-matches-service.ts,
 *              app/(private)/my-matches/*,
 *              app/api/my-matches/past/route.ts
 * INVARIANTS:
 *   - All sections share the same `MyMatchCardDto` shape; only the bucket
 *     differs. Section-specific labels (Past sub-label, captain badge) are
 *     derived in the UI from `joinRequestStatus` + `isCaptain`.
 *   - The first card in `upcoming` (sorted `start_time ASC`) is the
 *     "featured next match" — the UI renders it as a larger card on top.
 *     If `upcoming` is empty the featured card is absent.
 *   - Cursor format is identical to Discover's (`base64url(JSON{s, i})`) so
 *     the helpers in `discover-filters.ts` can be reused.
 *   - `pastCursor` is `null` when the page is fully consumed; the
 *     `[Show more]` button hides in that case.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/my-matches" (sections, sub-labels,
 *     featured "Your next match" card, [Show more] pagination)
 *   - docs/spec/pitchup-spec-global.md → "Polling sync" → my_status
 */
import type { JoinRequestStatus } from "../../domain/join-request";
import type { MatchWithVenue } from "../../domain/match";
import type { MatchStatus } from "../../domain/match-status";
import type { SlotInfo } from "../../domain/slot-math";
import type { MyStatus } from "../../domain/derive-my-status";

/**
 * Cursor shape — identical to `DiscoverCursor` so the existing
 * `encodeCursor` / `decodeCursor` helpers in `discover-filters.ts` can be
 * reused without duplication. Encoded form: `base64url(JSON{s, i})`.
 */
export interface MyMatchesPastCursor {
  /** Last seen `startTime` (UTC). Sort is `start_time DESC, id ASC`. */
  readonly startTime: Date;
  /** Last seen match id — breaks ties on identical startTime. */
  readonly id: string;
}

/**
 * One card on /my-matches. Carries enough state for the existing MatchCard
 * UI component + the badges Layer 6 introduces (captain, You're in,
 * Waiting…, 👀 Watching, Past sub-labels).
 */
export interface MyMatchCardDto {
  readonly match: MatchWithVenue;
  readonly slots: SlotInfo;
  readonly matchStatus: MatchStatus;
  readonly myStatus: MyStatus;
  readonly isCaptain: boolean;
  /**
   * Raw JoinRequest status (or `null` when no JR row exists). Past sub-label
   * derivation reads this directly per spec personal.md (NOT through
   * `my_status` — `declined` collapses three different `auto_reason` values
   * the sub-label distinguishes).
   */
  readonly joinRequestStatus: JoinRequestStatus | null;
  /**
   * `auto_reason` of the JoinRequest. Past sub-label uses this together
   * with `joinRequestStatus === 'rejected'` to render "Request expired"
   * (match_started) vs "Match was cancelled" (match_cancelled) vs
   * "Request declined" (NULL — captain reject).
   */
  readonly joinRequestAutoReason: "match_started" | "match_cancelled" | null;
  /** True when the user has a Watch row on this match. */
  readonly hasWatch: boolean;
  /**
   * Captain-only on live matches — number of pending JoinRequests on this
   * match. Surfaced for the "N pending" orange badge on the captain
   * section card. `null` for non-captain or non-live cards.
   */
  readonly pendingCount: number | null;
}

export interface MyMatchesPage {
  readonly captain: readonly MyMatchCardDto[];
  readonly upcoming: readonly MyMatchCardDto[];
  readonly past: readonly MyMatchCardDto[];
  /** `null` when Past is fully consumed. */
  readonly pastCursor: MyMatchesPastCursor | null;
  /**
   * Layer 6.X — Like aggregate doesn't exist yet. Always `[]` for now.
   * Wire shape is present so the UI banner block can be added without a
   * service-layer change in Layer 6.X.
   */
  readonly likesReminder: readonly { readonly matchId: string }[];
}

export interface MyMatchesPastPage {
  readonly rows: readonly MyMatchCardDto[];
  readonly pastCursor: MyMatchesPastCursor | null;
}

/** Page size for Section Past initial render and each `[Show more]` tap. */
export const MY_MATCHES_PAST_PAGE_SIZE = 20;
