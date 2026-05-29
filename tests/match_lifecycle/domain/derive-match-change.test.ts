/**
 * MODULE: tests.match_lifecycle.domain.derive-match-change
 * PURPOSE: Table-driven coverage of every `action` the global poll can emit
 *          (spec global.md §410 enum) plus the null (no-change) cases and the
 *          Step-A-over-Step-B precedence. The table is audited against the spec
 *          action table at review time.
 * LAYER: tests / domain (pure)
 * TESTS FOR: src/match_lifecycle/domain/derive-match-change.ts
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Polling sync" → action enum
 */
import { describe, expect, it } from "vitest";

import {
  deriveMatchChange,
  type MatchChange,
  type MatchChangeInput,
} from "@/src/match_lifecycle/domain/derive-match-change";
import type {
  JoinRequestAutoReason,
  JoinRequestStatus,
} from "@/src/match_lifecycle/domain/join-request";

const SINCE = new Date("2026-05-27T00:00:00Z");
const BEFORE = new Date("2026-05-26T00:00:00Z"); // < since (no change)
const AFTER = new Date("2026-05-28T00:00:00Z"); // > since (changed)
const MATCH_ID = "match-1";

function jr(
  status: JoinRequestStatus,
  updatedAt: Date,
  autoReason: JoinRequestAutoReason = null,
): MatchChangeInput["joinRequest"] {
  return { status, autoReason, updatedAt };
}

function input(overrides: Partial<MatchChangeInput>): MatchChangeInput {
  return {
    matchId: MATCH_ID,
    matchUpdatedAt: BEFORE,
    matchCancelledAt: null,
    isCaptain: false,
    joinRequest: null,
    hasWatchRecord: false,
    since: SINCE,
    ...overrides,
  };
}

interface Row {
  readonly name: string;
  readonly input: MatchChangeInput;
  readonly expected: MatchChange | null;
}

const ROWS: readonly Row[] = [
  // ---- Step A: JoinRequest transitions ----
  {
    name: "requested — fresh pending",
    input: input({ joinRequest: jr("pending", AFTER) }),
    expected: { matchId: MATCH_ID, action: "requested", myStatus: "pending" },
  },
  {
    name: "accepted — captain approved",
    input: input({ joinRequest: jr("accepted", AFTER) }),
    expected: { matchId: MATCH_ID, action: "accepted", myStatus: "accepted" },
  },
  {
    name: "captain_rejected — rejected, auto_reason null",
    input: input({ joinRequest: jr("rejected", AFTER, null) }),
    expected: {
      matchId: MATCH_ID,
      action: "captain_rejected",
      myStatus: "declined",
    },
  },
  {
    name: "match_started — cron auto-reject",
    input: input({ joinRequest: jr("rejected", AFTER, "match_started") }),
    expected: {
      matchId: MATCH_ID,
      action: "match_started",
      myStatus: "declined",
    },
  },
  {
    name: "match_cancelled — former pending mass-rejected",
    input: input({ joinRequest: jr("rejected", AFTER, "match_cancelled") }),
    expected: {
      matchId: MATCH_ID,
      action: "match_cancelled",
      myStatus: "declined",
    },
  },
  {
    name: "left — accepted player left",
    input: input({ joinRequest: jr("left", AFTER) }),
    expected: { matchId: MATCH_ID, action: "left", myStatus: "none" },
  },
  {
    name: "request_cancelled — user cancelled own pending",
    input: input({ joinRequest: jr("cancelled", AFTER) }),
    expected: {
      matchId: MATCH_ID,
      action: "request_cancelled",
      myStatus: "none",
    },
  },
  {
    name: "kicked — payload carries UI-only kicked status",
    input: input({ joinRequest: jr("kicked", AFTER) }),
    expected: { matchId: MATCH_ID, action: "kicked", myStatus: "kicked" },
  },

  // ---- Step B: match-row changes (captain / accepted) ----
  {
    name: "match_updated — accepted player, match edited",
    input: input({
      joinRequest: jr("accepted", BEFORE),
      matchUpdatedAt: AFTER,
    }),
    expected: {
      matchId: MATCH_ID,
      action: "match_updated",
      myStatus: "accepted",
    },
  },
  {
    name: "match_updated — captain edited own match (other tab)",
    input: input({ isCaptain: true, matchUpdatedAt: AFTER }),
    expected: { matchId: MATCH_ID, action: "match_updated", myStatus: "none" },
  },
  {
    name: "match_cancelled — accepted player, match cancelled",
    input: input({
      joinRequest: jr("accepted", BEFORE),
      matchUpdatedAt: AFTER,
      matchCancelledAt: AFTER,
    }),
    expected: {
      matchId: MATCH_ID,
      action: "match_cancelled",
      myStatus: "cancelled",
    },
  },
  {
    name: "match_cancelled — captain cancelled own match (other tab)",
    input: input({
      isCaptain: true,
      matchUpdatedAt: AFTER,
      matchCancelledAt: AFTER,
    }),
    expected: {
      matchId: MATCH_ID,
      action: "match_cancelled",
      myStatus: "none",
    },
  },

  // ---- null: nothing changed in the window ----
  {
    name: "null — stale pending (updatedAt before since)",
    input: input({ joinRequest: jr("pending", BEFORE) }),
    expected: null,
  },
  {
    name: "null — watcher on an edited match (watching excluded)",
    input: input({ hasWatchRecord: true, matchUpdatedAt: AFTER }),
    expected: null,
  },
  {
    name: "null — accepted but neither JR nor match changed",
    input: input({ joinRequest: jr("accepted", BEFORE), matchUpdatedAt: BEFORE }),
    expected: null,
  },

  // ---- precedence: Step A wins over Step B ----
  {
    name: "precedence — accepted JR transition wins over a same-window edit",
    input: input({
      joinRequest: jr("accepted", AFTER),
      matchUpdatedAt: AFTER,
    }),
    expected: { matchId: MATCH_ID, action: "accepted", myStatus: "accepted" },
  },
];

describe("deriveMatchChange", () => {
  for (const row of ROWS) {
    it(row.name, () => {
      expect(deriveMatchChange(row.input)).toEqual(row.expected);
    });
  }
});
