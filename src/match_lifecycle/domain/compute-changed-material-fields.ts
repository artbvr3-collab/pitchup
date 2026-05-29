/**
 * MODULE: match_lifecycle.domain.compute-changed-material-fields
 * PURPOSE: Pure diff of the MATERIAL match fields between a pre- and post-edit
 *          `Match`. Returns the human-readable labels of the fields that
 *          actually changed — used to build the `match_updated` notification
 *          body ("Match updated: surface, price"). Empty result ⇒ no material
 *          change ⇒ accepted players are NOT notified (spec match.md §653).
 * LAYER: domain (pure — no I/O)
 * DEPENDENCIES: ./match (Match type only)
 * CONSUMED BY: src/match_lifecycle/application/edit-match-service.ts
 * INVARIANTS:
 *   - Material editable fields in v1 are exactly { surface, studs_allowed,
 *     price, field_booked } — the same set as `MATERIAL_EDIT_FIELDS` in
 *     application/dto/edit-match-input.ts (kept in sync by hand; that list is
 *     snake_case wire keys for the boundary whitelist, this one is the
 *     domain-side diff). The spec also lists start_time/duration/venue as
 *     material, but those are NOT editable in v1, so they can never differ.
 *   - Label order is stable (surface → studs → price → field booking) so the
 *     notification body is deterministic and testable.
 *   - Non-material fields (description, total_spots, captain_crew) are ignored
 *     here — they are silent for accepted players (the watching channel is
 *     handled separately by notifyWatching on slot-freeing edits).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id/edit" (Material /
 *     non-material), docs/spec/pitchup-spec-global.md → "match_updated —
 *     material vs non-material changes"
 */
import type { Match } from "./match";

/** Human-readable label per material field, in canonical body order. */
const MATERIAL_FIELD_LABELS = {
  surface: "surface",
  studsAllowed: "studs",
  price: "price",
  fieldBooked: "field booking",
} as const;

export function computeChangedMaterialFields(
  before: Match,
  after: Match,
): readonly string[] {
  const changed: string[] = [];
  if (before.surface !== after.surface) {
    changed.push(MATERIAL_FIELD_LABELS.surface);
  }
  if (before.studsAllowed !== after.studsAllowed) {
    changed.push(MATERIAL_FIELD_LABELS.studsAllowed);
  }
  if (before.price !== after.price) {
    changed.push(MATERIAL_FIELD_LABELS.price);
  }
  if (before.fieldBooked !== after.fieldBooked) {
    changed.push(MATERIAL_FIELD_LABELS.fieldBooked);
  }
  return changed;
}
