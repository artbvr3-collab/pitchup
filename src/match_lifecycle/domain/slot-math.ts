/**
 * MODULE: match_lifecycle.domain.slot-math
 * PURPOSE: Canonical slot-math formula. Single source for `filled / capacity /
 *          free / isFull`. Never recompute locally — always go through this.
 * LAYER: domain (pure)
 * DEPENDENCIES: ./match
 * CONSUMED BY: application services, route handlers, server components.
 * INVARIANTS:
 *   - filled = 1 (captain) + captainCrew.length + acceptedSlots
 *   - acceptedSlots = Σ (1 + guestCount) over JoinRequest rows with
 *     status = 'accepted'. JoinRequest is added in Layer 4; until then,
 *     callers pass acceptedSlots = 0.
 *   - free = max(0, totalSpots - filled). Never negative even if a captain
 *     reduces totalSpots below current filled.
 *   - isFull ≡ filled >= totalSpots (strict inequality also works since free
 *     clamps; matching spec wording with >=).
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Slot math" (canonical).
 */
import type { Match } from "./match";

export interface SlotInfo {
  readonly filled: number;
  readonly capacity: number;
  readonly free: number;
  readonly isFull: boolean;
}

type SlotMatchShape = Pick<Match, "totalSpots" | "captainCrew">;

export function computeSlots(match: SlotMatchShape, acceptedSlots = 0): SlotInfo {
  const filled = 1 + match.captainCrew.length + acceptedSlots;
  const capacity = match.totalSpots;
  const free = Math.max(0, capacity - filled);
  const isFull = filled >= capacity;
  return { filled, capacity, free, isFull };
}
