/**
 * MODULE: match_lifecycle.domain.system-cancel-reasons
 * PURPOSE: Canonical strings written into `Match.cancel_reason` by
 *          SYSTEM-initiated cancellations (vs. captain-written free-text
 *          reasons supplied through the cancel modal).
 * LAYER: domain
 * DEPENDENCIES: none
 * CONSUMED BY: src/auth/application/delete-account-service.ts (Layer 7.5),
 *              future src/moderation/application/ban-user-service (Layer 9).
 * INVARIANTS:
 *   - Privacy: spec global.md "Ban / account deletion" mandates UNIFIED
 *     public text for self-delete and admin-ban — outside observers must
 *     not be able to tell the two apart from the match page banner or the
 *     notification body. Both Layer 7.5 (DeleteAccountService) and the
 *     future Layer 9 (admin ban) point at `organizerRemoved` so the wording
 *     stays in lockstep.
 *   - The string ends up in three places by going through the existing
 *     `CancelMatchService` unchanged:
 *       1. `Match.cancel_reason` column (visible in the Cancelled banner on
 *          `/matches/:id` as `"Cancelled · <reason>"`).
 *       2. Accepted-player notification bodies via
 *          `buildMatchCancelledBody(reason)` → `"Match cancelled — <reason>"`.
 *       3. Admin moderation tooling (Layer 9 `[Hide text ▾]` can hide the
 *          banner reason same as any captain-supplied text).
 *   - Former-pending players receive the FIXED
 *     `NOTIFICATION_BODIES.matchCancelledPending` string without
 *     interpolation — captain-initiated vs. system-cascade is intentionally
 *     indistinguishable to them (privacy + spec).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion"
 *     ("auto-cancelled with reason \"Organizer account was removed\"")
 *   - docs/spec/pitchup-spec-personal.md §290 (banner wording)
 *   - docs/spec/pitchup-spec-match.md "Per-endpoint checklist" → POST /cancel
 */

export const SYSTEM_CANCEL_REASONS = {
  /**
   * Account self-deletion (`DELETE /api/me`) and admin ban (Layer 9) both
   * point here. Identical public wording is a spec requirement, not a
   * coincidence — do not split into two strings.
   */
  organizerRemoved: "Organizer account was removed",
} as const;

export type SystemCancelReason =
  (typeof SYSTEM_CANCEL_REASONS)[keyof typeof SYSTEM_CANCEL_REASONS];
