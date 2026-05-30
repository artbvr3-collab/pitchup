/**
 * MODULE: match_lifecycle.domain.covers
 * PURPOSE: Canonical venue-cover palette + the deterministic default formula.
 *          A cover is a pre-made illustration (gradient + icon) referenced by a
 *          stable slug; the venue/match rows store only the slug
 *          (`Venue.coverId` / `Match.coverId`). Membership is validated at the
 *          app level (the column is `VARCHAR(40)`, NOT a Postgres enum) so
 *          adding a cover never needs a migration.
 * LAYER: domain (pure — no I/O, reproducible on frontend / backend / SQL)
 * DEPENDENCIES: none
 * CONSUMED BY: src/match_lifecycle/application/{create,update}-venue-service,
 *              src/match_lifecycle/application/dto/venue-input (Zod refine),
 *              src/ui/lib/cover-style (visual swatch map keyed by these slugs)
 * INVARIANTS:
 *   - `COVER_IDS` is the single source of truth for valid slugs. The seed
 *     migration's `cover-001..003` are members.
 *   - `defaultCoverIdForVenue` is the spec's exact formula
 *     (global.md → "Cover venue"): `covers[int(hex(id[:8])) % covers.length]`.
 *     Deterministic by `venue.id` so the same venue always renders the same
 *     cover and distribution is ~uniform (first 8 hex chars are high-entropy).
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Cover venue".
 */

/**
 * The cover palette. ~12 pre-made illustrations; the visual definition
 * (gradient + icon) for each slug lives in `src/ui/lib/cover-style.ts`, which
 * is type-checked to cover every member of this tuple.
 */
export const COVER_IDS = [
  "cover-001",
  "cover-002",
  "cover-003",
  "cover-004",
  "cover-005",
  "cover-006",
  "cover-007",
  "cover-008",
  "cover-009",
  "cover-010",
  "cover-011",
  "cover-012",
] as const;

export type CoverId = (typeof COVER_IDS)[number];

/** True when `value` is a known cover slug. */
export function isValidCoverId(value: string): value is CoverId {
  return (COVER_IDS as readonly string[]).includes(value);
}

/**
 * Purpose:    Deterministically pick the default cover for a venue from its id.
 * Args:       venueId — the venue's uuid (with or without dashes).
 * Returns:    a `CoverId` from `COVER_IDS`.
 * Notes:      Pure. `parseInt` of 8 hex chars is ≤ 0xffffffff (safe integer).
 *             Falls back to the first cover if the id has no parseable hex
 *             prefix (should never happen for a uuid; defensive only).
 * RELATED:    spec global.md → "Cover venue" → the canonical formula.
 */
export function defaultCoverIdForVenue(venueId: string): CoverId {
  const hex = venueId.replaceAll("-", "").slice(0, 8);
  const parsed = Number.parseInt(hex, 16);
  const index = Number.isFinite(parsed) ? parsed % COVER_IDS.length : 0;
  return COVER_IDS[index] ?? COVER_IDS[0];
}
