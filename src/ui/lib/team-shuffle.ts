/**
 * MODULE: ui.lib.team-shuffle
 * PURPOSE: Pure helpers for the captain-only "Shuffle teams" tool (Layer 6.X).
 *          Frontend-only, ephemeral — no DB, no push, no reactivity. Builds the
 *          shuffle-unit list from the roster, randomises units into 2/3 teams
 *          (Fisher-Yates + random offset + round-robin), formats the clipboard
 *          text, and reads/writes/clears the per-match localStorage cache.
 * LAYER: ui (lib — pure except the explicit localStorage accessors)
 * DEPENDENCIES: none
 * CONSUMED BY: app/matches/[id]/shuffle-teams.tsx,
 *              app/(private)/me/sign-out-button.tsx (cache clear on sign-out),
 *              app/(private)/me/delete-account-modal.tsx (cache clear on delete)
 * INVARIANTS:
 *   - Units = `computeSlots(match).filled`: captain "{name} (Captain)", each
 *     accepted "{name}", each guest a standalone "Guest N" (continuous global
 *     numbering, accepted-then-their-guests), each crew stub "{first name}".
 *     Guests are NOT tied to their host (spec match.md "What is a shuffle unit").
 *   - Distribution: Fisher-Yates shuffle of the units, then a random offset
 *     before round-robin so the "extra" player on an uneven split isn't always
 *     Red (spec match.md "Distribution"). `Math.random()` is allowed in app
 *     code (the ban is Workflow scripts only).
 *   - Cache key `pitchup:teams:${matchId}`; cleared on sign-out / account
 *     deletion by `clearTeamShuffleCaches()` (shared-device guard, spec §349).
 *     No TTL while signed in (spec §350).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Shuffle teams"
 *   - docs/spec/pitchup-spec-personal.md → "Out of scope for v1 — shuffle"
 */

export const TEAM_CACHE_PREFIX = "pitchup:teams:";

export type TeamCount = 2 | 3;
/** Team index: 0 = Red, 1 = Blue, 2 = Green. */
export type TeamIndex = 0 | 1 | 2;

export interface TeamMeta {
  readonly index: TeamIndex;
  readonly label: string;
  readonly emoji: string;
}

/** Canonical team colours, ordered. Green only used when teamCount === 3. */
export const TEAMS: readonly TeamMeta[] = [
  { index: 0, label: "Red", emoji: "🔴" },
  { index: 1, label: "Blue", emoji: "🔵" },
  { index: 2, label: "Green", emoji: "🟢" },
];

export interface ShuffleRosterInput {
  readonly captainName: string;
  /** Accepted players in acceptance order, each with their guest count. */
  readonly accepted: readonly { readonly name: string; readonly guestCount: number }[];
  /** captain_crew stub names. */
  readonly crew: readonly string[];
}

export interface TeamAssignment {
  readonly unitLabel: string;
  readonly team: TeamIndex;
}

export interface TeamShuffleResult {
  readonly teamCount: TeamCount;
  readonly assignments: readonly TeamAssignment[];
  /** ISO timestamp the shuffle was generated. */
  readonly generatedAt: string;
}

/**
 * Build the ordered unit-label list from the roster. Length equals
 * `computeSlots(match).filled`. Guests get continuous global numbering after
 * the accepted names (accepted-by-date, then their guests).
 */
export function buildShuffleUnits(roster: ShuffleRosterInput): string[] {
  const units: string[] = [`${roster.captainName} (Captain)`];
  const guestUnits: string[] = [];
  let guestNo = 0;
  for (const player of roster.accepted) {
    units.push(player.name);
    for (let g = 0; g < player.guestCount; g++) {
      guestNo += 1;
      guestUnits.push(`Guest ${guestNo}`);
    }
  }
  units.push(...guestUnits);
  for (const stub of roster.crew) {
    units.push(firstName(stub));
  }
  return units;
}

/**
 * Fisher-Yates shuffle the units, then assign round-robin with a random
 * offset. Returns `{ unitLabel, team }[]` in shuffled order. Pure except the
 * `Math.random()` calls (allowed in app code).
 */
export function shuffleIntoTeams(
  units: readonly string[],
  teamCount: TeamCount,
): TeamAssignment[] {
  const shuffled = [...units];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  const offset = Math.floor(Math.random() * teamCount);
  return shuffled.map((unitLabel, i) => ({
    unitLabel,
    team: (((i + offset) % teamCount) as TeamIndex),
  }));
}

/** Group assignments by team, preserving order, for the result view. */
export function groupByTeam(
  assignments: readonly TeamAssignment[],
  teamCount: TeamCount,
): { meta: TeamMeta; members: string[] }[] {
  return TEAMS.slice(0, teamCount).map((meta) => ({
    meta,
    members: assignments
      .filter((a) => a.team === meta.index)
      .map((a) => a.unitLabel),
  }));
}

/**
 * Clipboard text: "Red:\n- A\n- B\n\nBlue:\n- C\n…". Sent to the match chat /
 * WhatsApp (spec match.md "[Copy as text]").
 */
export function formatTeamsAsText(
  assignments: readonly TeamAssignment[],
  teamCount: TeamCount,
): string {
  return groupByTeam(assignments, teamCount)
    .map(
      (group) =>
        `${group.meta.label}:\n${group.members.map((m) => `- ${m}`).join("\n")}`,
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// localStorage cache
// ---------------------------------------------------------------------------

export function readTeamCache(matchId: string): TeamShuffleResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEAM_CACHE_PREFIX + matchId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TeamShuffleResult;
    if (
      (parsed.teamCount === 2 || parsed.teamCount === 3) &&
      Array.isArray(parsed.assignments)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeTeamCache(
  matchId: string,
  result: TeamShuffleResult,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TEAM_CACHE_PREFIX + matchId,
      JSON.stringify(result),
    );
  } catch {
    // Quota / disabled storage — shuffle still works in-memory this session.
  }
}

/**
 * Remove every `pitchup:teams:*` key. Called on sign-out and account deletion
 * so the next signed-in user on a shared device doesn't see a previous
 * captain's roster cache (spec match.md §349).
 */
export function clearTeamShuffleCaches(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(TEAM_CACHE_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Best-effort.
  }
}

function firstName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts[0] ?? name;
}
