/**
 * MODULE: notifications.domain.email-bodies
 * PURPOSE: Pure builders for the four outbound emails on the spec allowlist
 *          (approved / kicked / morning-reminder today + tomorrow) plus the
 *          opt-in gate. Email is the NARROW channel — global.md §302-309:
 *          only these three events ever mail; rejected-pending, cancelled,
 *          spot-opened and updated are in-app only.
 *
 *          Unlike the terse in-app `NOTIFICATION_BODIES` (no link, tap-through
 *          provides context), an email is read out of context, so each body
 *          carries a deep link to `/matches/:id`. The link is the ONLY
 *          interpolation — still no venue/match-name read (the caller already
 *          holds the match id; no extra DB round-trip inside a locked tx).
 * LAYER: domain
 * DEPENDENCIES: ./email-sender (EmailMessage type)
 * CONSUMED BY: the three source services (approve / kick / morning) + tests.
 * INVARIANTS:
 *   - Builders are pure: `(to, matchUrl) → EmailMessage`. No env, no clock,
 *     no I/O — fully unit-testable.
 *   - `emailGateOpen` is the single source of truth for "may we email this
 *     user": opt-in AND not banned AND not soft-deleted. The in-app inbox is
 *     never gated; only email consults this.
 * RELATED DOCS: docs/adr/0004-resend-email-with-channel-specific-send-semantics.md,
 *               docs/spec/pitchup-spec-global.md → "Notifications".
 */
import type { EmailMessage } from "./email-sender";

export type MorningEmailWindow = "today" | "tomorrow";

const SIGNOFF = "\n\n— PITCHUP";

/** type=approved — captain accepted the player's request. */
export function buildApprovedEmail(to: string, matchUrl: string): EmailMessage {
  return {
    to,
    subject: "You're in ✓",
    text:
      "Your request to join the match was approved. " +
      `See the time and lineup:\n\n${matchUrl}${SIGNOFF}`,
  };
}

/** type=kicked — captain removed an accepted player. */
export function buildKickedEmail(to: string, matchUrl: string): EmailMessage {
  return {
    to,
    subject: "You were removed from a match",
    text:
      "The captain removed you from the match. If you think this was a " +
      `mistake, you can request to join again:\n\n${matchUrl}${SIGNOFF}`,
  };
}

/**
 * type=morning_reminder — 10:00 Prague (today) / 20:00 Prague (tomorrow).
 * Sent to the captain and every accepted player.
 */
export function buildMorningReminderEmail(
  window: MorningEmailWindow,
  to: string,
  matchUrl: string,
): EmailMessage {
  const when = window === "today" ? "today" : "tomorrow";
  return {
    to,
    subject: window === "today" ? "Match today ⚽" : "Match tomorrow ⚽",
    text:
      `You've got a match ${when}. Check the time and lineup:\n\n` +
      `${matchUrl}${SIGNOFF}`,
  };
}

/**
 * The email opt-in gate. Email is sent only to a user who has the toggle on
 * AND is a live account. The in-app inbox is written unconditionally — this
 * gate is consulted ONLY before an `EmailSender.send`.
 *
 * Takes primitives (not the `User` aggregate) so the domain stays free of a
 * cross-context import and the helper is trivially testable.
 */
export function emailGateOpen(flags: {
  readonly emailNotifications: boolean;
  readonly banned: boolean;
  readonly deletedAt: Date | null;
}): boolean {
  return flags.emailNotifications && !flags.banned && flags.deletedAt === null;
}

/** Build the canonical deep link used in every email body. */
export function matchUrl(appBaseUrl: string, matchId: string): string {
  // appBaseUrl has no trailing slash (env is normalized at the edge); keep the
  // join explicit so a stray slash doesn't produce `//matches`.
  return `${appBaseUrl.replace(/\/+$/, "")}/matches/${matchId}`;
}
