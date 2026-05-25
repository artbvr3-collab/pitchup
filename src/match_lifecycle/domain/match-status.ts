/**
 * MODULE: match_lifecycle.domain.match-status
 * PURPOSE: Canonical match-status derivation. Single source — never duplicate.
 *          Status is computed on-read from `startTime`, `duration`,
 *          `cancelledAt`, and slot info. There is NO `status` column on Match.
 * LAYER: domain (pure)
 * DEPENDENCIES: ./match, ./slot-math
 * CONSUMED BY: application services, route handlers, server components.
 * INVARIANTS:
 *   - Precedence (high to low): Cancelled, Ended, InProgress, Full,
 *     AlmostFull, Open. Each branch shadows the ones below it.
 *   - Cancelled wins regardless of time/slots.
 *   - Ended = now >= startTime + duration min.
 *   - InProgress = now >= startTime (and not Ended).
 *   - Otherwise pre-game status comes from slots: full / almostFull (free<=2)
 *     / open.
 *   - "Almost full" threshold is free <= 2, NOT 1. Matches spec wording.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Match states",
 *               docs/spec/pitchup-app-map.md → "Match and player lifecycle".
 */
import type { Match } from "./match";
import type { SlotInfo } from "./slot-math";

export type MatchStatus =
  | "open"
  | "almostFull"
  | "full"
  | "inProgress"
  | "ended"
  | "cancelled";

type StatusMatchShape = Pick<Match, "startTime" | "duration" | "cancelledAt">;

export function deriveMatchStatus(
  match: StatusMatchShape,
  slots: SlotInfo,
  now: Date,
): MatchStatus {
  if (match.cancelledAt !== null) return "cancelled";

  const endsAt = match.startTime.getTime() + match.duration * 60_000;
  if (now.getTime() >= endsAt) return "ended";
  if (now.getTime() >= match.startTime.getTime()) return "inProgress";

  if (slots.isFull) return "full";
  if (slots.free <= 2) return "almostFull";
  return "open";
}
