/**
 * MODULE: shared.http.parse-since
 * PURPOSE: Lenient ISO-timestamp parser for `?since=` query params on polling
 *          endpoints. Returns `null` for missing / malformed input so the
 *          caller falls back to its "full state" branch.
 * LAYER: shared
 * CONSUMED BY: app/api/matches/[id]/state/route.ts,
 *              app/api/updates/state/route.ts
 * INVARIANTS:
 *   - Polling endpoints NEVER respond 4xx to bad query strings — same
 *     convention as the Discover URL parser (see AGENTS.md gotchas).
 *     A client with a garbled `since` should silently degrade to a full
 *     snapshot, not a panic-state 400.
 *   - Pure function. No side effects, no clock reads.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Polling sync"
 *   - AGENTS.md → "Polling endpoint never throws on bad ?since="
 */

/**
 * Parse an `?since=` query value as an ISO timestamp. Returns `null` for
 * `null`/empty/malformed input — callers treat that as "no cursor, return
 * full state".
 */
export function parseSince(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
