/**
 * MODULE: tests.notifications.application.morning-reminder-service
 * PURPOSE: Cover crons #1 + #2 (Layer 7b). Window math across regular and
 *          DST days; recipient set (captain + accepted only); per-pair
 *          atomicity via the ledger; canonical body strings; cancelled-
 *          match exclusion; cron retry idempotency.
 * LAYER: tests / application
 * TESTS FOR: src/notifications/application/morning-reminder-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Morning-of-match
 *     reminder", DST edge clauses
 */
import { describe, expect, it, vi } from "vitest";

import { MorningReminderService } from "@/src/notifications/application/morning-reminder-service";
import { NOTIFICATION_BODIES } from "@/src/notifications/domain/notification-bodies";
import { asMatchId } from "@/src/match_lifecycle/domain/match";

import {
  FakeEmailSender,
  FakeJoinRequestRepository,
  FakeMatchRepository,
  FakeNotificationRepository,
  FakeReminderSentRepository,
  FakeUserRepository,
  OTHER_PLAYER_ID,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  makeMatch,
  makeUser,
} from "../../match_lifecycle/_helpers/fakes";

// withTransaction is mocked to a no-op pass-through (single-statement tests).
vi.mock("@/src/shared/db/with-transaction", () => ({
  withTransaction: <T,>(work: (tx: unknown) => Promise<T>) => work({}),
}));

const APP_URL = "https://pitchup.test";

function setup() {
  const matches = new FakeMatchRepository();
  const joinRequests = new FakeJoinRequestRepository();
  const notifications = new FakeNotificationRepository();
  const reminders = new FakeReminderSentRepository();
  const users = new FakeUserRepository();
  const email = new FakeEmailSender();
  const service = new MorningReminderService({
    matches,
    joinRequests,
    notifications,
    reminders,
    users,
    emailSender: email,
    appBaseUrl: APP_URL,
  });
  return { service, matches, joinRequests, notifications, reminders, users, email };
}

describe("MorningReminderService — window math", () => {
  it("today: regular summer day — fires for matches starting Prague today after now", async () => {
    // 2026-07-15 10:00 Prague = 08:00 UTC.
    const now = new Date("2026-07-15T08:00:00Z");
    const inWindow = new Date("2026-07-15T16:00:00Z"); // 18:00 Prague today
    const tooEarly = new Date("2026-07-15T07:30:00Z"); // 09:30 Prague — before now
    const nextDay = new Date("2026-07-16T08:00:00Z"); // tomorrow Prague morning

    const { service, matches, joinRequests, notifications } = setup();
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-000000000001"),
        startTime: inWindow,
      }),
    );
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-000000000002"),
        startTime: tooEarly,
      }),
    );
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-000000000003"),
        startTime: nextDay,
      }),
    );

    const result = await service.run({ now, window: "today" });

    expect(result.matchesScanned).toBe(1);
    expect(notifications.inserted).toHaveLength(1); // captain only, no accepted seeded
    expect(notifications.inserted[0]!.body).toBe(
      NOTIFICATION_BODIES.morningReminderToday,
    );
    void joinRequests;
  });

  it("tomorrow: regular summer day — fires only for matches starting tomorrow 00:00–12:00 Prague", async () => {
    // 2026-07-15 20:00 Prague = 18:00 UTC.
    const now = new Date("2026-07-15T18:00:00Z");
    // Tomorrow 09:00 Prague = 07:00 UTC.
    const inWindow = new Date("2026-07-16T07:00:00Z");
    // Tomorrow 13:00 Prague = 11:00 UTC — outside the noon cutoff.
    const afterNoon = new Date("2026-07-16T11:00:00Z");
    // Today (still later this evening) — also outside.
    const stillToday = new Date("2026-07-15T20:00:00Z");

    const { service, matches, notifications } = setup();
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000a1"),
        startTime: inWindow,
      }),
    );
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000a2"),
        startTime: afterNoon,
      }),
    );
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000a3"),
        startTime: stillToday,
      }),
    );

    const result = await service.run({ now, window: "tomorrow" });

    expect(result.matchesScanned).toBe(1);
    expect(notifications.inserted).toHaveLength(1);
    expect(notifications.inserted[0]!.body).toBe(
      NOTIFICATION_BODIES.morningReminderTomorrow,
    );
  });

  it("tomorrow window on spring-forward Sunday (2026-03-28 evening → 2026-03-29 00:00–12:00 Prague)", async () => {
    // 2026-03-28 20:00 Prague (winter offset, UTC+1) = 19:00 UTC.
    const now = new Date("2026-03-28T19:00:00Z");
    // Match at 2026-03-29 11:00 Prague. After the 02:00→03:00 jump Prague is
    // UTC+2, so 11:00 Prague = 09:00 UTC. Should qualify (within 00:00–12:00).
    const justBeforeNoonAfterJump = new Date("2026-03-29T09:00:00Z");
    // Match at 2026-03-29 12:00 Prague = 10:00 UTC. Outside (noon is exclusive).
    const noonExactly = new Date("2026-03-29T10:00:00Z");
    // Match at 2026-03-29 01:30 Prague (still UTC+1 before the jump) = 00:30 UTC. Qualifies.
    const beforeJump = new Date("2026-03-29T00:30:00Z");

    const { service, matches, notifications } = setup();
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000b1"),
        startTime: justBeforeNoonAfterJump,
      }),
    );
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000b2"),
        startTime: noonExactly,
      }),
    );
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000b3"),
        startTime: beforeJump,
      }),
    );

    const result = await service.run({ now, window: "tomorrow" });

    expect(result.matchesScanned).toBe(2);
    expect(notifications.inserted).toHaveLength(2); // captains of the two
  });

  it("tomorrow window on fall-back Sunday (2026-10-24 evening → 2026-10-25 00:00–12:00 Prague)", async () => {
    // 2026-10-24 20:00 Prague (still summer offset, UTC+2) = 18:00 UTC.
    const now = new Date("2026-10-24T18:00:00Z");
    // Match at 2026-10-25 11:00 Prague AFTER the 03:00→02:00 fall-back means
    // Prague is on UTC+1 by 11:00, so 11:00 Prague = 10:00 UTC. Qualifies.
    const lateMorningAfterRevert = new Date("2026-10-25T10:00:00Z");
    // Match at 2026-10-25 12:00 Prague = 11:00 UTC. Outside.
    const noonExactly = new Date("2026-10-25T11:00:00Z");
    // Match at 2026-10-25 01:00 Prague (first occurrence, UTC+2) = 23:00 UTC on Oct 24. Qualifies.
    const beforeRevertFirstOccurrence = new Date("2026-10-24T23:00:00Z");

    const { service, matches, notifications } = setup();
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000c1"),
        startTime: lateMorningAfterRevert,
      }),
    );
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000c2"),
        startTime: noonExactly,
      }),
    );
    matches.put(
      makeMatch({
        id: asMatchId("00000000-0000-0000-0000-0000000000c3"),
        startTime: beforeRevertFirstOccurrence,
      }),
    );

    const result = await service.run({ now, window: "tomorrow" });

    expect(result.matchesScanned).toBe(2);
    expect(notifications.inserted).toHaveLength(2);
  });
});

describe("MorningReminderService — recipients", () => {
  it("notifies captain + accepted, skips pending / watching / rejected", async () => {
    const now = new Date("2026-07-15T08:00:00Z");
    const inWindow = new Date("2026-07-15T16:00:00Z");

    const { service, matches, joinRequests, notifications } = setup();
    matches.put(makeMatch({ startTime: inWindow, captainId: SEED_CAPTAIN_ID }));
    joinRequests.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
    joinRequests.seed({
      matchId: SEED_MATCH_ID,
      userId: OTHER_PLAYER_ID,
      status: "pending",
    });

    await service.run({ now, window: "today" });

    expect(notifications.inserted).toHaveLength(2);
    expect(notifications.inserted.map((n) => n.userId).sort()).toEqual(
      [SEED_CAPTAIN_ID, SEED_PLAYER_ID].sort(),
    );
  });

  it("notifies captain even when nobody is accepted", async () => {
    const now = new Date("2026-07-15T08:00:00Z");
    const { service, matches, notifications } = setup();
    matches.put(
      makeMatch({
        startTime: new Date("2026-07-15T16:00:00Z"),
        captainId: SEED_CAPTAIN_ID,
      }),
    );

    await service.run({ now, window: "today" });

    expect(notifications.inserted).toHaveLength(1);
    expect(notifications.inserted[0]!.userId).toBe(SEED_CAPTAIN_ID);
    expect(notifications.inserted[0]!.type).toBe("morning_reminder");
  });
});

describe("MorningReminderService — ledger idempotency", () => {
  it("ON CONFLICT (ledger row present) → skips both ledger insert side-effects and notification", async () => {
    const now = new Date("2026-07-15T08:00:00Z");
    const { service, matches, reminders, notifications } = setup();
    matches.put(
      makeMatch({
        startTime: new Date("2026-07-15T16:00:00Z"),
        captainId: SEED_CAPTAIN_ID,
      }),
    );
    // Pre-seed the ledger as if a previous cron run already sent to the captain.
    reminders.seed(SEED_MATCH_ID, SEED_CAPTAIN_ID, "morning_reminder");

    const result = await service.run({ now, window: "today" });

    expect(result.remindersSent).toBe(0);
    expect(result.alreadySent).toBe(1);
    expect(notifications.inserted).toHaveLength(0);
    expect(reminders.insertCalls).toHaveLength(1); // we still ATTEMPTED
  });

  it("back-to-back runs: second run is a no-op (every pair finds the ledger row)", async () => {
    const now = new Date("2026-07-15T08:00:00Z");
    const { service, matches, joinRequests, notifications } = setup();
    matches.put(
      makeMatch({
        startTime: new Date("2026-07-15T16:00:00Z"),
        captainId: SEED_CAPTAIN_ID,
      }),
    );
    joinRequests.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });

    const first = await service.run({ now, window: "today" });
    const second = await service.run({ now, window: "today" });

    expect(first.remindersSent).toBe(2);
    expect(notifications.inserted).toHaveLength(2);

    expect(second.remindersSent).toBe(0);
    expect(second.alreadySent).toBe(2);
    expect(notifications.inserted).toHaveLength(2); // no duplicates
  });
});

describe("MorningReminderService — exclusions", () => {
  it("excludes cancelled matches even if start_time falls in window", async () => {
    const now = new Date("2026-07-15T08:00:00Z");
    const { service, matches, notifications } = setup();
    matches.put(
      makeMatch({
        startTime: new Date("2026-07-15T16:00:00Z"),
        captainId: SEED_CAPTAIN_ID,
        cancelledAt: new Date("2026-07-14T10:00:00Z"),
        cancelReason: "captain self-cancelled",
      }),
    );

    const result = await service.run({ now, window: "today" });

    expect(result.matchesScanned).toBe(0);
    expect(notifications.inserted).toHaveLength(0);
  });

  it("returns zeros when no matches qualify", async () => {
    const now = new Date("2026-07-15T08:00:00Z");
    const { service } = setup();

    const result = await service.run({ now, window: "today" });

    expect(result).toEqual({
      window: "today",
      matchesScanned: 0,
      recipientsConsidered: 0,
      remindersSent: 0,
      alreadySent: 0,
      failed: 0,
    });
  });
});

describe("MorningReminderService — body wiring", () => {
  it("today window writes 'morningReminderToday' body and type=morning_reminder", async () => {
    const now = new Date("2026-07-15T08:00:00Z");
    const { service, matches, notifications } = setup();
    matches.put(
      makeMatch({
        startTime: new Date("2026-07-15T16:00:00Z"),
        captainId: SEED_CAPTAIN_ID,
      }),
    );

    await service.run({ now, window: "today" });

    const n = notifications.inserted[0]!;
    expect(n.type).toBe("morning_reminder");
    expect(n.body).toBe(NOTIFICATION_BODIES.morningReminderToday);
    expect(n.matchId).toBe(SEED_MATCH_ID);
  });

  it("tomorrow window writes 'morningReminderTomorrow' body", async () => {
    const now = new Date("2026-07-15T18:00:00Z");
    const { service, matches, notifications } = setup();
    matches.put(
      makeMatch({
        startTime: new Date("2026-07-16T07:00:00Z"),
        captainId: SEED_CAPTAIN_ID,
      }),
    );

    await service.run({ now, window: "tomorrow" });

    const n = notifications.inserted[0]!;
    expect(n.body).toBe(NOTIFICATION_BODIES.morningReminderTomorrow);
  });
});

describe("MorningReminderService — email (Layer 7b)", () => {
  const NOW_TODAY = new Date("2026-07-15T08:00:00Z");
  const IN_WINDOW = new Date("2026-07-15T16:00:00Z");

  function seedMatchWithCaptainAndPlayer(s: ReturnType<typeof setup>) {
    s.matches.put(
      makeMatch({ startTime: IN_WINDOW, captainId: SEED_CAPTAIN_ID }),
    );
    s.joinRequests.seed({
      matchId: SEED_MATCH_ID,
      userId: SEED_PLAYER_ID,
      status: "accepted",
    });
  }

  it("emails the captain + accepted opted-in recipients with the window subject + deep link", async () => {
    const s = setup();
    seedMatchWithCaptainAndPlayer(s);
    s.users.seed(
      makeUser({ id: SEED_CAPTAIN_ID, name: "Cap", emailNotifications: true }),
    );
    s.users.seed(
      makeUser({ id: SEED_PLAYER_ID, name: "Player", emailNotifications: true }),
    );

    await s.service.run({ now: NOW_TODAY, window: "today" });

    expect(s.email.sent).toHaveLength(2);
    expect(s.email.sent.map((m) => m.to).sort()).toEqual(
      [`${SEED_CAPTAIN_ID}@example.com`, `${SEED_PLAYER_ID}@example.com`].sort(),
    );
    for (const msg of s.email.sent) {
      expect(msg.subject).toBe("Match today ⚽");
      expect(msg.text).toContain(`${APP_URL}/matches/${SEED_MATCH_ID}`);
    }
  });

  it("uses the 'tomorrow' subject for the 20:00 window", async () => {
    const s = setup();
    s.matches.put(
      makeMatch({
        startTime: new Date("2026-07-16T07:00:00Z"),
        captainId: SEED_CAPTAIN_ID,
      }),
    );
    s.users.seed(
      makeUser({ id: SEED_CAPTAIN_ID, name: "Cap", emailNotifications: true }),
    );

    await s.service.run({ now: new Date("2026-07-15T18:00:00Z"), window: "tomorrow" });

    expect(s.email.sent).toHaveLength(1);
    expect(s.email.sent[0]!.subject).toBe("Match tomorrow ⚽");
  });

  it("skips email for opted-out recipients but still writes their in-app inbox row", async () => {
    const s = setup();
    seedMatchWithCaptainAndPlayer(s);
    s.users.seed(
      makeUser({ id: SEED_CAPTAIN_ID, name: "Cap", emailNotifications: true }),
    );
    s.users.seed(
      makeUser({ id: SEED_PLAYER_ID, name: "Player", emailNotifications: false }),
    );

    await s.service.run({ now: NOW_TODAY, window: "today" });

    // Only the captain got mail; the in-app inbox got both (never gated).
    expect(s.email.sent).toHaveLength(1);
    expect(s.email.sent[0]!.to).toBe(`${SEED_CAPTAIN_ID}@example.com`);
    expect(s.notifications.inserted).toHaveLength(2);
  });

  it("skips email for a recipient with no resolvable user row (no throw)", async () => {
    const s = setup();
    s.matches.put(
      makeMatch({ startTime: IN_WINDOW, captainId: SEED_CAPTAIN_ID }),
    );
    // No users seeded → findByIds returns [] → email skipped, inbox still written.
    const result = await s.service.run({ now: NOW_TODAY, window: "today" });

    expect(s.email.sent).toHaveLength(0);
    expect(result.remindersSent).toBe(1);
    expect(s.notifications.inserted).toHaveLength(1);
  });

  it("resilience: one failing send is caught (failed++) and does NOT abort the rest of the run", async () => {
    const s = setup();
    seedMatchWithCaptainAndPlayer(s);
    s.users.seed(
      makeUser({ id: SEED_CAPTAIN_ID, name: "Cap", emailNotifications: true }),
    );
    s.users.seed(
      makeUser({ id: SEED_PLAYER_ID, name: "Player", emailNotifications: true }),
    );
    // First send (captain, processed first) throws; the player still gets mail.
    // NOTE: the pass-through withTransaction mock can't model the DB rollback,
    // so we assert run-level resilience here; the ledger-rollback "exactly-once"
    // is a real-tx property covered by the ON-CONFLICT test + the Neon smoke run.
    s.email.failNext(1);

    const result = await s.service.run({ now: NOW_TODAY, window: "today" });

    expect(result.failed).toBe(1);
    expect(result.remindersSent).toBe(1);
    expect(s.email.sent).toHaveLength(1);
    expect(s.email.sent[0]!.to).toBe(`${SEED_PLAYER_ID}@example.com`);
  });
});
