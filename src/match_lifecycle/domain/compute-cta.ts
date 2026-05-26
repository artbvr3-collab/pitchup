/**
 * MODULE: match_lifecycle.domain.compute-cta
 * PURPOSE: Canonical CTA cascade — pure function from `(matchStatus,
 *          viewerRole, isFull)` to the `CtaSpec` the bar should render.
 *          Source of truth is the ASCII tree in spec match.md → "CTA bar"
 *          (under #### Cascade). Every cell in the cascade has exactly one
 *          row in the implementation; `MatchCtaBar` only renders the result.
 * LAYER: domain (pure)
 * DEPENDENCIES: ./match-status (MatchStatus enum)
 * CONSUMED BY: src/match_lifecycle/ui/match-cta-bar.tsx (Layer 5),
 *              tests/match_lifecycle/domain/compute-cta.test.ts
 * INVARIANTS:
 *   - Status precedence: Cancelled → Ended → InProgress → live. Status
 *     branch wins over role for the three completed states. Spec §105.
 *   - Live branch fans out by role; `isFull` only affects the `none` role
 *     (Notify-me vs Join) and the `pending` informational footer line.
 *   - Out-of-scope actions in Layer 5 (`leave` / `cancelRequest` / `watch` /
 *     `stopWatching` / `like`) are returned with `disabled: true` and the
 *     `comingSoon` flag set. The UI shows them greyed-out with a "Coming
 *     soon" tooltip — backend endpoints land in Layer 6+.
 *   - `signIn` (guest on live match) is also `disabled: true` here — the
 *     UI wraps it as a link to `/login?callbackUrl=/matches/:id`, which is
 *     the standard middleware-driven redirect.
 *   - The cascade does NOT inspect `viewerId` or any user-specific field
 *     beyond the role enum — keeps the function easily memoizable in the
 *     client island.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "CTA bar" (cascade + branch notes)
 *   - docs/spec/pitchup-spec-global.md → "Slot math" (isFull definition)
 */
import type { MatchStatus } from "./match-status";

/**
 * Viewer's role on the current match. Distinct from `JoinRequest.status` —
 * this enum collapses the three terminal join-request states (rejected /
 * cancelled / left / kicked) into `none` because the CTA cascade treats
 * them all as "no active relationship to the match". `guest` is the
 * unauthenticated case (no session).
 */
export type ViewerRole =
  | "guest"
  | "captain"
  | "accepted"
  | "pending"
  | "watching"
  | "none";

/** Discriminated tag on each CTA result. Drives the renderer style. */
export type CtaActionType =
  | "signIn" //          guest on live status
  | "join" //            none + not-full
  | "notifyMe" //        none + isFull (Layer 6+ — disabled with comingSoon)
  | "manage" //          captain on live status
  | "leave" //           accepted (Layer 6+)
  | "cancelRequest" //   pending (Layer 6+)
  | "stopWatching" //    watching (Layer 6+)
  | "like" //            captain/accepted on Ended (Layer 6+)
  | "none"; //           pure-disabled label, no action

export interface CtaAction {
  readonly type: CtaActionType;
  /** Visible button label, e.g. "Join match" / "Sign in to join". */
  readonly label: string;
  /**
   * `true` when the button is rendered but inert. Either out-of-scope for
   * Layer 5 (`comingSoon`) or naturally disabled by the cascade (e.g.
   * "Waiting for organizer..." for pending). Mutually exclusive with a
   * working `onClick` handler.
   */
  readonly disabled: boolean;
  /**
   * Marks actions deferred to Layer 6+. The UI surfaces this as a
   * non-blocking tooltip "Coming soon". Distinct from `disabled` alone —
   * `disabled` ∧ `!comingSoon` is the natural "you're waiting for someone
   * else" case (pending).
   */
  readonly comingSoon: boolean;
  /**
   * For destructive actions (leave / cancelRequest / stopWatching) the UI
   * may want to render them ghost-style. The cascade flags them so the
   * renderer doesn't re-derive the style from the type.
   */
  readonly variant: "primary" | "ghost" | "destructive" | "info";
}

export interface CtaSpec {
  /** The main CTA (always present, never null). */
  readonly primary: CtaAction;
  /**
   * Secondary action shown below the primary on the same bar. Used by:
   *   - accepted (`[You're in ✓]` + `[Leave match]`)
   *   - pending  (`[Waiting…]` + `[Cancel request]`)
   *   - watching (`[…notified]` + `[Stop watching]`)
   * Omitted (undefined) for single-button states.
   */
  readonly secondary?: CtaAction;
  /**
   * Optional informational line rendered below the buttons. Used by the
   * `pending + isFull` cell to show "Match is now full · captain may still
   * approve" (spec §93-94).
   */
  readonly note?: string;
}

export interface ComputeCtaInput {
  readonly matchStatus: MatchStatus;
  readonly viewerRole: ViewerRole;
  /** `computeSlots(match).free === 0`. */
  readonly isFull: boolean;
}

const COMING_SOON_TOOLTIP_LABEL = " (soon)";

export function computeCta(input: ComputeCtaInput): CtaSpec {
  const { matchStatus, viewerRole, isFull } = input;

  // 1. Status-first branches (spec §105). Status wins over role for all
  //    three completed states.
  if (matchStatus === "cancelled") {
    return {
      primary: makeDisabled("none", "Match cancelled", "info"),
    };
  }

  if (matchStatus === "ended") {
    // Captain + accepted get [Like teammates] (Layer 6 — disabled here).
    if (viewerRole === "captain" || viewerRole === "accepted") {
      return {
        primary: makeComingSoon(
          "like",
          "Like teammates",
          "primary",
          "Coming in Layer 6",
        ),
      };
    }
    return { primary: makeDisabled("none", "Match ended", "info") };
  }

  if (matchStatus === "inProgress") {
    return { primary: makeDisabled("none", "Match in progress", "info") };
  }

  // 2. Live branch (Open / AlmostFull / Full). Status-first cascade already
  //    confirmed this — `matchStatus` is one of the three live states.
  if (viewerRole === "guest") {
    // Guest sees [Sign in to join] — disabled here, UI wraps as link.
    return {
      primary: {
        type: "signIn",
        label: "Sign in to join",
        disabled: true,
        comingSoon: false,
        variant: "primary",
      },
    };
  }

  if (viewerRole === "captain") {
    return {
      primary: {
        type: "manage",
        label: "Manage match",
        disabled: false,
        comingSoon: false,
        variant: "primary",
      },
    };
  }

  if (viewerRole === "accepted") {
    return {
      primary: {
        type: "none",
        label: "You're in ✓",
        disabled: true,
        comingSoon: false,
        variant: "info",
      },
      secondary: makeComingSoon(
        "leave",
        "Leave match",
        "ghost",
        "Coming in Layer 6",
      ),
    };
  }

  if (viewerRole === "pending") {
    const spec: CtaSpec = {
      primary: {
        type: "none",
        label: "Waiting for organizer…",
        disabled: true,
        comingSoon: false,
        variant: "info",
      },
      secondary: makeComingSoon(
        "cancelRequest",
        "Cancel request",
        "ghost",
        "Coming in Layer 6",
      ),
    };
    if (isFull) {
      return { ...spec, note: "Match is now full · captain may still approve" };
    }
    return spec;
  }

  if (viewerRole === "watching") {
    return {
      primary: {
        type: "none",
        label: "You'll be notified if a spot opens",
        disabled: true,
        comingSoon: false,
        variant: "info",
      },
      secondary: makeComingSoon(
        "stopWatching",
        "Stop watching",
        "ghost",
        "Coming in Layer 6",
      ),
    };
  }

  // viewerRole === "none"
  if (isFull) {
    return {
      primary: makeComingSoon(
        "notifyMe",
        "Notify me if a spot opens",
        "primary",
        "Coming in Layer 6",
      ),
    };
  }
  return {
    primary: {
      type: "join",
      label: "Join match",
      disabled: false,
      comingSoon: false,
      variant: "primary",
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers (internal — `make*` constructors keep the cascade itself short
// and the branch identifiers visible at a glance).
// ---------------------------------------------------------------------------

function makeDisabled(
  type: CtaActionType,
  label: string,
  variant: CtaAction["variant"],
): CtaAction {
  return { type, label, disabled: true, comingSoon: false, variant };
}

function makeComingSoon(
  type: CtaActionType,
  label: string,
  variant: CtaAction["variant"],
  _tooltipMessage: string,
): CtaAction {
  return { type, label, disabled: true, comingSoon: true, variant };
}

// Silence unused-import warning if a downstream test imports the tooltip
// label directly. (Currently a no-op constant — kept for future use when
// the UI surfaces the tooltip from the same cascade module.)
export { COMING_SOON_TOOLTIP_LABEL };
