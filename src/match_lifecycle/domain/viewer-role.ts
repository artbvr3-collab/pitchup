/**
 * MODULE: match_lifecycle.domain.viewer-role
 * PURPOSE: Pure derivation of the viewer's role on a match, given the match
 *          + the viewer's own JoinRequest (if any) + their Watch row (if
 *          any). Used by `/matches/:id` RSC and by the CTA cascade.
 *          Mirrors the cascade invariants in spec match.md §70 — the role
 *          enum is exclusive (one match per user → one role).
 * LAYER: domain (pure)
 * DEPENDENCIES: ./match, ./join-request, ./compute-cta (ViewerRole),
 *               src/auth/domain/user (UserId)
 * CONSUMED BY: app/matches/[id]/page.tsx,
 *              src/match_lifecycle/ui/match-cta-bar.tsx
 * INVARIANTS:
 *   - Captain wins: if `match.captainId === viewerId`, role is always
 *     `captain` regardless of any (legitimately impossible) join-request.
 *   - Active JoinRequest (`pending` / `accepted`) wins over Watch. Spec
 *     match.md §165 — "Parallel states pending+watching do not exist".
 *   - Terminal JoinRequest statuses (`rejected` / `cancelled` / `left` /
 *     `kicked`) collapse to `none` for CTA purposes (they have no impact
 *     on what the viewer sees in the bar; re-apply is via UPSERT-revive).
 *     The Watch row, if present, then upgrades them to `watching`.
 *   - `viewerId === null` ⇒ `guest`. Guard at the call site for the rest.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "CTA bar" → "Invariants"
 *   - docs/spec/pitchup-spec-global.md → "my_status mapping"
 */
import type { UserId } from "@/src/auth/domain/user";

import type { ViewerRole } from "./compute-cta";
import type { JoinRequest } from "./join-request";
import type { Match } from "./match";

export interface DeriveViewerRoleInput {
  readonly match: Match;
  readonly viewerId: UserId | null;
  /** Viewer's own JoinRequest on this match, if any. */
  readonly joinRequest: JoinRequest | null;
  /** Whether the viewer has a Watch row for this match. */
  readonly isWatching: boolean;
}

export function deriveViewerRole(input: DeriveViewerRoleInput): ViewerRole {
  if (input.viewerId === null) return "guest";
  if (input.match.captainId === input.viewerId) return "captain";

  const status = input.joinRequest?.status;
  if (status === "accepted") return "accepted";
  if (status === "pending") return "pending";

  // Terminal join-request statuses fall through to Watch / none.
  if (input.isWatching) return "watching";
  return "none";
}
