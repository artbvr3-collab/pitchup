/**
 * MODULE: notifications.domain.notification-bodies
 * PURPOSE: Canonical EN body strings for in-app notifications. The spec mandates
 *          `body` is a ready-made string written at the source event — no
 *          client-side templates, no branching by `type` on the frontend
 *          (global.md → "Notification text comes from `body`"). Centralising the
 *          strings here keeps the source services and their tests in lock-step.
 * LAYER: domain
 * DEPENDENCIES: none (pure strings)
 * CONSUMED BY: match_lifecycle services (insertion points), notify-watching,
 *              and the notifications tests that assert on body text.
 * INVARIANTS:
 *   - Fixed bodies are constants; parameterised bodies (cancel reason, edited
 *     field list) are pure builders. Wording matches the spec exactly:
 *     global.md → "action → notification.type mapping" + match.md → notify
 *     watching / cancel / edit.
 *   - We do NOT interpolate a match label into the body. The spec's body
 *     examples are match-name-free; context is provided by tapping the item
 *     through to `/matches/:id`. (The "[match]" placeholder in earlier TODO
 *     comments was illustrative.) Avoiding the name also spares an extra venue
 *     read inside the already-locked source transaction.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Notifications", "action → type mapping"
 *   - docs/spec/pitchup-spec-match.md → "notify watching", cancel / edit flows
 */

export const NOTIFICATION_BODIES = {
  /** type=approved — captain approved the request. */
  approved: "✓ You're in",
  /** type=rejected — captain declined a pending request. */
  rejected: "Your request was declined",
  /** type=rejected — cron auto-reject at start_time (Layer 7b). */
  rejectedMatchStarted: "Match started — your request expired",
  /** type=kicked — captain removed an accepted player. */
  kicked: "You were removed from the match",
  /** type=match_cancelled — recipient was a former-pending player. */
  matchCancelledPending: "Your request was declined — match was cancelled",
  /** type=spot_opened — watcher fan-out on a freed slot. */
  spotOpenedWatcher: "🟢 A spot just opened",
  /** type=spot_opened — captain push on Leave (player-freed slot). */
  spotOpenedCaptain: "🟢 A spot opened up in your match",
} as const;

/** type=match_cancelled body for accepted players — carries the captain's reason. */
export function buildMatchCancelledBody(reason: string): string {
  return `Match cancelled — ${reason}`;
}

/** type=match_updated body — lists the changed material fields in human text. */
export function buildMatchUpdatedBody(changedFields: readonly string[]): string {
  return `Match updated: ${changedFields.join(", ")}`;
}
