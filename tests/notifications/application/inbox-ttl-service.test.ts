/**
 * MODULE: tests.notifications.application.inbox-ttl-service
 * PURPOSE: Cover the once-daily janitor: cutoffs computed from `now`, fixed
 *          call order across the three ports, counts propagated back to the
 *          caller, idempotency on empty runs.
 * LAYER: tests / application
 * TESTS FOR: src/notifications/application/inbox-ttl-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Cron jobs → Inbox TTL cleanup"
 */
import { describe, expect, it } from "vitest";

import {
  INBOX_TTL_ADMIN_MATCH_DELETIONS_HOURS,
  INBOX_TTL_NOTIFICATIONS_DAYS,
  INBOX_TTL_REMINDER_SENT_DAYS,
  INBOX_TTL_WATCH_DAYS,
  InboxTtlService,
} from "@/src/notifications/application/inbox-ttl-service";

import {
  FakeAdminMatchDeletionRepository,
  FakeNotificationRepository,
  FakeReminderSentRepository,
  FakeWatchRepository,
} from "../../match_lifecycle/_helpers/fakes";

const DAY_MS = 24 * 60 * 60 * 1000;

function setup() {
  const notifications = new FakeNotificationRepository();
  const reminders = new FakeReminderSentRepository();
  const watches = new FakeWatchRepository();
  const adminMatchDeletions = new FakeAdminMatchDeletionRepository();
  const service = new InboxTtlService({
    notifications,
    reminders,
    watches,
    adminMatchDeletions,
  });
  return { notifications, reminders, watches, adminMatchDeletions, service };
}

describe("InboxTtlService", () => {
  it("uses cutoffs of now − 30/7/1 days against the three ports", async () => {
    const { service, notifications, reminders, watches } = setup();
    // Arbitrary anchor; the service must not read wall-clock.
    const now = new Date("2026-05-30T01:00:00.000Z");

    await service.run(now);

    expect(notifications.deleteOlderThanCalls).toHaveLength(1);
    expect(notifications.deleteOlderThanCalls[0]!.toISOString()).toBe(
      new Date(now.getTime() - INBOX_TTL_NOTIFICATIONS_DAYS * DAY_MS).toISOString(),
    );

    expect(reminders.deleteForMatchesStartingBeforeCalls).toHaveLength(1);
    expect(
      reminders.deleteForMatchesStartingBeforeCalls[0]!.toISOString(),
    ).toBe(
      new Date(now.getTime() - INBOX_TTL_REMINDER_SENT_DAYS * DAY_MS).toISOString(),
    );

    expect(watches.deleteForMatchesStartingBeforeCalls).toHaveLength(1);
    expect(watches.deleteForMatchesStartingBeforeCalls[0]!.toISOString()).toBe(
      new Date(now.getTime() - INBOX_TTL_WATCH_DAYS * DAY_MS).toISOString(),
    );
  });

  it("calls ports in fixed order: notifications → reminders → watches", async () => {
    const { service, notifications, reminders, watches } = setup();
    const calls: string[] = [];
    const notificationsOrig = notifications.deleteOlderThan.bind(notifications);
    const remindersOrig =
      reminders.deleteForMatchesStartingBefore.bind(reminders);
    const watchesOrig = watches.deleteForMatchesStartingBefore.bind(watches);
    notifications.deleteOlderThan = async (c) => {
      calls.push("notifications");
      return notificationsOrig(c);
    };
    reminders.deleteForMatchesStartingBefore = async (c) => {
      calls.push("reminders");
      return remindersOrig(c);
    };
    watches.deleteForMatchesStartingBefore = async (c) => {
      calls.push("watches");
      return watchesOrig(c);
    };

    await service.run(new Date("2026-05-30T01:00:00.000Z"));

    expect(calls).toEqual(["notifications", "reminders", "watches"]);
  });

  it("propagates the deleted counts from each port back to the caller", async () => {
    const { service, notifications, reminders, watches, adminMatchDeletions } = setup();
    notifications.deleteOlderThanResult = 42;
    reminders.deleteForMatchesStartingBeforeResult = 7;
    watches.deleteForMatchesStartingBeforeResult = 3;
    adminMatchDeletions.setDeleteCount(2);

    const result = await service.run(new Date("2026-05-30T01:00:00.000Z"));

    expect(result).toEqual({
      notificationsDeleted: 42,
      remindersDeleted: 7,
      watchesDeleted: 3,
      adminMatchDeletionsDeleted: 2,
    });
  });

  it("returns zeros when every port reports nothing to delete", async () => {
    const { service } = setup();

    const result = await service.run(new Date("2026-05-30T01:00:00.000Z"));

    expect(result).toEqual({
      notificationsDeleted: 0,
      remindersDeleted: 0,
      watchesDeleted: 0,
      adminMatchDeletionsDeleted: 0,
    });
  });

  it("also verifies admin_match_deletions TTL uses 24h cutoff", async () => {
    const { service, adminMatchDeletions } = setup();
    const now = new Date("2026-05-30T01:00:00.000Z");
    const calls: Date[] = [];
    const origDeleteOlderThan = adminMatchDeletions.deleteOlderThan.bind(adminMatchDeletions);
    adminMatchDeletions.deleteOlderThan = async (before) => {
      calls.push(before);
      return origDeleteOlderThan(before);
    };

    await service.run(now);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.toISOString()).toBe(
      new Date(
        now.getTime() - INBOX_TTL_ADMIN_MATCH_DELETIONS_HOURS * 60 * 60 * 1000,
      ).toISOString(),
    );
  });

  it("is idempotent — a second back-to-back run hits the ports again with the same shape", async () => {
    const { service, notifications, reminders, watches } = setup();
    const now = new Date("2026-05-30T01:00:00.000Z");

    await service.run(now);
    await service.run(now);

    expect(notifications.deleteOlderThanCalls).toHaveLength(2);
    expect(reminders.deleteForMatchesStartingBeforeCalls).toHaveLength(2);
    expect(watches.deleteForMatchesStartingBeforeCalls).toHaveLength(2);
    expect(notifications.deleteOlderThanCalls[0]!.toISOString()).toBe(
      notifications.deleteOlderThanCalls[1]!.toISOString(),
    );
  });

  it("ignores wall-clock — different `now` values produce different cutoffs", async () => {
    const { service, notifications } = setup();
    const a = new Date("2026-05-30T01:00:00.000Z");
    const b = new Date("2026-06-15T01:00:00.000Z");

    await service.run(a);
    await service.run(b);

    expect(notifications.deleteOlderThanCalls[0]!.toISOString()).not.toBe(
      notifications.deleteOlderThanCalls[1]!.toISOString(),
    );
    expect(notifications.deleteOlderThanCalls[1]!.getTime()).toBe(
      b.getTime() - INBOX_TTL_NOTIFICATIONS_DAYS * DAY_MS,
    );
  });
});
