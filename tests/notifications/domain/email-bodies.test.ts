/**
 * MODULE: tests.notifications.domain.email-bodies
 * PURPOSE: Pure-builder + gate coverage for the Layer 7b email bodies. No I/O,
 *          no env — just (to, matchUrl) → message and the opt-in truth table.
 * LAYER: tests / domain
 * TESTS FOR: src/notifications/domain/email-bodies.ts
 * RELATED DOCS: docs/adr/0004-resend-email-with-channel-specific-send-semantics.md
 */
import { describe, expect, it } from "vitest";

import {
  buildApprovedEmail,
  buildKickedEmail,
  buildMorningReminderEmail,
  emailGateOpen,
  matchUrl,
} from "@/src/notifications/domain/email-bodies";

const TO = "player@example.com";
const LINK = "https://pitchup.test/matches/abc";

describe("email body builders", () => {
  it("approved — subject + match link, addressed to the recipient", () => {
    const msg = buildApprovedEmail(TO, LINK);
    expect(msg.to).toBe(TO);
    expect(msg.subject).toBe("You're in ✓");
    expect(msg.text).toContain(LINK);
  });

  it("kicked — subject + match link", () => {
    const msg = buildKickedEmail(TO, LINK);
    expect(msg.to).toBe(TO);
    expect(msg.subject).toBe("You were removed from a match");
    expect(msg.text).toContain(LINK);
  });

  it("morning reminder — distinct subject per window, link in both", () => {
    const today = buildMorningReminderEmail("today", TO, LINK);
    const tomorrow = buildMorningReminderEmail("tomorrow", TO, LINK);

    expect(today.subject).toBe("Match today ⚽");
    expect(tomorrow.subject).toBe("Match tomorrow ⚽");
    expect(today.subject).not.toBe(tomorrow.subject);
    expect(today.text).toContain(LINK);
    expect(tomorrow.text).toContain(LINK);
    expect(today.text).toContain("today");
    expect(tomorrow.text).toContain("tomorrow");
  });
});

describe("matchUrl", () => {
  it("joins base + /matches/:id", () => {
    expect(matchUrl("https://pitchup.online", "m1")).toBe(
      "https://pitchup.online/matches/m1",
    );
  });

  it("tolerates a trailing slash on the base (no double slash)", () => {
    expect(matchUrl("https://pitchup.online/", "m1")).toBe(
      "https://pitchup.online/matches/m1",
    );
  });
});

describe("emailGateOpen", () => {
  it("open when opted-in, not banned, not deleted", () => {
    expect(
      emailGateOpen({
        emailNotifications: true,
        banned: false,
        deletedAt: null,
      }),
    ).toBe(true);
  });

  it("closed when opted out", () => {
    expect(
      emailGateOpen({
        emailNotifications: false,
        banned: false,
        deletedAt: null,
      }),
    ).toBe(false);
  });

  it("closed when banned (even if opted in)", () => {
    expect(
      emailGateOpen({
        emailNotifications: true,
        banned: true,
        deletedAt: null,
      }),
    ).toBe(false);
  });

  it("closed when soft-deleted (even if opted in)", () => {
    expect(
      emailGateOpen({
        emailNotifications: true,
        banned: false,
        deletedAt: new Date("2026-05-01T00:00:00Z"),
      }),
    ).toBe(false);
  });
});
