/**
 * MODULE: tests.match_lifecycle.domain.compute-cta
 * PURPOSE: Exhaustive coverage of the CTA cascade. Every (matchStatus,
 *          viewerRole, isFull) cell in spec match.md §77-103 has a row
 *          below; the table is the canonical source we audit against the
 *          spec at review time. If the spec table changes, this file MUST
 *          change too.
 * LAYER: tests / domain (pure)
 * TESTS FOR: src/match_lifecycle/domain/compute-cta.ts
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "CTA bar"
 */
import { describe, expect, it } from "vitest";

import {
  computeCta,
  type CtaActionType,
  type ViewerRole,
} from "@/src/match_lifecycle/domain/compute-cta";
import type { MatchStatus } from "@/src/match_lifecycle/domain/match-status";

interface Row {
  readonly name: string;
  readonly matchStatus: MatchStatus;
  readonly viewerRole: ViewerRole;
  readonly isFull: boolean;
  readonly primary: CtaActionType;
  readonly primaryLabel?: string;
  readonly secondary?: CtaActionType;
  readonly note?: string;
}

// All status × role permutations the spec enumerates. `isFull` only branches
// for live + none and for live + pending (note line).
const ROWS: readonly Row[] = [
  // ---------------- Cancelled — any role + guest ----------------
  ...(["captain", "accepted", "pending", "watching", "none", "guest"] as const).map(
    (role): Row => ({
      name: `cancelled / ${role}`,
      matchStatus: "cancelled",
      viewerRole: role,
      isFull: false,
      primary: "none",
      primaryLabel: "Match cancelled",
    }),
  ),

  // ---------------- Ended ----------------
  {
    name: "ended / captain → like teammates (comingSoon)",
    matchStatus: "ended",
    viewerRole: "captain",
    isFull: false,
    primary: "like",
  },
  {
    name: "ended / accepted → like teammates (comingSoon)",
    matchStatus: "ended",
    viewerRole: "accepted",
    isFull: false,
    primary: "like",
  },
  ...(["pending", "watching", "none", "guest"] as const).map(
    (role): Row => ({
      name: `ended / ${role} → disabled`,
      matchStatus: "ended",
      viewerRole: role,
      isFull: false,
      primary: "none",
      primaryLabel: "Match ended",
    }),
  ),

  // ---------------- In progress — any role + guest ----------------
  ...(["captain", "accepted", "pending", "watching", "none", "guest"] as const).map(
    (role): Row => ({
      name: `inProgress / ${role}`,
      matchStatus: "inProgress",
      viewerRole: role,
      isFull: false,
      primary: "none",
      primaryLabel: "Match in progress",
    }),
  ),

  // ---------------- Live: guest ----------------
  ...(["open", "almostFull", "full"] as const).map(
    (status): Row => ({
      name: `${status} / guest → sign in`,
      matchStatus: status,
      viewerRole: "guest",
      isFull: status === "full",
      primary: "signIn",
    }),
  ),

  // ---------------- Live: captain ----------------
  ...(["open", "almostFull", "full"] as const).map(
    (status): Row => ({
      name: `${status} / captain → manage`,
      matchStatus: status,
      viewerRole: "captain",
      isFull: status === "full",
      primary: "manage",
    }),
  ),

  // ---------------- Live: accepted ----------------
  {
    name: "open / accepted → you're in + leave",
    matchStatus: "open",
    viewerRole: "accepted",
    isFull: false,
    primary: "none",
    primaryLabel: "You're in ✓",
    secondary: "leave",
  },
  {
    name: "full / accepted → you're in + leave",
    matchStatus: "full",
    viewerRole: "accepted",
    isFull: true,
    primary: "none",
    secondary: "leave",
  },

  // ---------------- Live: pending ----------------
  {
    name: "open / pending → waiting + cancelRequest (no note)",
    matchStatus: "open",
    viewerRole: "pending",
    isFull: false,
    primary: "none",
    secondary: "cancelRequest",
  },
  {
    name: "full / pending → waiting + cancelRequest + note",
    matchStatus: "full",
    viewerRole: "pending",
    isFull: true,
    primary: "none",
    secondary: "cancelRequest",
    note: "Match is now full · captain may still approve",
  },

  // ---------------- Live: watching (only on isFull, invariant) ----------------
  {
    name: "full / watching → notified + stopWatching",
    matchStatus: "full",
    viewerRole: "watching",
    isFull: true,
    primary: "none",
    secondary: "stopWatching",
  },

  // ---------------- Live: none ----------------
  {
    name: "open / none → join match",
    matchStatus: "open",
    viewerRole: "none",
    isFull: false,
    primary: "join",
    primaryLabel: "Join match",
  },
  {
    name: "almostFull / none → join match",
    matchStatus: "almostFull",
    viewerRole: "none",
    isFull: false,
    primary: "join",
  },
  {
    name: "full / none → notify me (comingSoon)",
    matchStatus: "full",
    viewerRole: "none",
    isFull: true,
    primary: "notifyMe",
  },
];

describe("computeCta — cascade matrix", () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const result = computeCta({
        matchStatus: row.matchStatus,
        viewerRole: row.viewerRole,
        isFull: row.isFull,
      });

      expect(result.primary.type).toBe(row.primary);
      if (row.primaryLabel) {
        expect(result.primary.label).toBe(row.primaryLabel);
      }
      if (row.secondary) {
        expect(result.secondary?.type).toBe(row.secondary);
      } else {
        expect(result.secondary).toBeUndefined();
      }
      if (row.note) {
        expect(result.note).toBe(row.note);
      } else {
        expect(result.note).toBeUndefined();
      }
    });
  }
});

describe("computeCta — scope markers", () => {
  it("Layer 6 actions (leave / cancelRequest / notifyMe / stopWatching) are NOT comingSoon and NOT disabled", () => {
    const live = (role: ViewerRole, isFull: boolean) =>
      computeCta({ matchStatus: "open", viewerRole: role, isFull });
    const full = (role: ViewerRole) =>
      computeCta({ matchStatus: "full", viewerRole: role, isFull: true });

    // leave (accepted secondary)
    const accepted = live("accepted", false).secondary!;
    expect(accepted.comingSoon).toBe(false);
    expect(accepted.disabled).toBe(false);

    // cancelRequest (pending secondary)
    const pending = live("pending", false).secondary!;
    expect(pending.comingSoon).toBe(false);
    expect(pending.disabled).toBe(false);

    // stopWatching (watching secondary, only valid when isFull)
    const watching = full("watching").secondary!;
    expect(watching.comingSoon).toBe(false);
    expect(watching.disabled).toBe(false);

    // notifyMe (none + isFull primary)
    const notify = full("none").primary;
    expect(notify.comingSoon).toBe(false);
    expect(notify.disabled).toBe(false);
  });

  it("`like` remains comingSoon (Layer 6.X — Like aggregate not yet built)", () => {
    const ended = (role: ViewerRole) =>
      computeCta({ matchStatus: "ended", viewerRole: role, isFull: false });
    expect(ended("captain").primary.comingSoon).toBe(true);
    expect(ended("accepted").primary.comingSoon).toBe(true);
  });

  it("non-action primary labels (info) stay disabled — they are not buttons", () => {
    // accepted/pending/watching all show an info-style primary that is
    // disabled by design; only their `secondary` action is wired in Layer 6.
    const open = (role: ViewerRole) =>
      computeCta({ matchStatus: "open", viewerRole: role, isFull: false });
    expect(open("accepted").primary.disabled).toBe(true);
    expect(open("pending").primary.disabled).toBe(true);
  });

  it("Layer 5 actions (join / manage / signIn) are NOT comingSoon", () => {
    const open = (role: ViewerRole) =>
      computeCta({ matchStatus: "open", viewerRole: role, isFull: false });
    expect(open("none").primary.comingSoon).toBe(false);
    expect(open("captain").primary.comingSoon).toBe(false);
    expect(open("guest").primary.comingSoon).toBe(false);
  });

  it("disabled status branches stay disabled regardless of role", () => {
    for (const status of ["cancelled", "inProgress"] as const) {
      const result = computeCta({
        matchStatus: status,
        viewerRole: "captain",
        isFull: false,
      });
      expect(result.primary.disabled).toBe(true);
      expect(result.secondary).toBeUndefined();
    }
  });
});
