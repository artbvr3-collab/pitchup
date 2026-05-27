/**
 * MODULE: tests.match_lifecycle.domain.derive-my-status
 * PURPOSE: Table-driven coverage of the `my_status` derivation. Every row in
 *          the spec global.md → "Polling sync" mapping table has a case here.
 *          If the spec table changes, this file MUST change too.
 * LAYER: tests / domain (pure)
 * TESTS FOR: src/match_lifecycle/domain/derive-my-status.ts
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Polling sync" → my_status
 */
import { describe, expect, it } from "vitest";

import {
  deriveMyStatus,
  type MyStatus,
} from "@/src/match_lifecycle/domain/derive-my-status";
import type { JoinRequestStatus } from "@/src/match_lifecycle/domain/join-request";

interface Row {
  readonly name: string;
  readonly joinRequestStatus: JoinRequestStatus | null;
  readonly hasWatchRecord: boolean;
  readonly matchCancelledAt: Date | null;
  readonly expected: MyStatus;
}

const SOME_DATE = new Date("2026-05-26T18:00:00Z");

const ROWS: readonly Row[] = [
  // ---------------- accepted branches ----------------
  {
    name: "accepted + live match → accepted",
    joinRequestStatus: "accepted",
    hasWatchRecord: false,
    matchCancelledAt: null,
    expected: "accepted",
  },
  {
    name: "accepted + cancelled match → cancelled (overrides accepted)",
    joinRequestStatus: "accepted",
    hasWatchRecord: false,
    matchCancelledAt: SOME_DATE,
    expected: "cancelled",
  },
  {
    name: "accepted + cancelled match + stale Watch → still cancelled",
    joinRequestStatus: "accepted",
    hasWatchRecord: true,
    matchCancelledAt: SOME_DATE,
    expected: "cancelled",
  },

  // ---------------- pending ----------------
  {
    name: "pending → pending",
    joinRequestStatus: "pending",
    hasWatchRecord: false,
    matchCancelledAt: null,
    expected: "pending",
  },
  {
    name: "pending + (legitimately impossible) Watch → still pending",
    joinRequestStatus: "pending",
    hasWatchRecord: true,
    matchCancelledAt: null,
    expected: "pending",
  },
  {
    name: "pending on a cancelled match (pre-mass-reject race) → pending",
    // Note: mass-reject converts pending → rejected with auto_reason=
    // match_cancelled; in the brief window before that runs, this branch
    // applies. After the UPDATE, the next derivation returns `declined`.
    joinRequestStatus: "pending",
    hasWatchRecord: false,
    matchCancelledAt: SOME_DATE,
    expected: "pending",
  },

  // ---------------- declined (rejected — any auto_reason) ----------------
  {
    name: "rejected (captain) → declined",
    joinRequestStatus: "rejected",
    hasWatchRecord: false,
    matchCancelledAt: null,
    expected: "declined",
  },
  {
    name: "rejected (auto: match_started) → declined",
    joinRequestStatus: "rejected",
    hasWatchRecord: false,
    matchCancelledAt: null,
    expected: "declined",
  },
  {
    name: "rejected (auto: match_cancelled) → declined",
    joinRequestStatus: "rejected",
    hasWatchRecord: false,
    matchCancelledAt: SOME_DATE,
    expected: "declined",
  },
  {
    name: "rejected + Watch → still declined (declined wins over watching)",
    // Edge case: user was rejected, then re-watched after match went full.
    // Mapping says `watching` requires NOT pending/accepted — but `declined`
    // takes precedence over `watching` because the spec table lists declined
    // earlier and the user explicitly received a captain reject. They can
    // re-apply via Join (UPSERT) or wait until match goes !isFull and Watch
    // gets cleared by `notify watching`.
    joinRequestStatus: "rejected",
    hasWatchRecord: true,
    matchCancelledAt: null,
    expected: "declined",
  },

  // ---------------- watching ----------------
  {
    name: "no JoinRequest + Watch → watching",
    joinRequestStatus: null,
    hasWatchRecord: true,
    matchCancelledAt: null,
    expected: "watching",
  },
  {
    name: "left + Watch (re-subscribed after leaving) → watching",
    joinRequestStatus: "left",
    hasWatchRecord: true,
    matchCancelledAt: null,
    expected: "watching",
  },
  {
    name: "kicked + Watch → watching",
    joinRequestStatus: "kicked",
    hasWatchRecord: true,
    matchCancelledAt: null,
    expected: "watching",
  },
  {
    name: "cancelled (self) + Watch → watching",
    joinRequestStatus: "cancelled",
    hasWatchRecord: true,
    matchCancelledAt: null,
    expected: "watching",
  },

  // ---------------- none ----------------
  {
    name: "no JoinRequest + no Watch → none (anonymous)",
    joinRequestStatus: null,
    hasWatchRecord: false,
    matchCancelledAt: null,
    expected: "none",
  },
  {
    name: "left + no Watch → none",
    joinRequestStatus: "left",
    hasWatchRecord: false,
    matchCancelledAt: null,
    expected: "none",
  },
  {
    name: "kicked + no Watch → none",
    joinRequestStatus: "kicked",
    hasWatchRecord: false,
    matchCancelledAt: null,
    expected: "none",
  },
  {
    name: "cancelled (self) + no Watch → none",
    joinRequestStatus: "cancelled",
    hasWatchRecord: false,
    matchCancelledAt: null,
    expected: "none",
  },
];

describe("deriveMyStatus — spec mapping table", () => {
  for (const row of ROWS) {
    it(row.name, () => {
      expect(
        deriveMyStatus({
          joinRequestStatus: row.joinRequestStatus,
          hasWatchRecord: row.hasWatchRecord,
          matchCancelledAt: row.matchCancelledAt,
        }),
      ).toBe(row.expected);
    });
  }
});

describe("deriveMyStatus — invariant notes", () => {
  it("never returns `kicked` (kicked is a Layer 7 polling-payload-only value)", () => {
    // Spec global.md note: "kicked exists only in the matches_changed
    // payload as a signal for the frontend to play the Upcoming → Past card
    // animation. On-read calculation: JoinRequest.status === 'kicked' →
    // my_status = 'none' (kicked user can re-apply)."
    const result = deriveMyStatus({
      joinRequestStatus: "kicked",
      hasWatchRecord: false,
      matchCancelledAt: null,
    });
    expect(result).toBe("none");
  });

  it("derivation is total — every JoinRequestStatus | null input maps", () => {
    const allStatuses: ReadonlyArray<JoinRequestStatus | null> = [
      "pending",
      "accepted",
      "rejected",
      "cancelled",
      "left",
      "kicked",
      null,
    ];
    for (const s of allStatuses) {
      for (const w of [true, false]) {
        for (const c of [null, SOME_DATE]) {
          // No throw, returns a non-undefined MyStatus value.
          expect(
            deriveMyStatus({
              joinRequestStatus: s,
              hasWatchRecord: w,
              matchCancelledAt: c,
            }),
          ).toBeDefined();
        }
      }
    }
  });
});
