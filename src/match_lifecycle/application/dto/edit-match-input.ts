/**
 * MODULE: match_lifecycle.application.dto.edit-match-input
 * PURPOSE: Zod schemas + DTO shared by `PATCH /api/matches/:id` and
 *          `EditMatchService`. The API schema is a STRICT field whitelist
 *          (NOT a blacklist): any key outside the allowed set is silently
 *          dropped at parse time. Spec match.md §647 requires this so that
 *          a payload like `{cancelled_at: null}` or `{venue_id: 'x'}` can
 *          never reanimate a cancelled match or reschedule.
 *          `description: null` is a deliberate clear; `undefined` means
 *          "don't touch". This shape is mirrored 1:1 into `UpdateMatchPatch`
 *          (the repository's patch interface).
 * LAYER: application
 * DEPENDENCIES: zod, ../../domain/venue (Surface)
 * CONSUMED BY: app/api/matches/[id]/route.ts (PATCH),
 *              ./edit-match-service.ts
 * INVARIANTS:
 *   - The schema declares ONLY editable fields. Fields the spec marks as
 *     non-editable (start_time, duration, venue_id, cancelled_at,
 *     cancel_reason, captain_id, …) are absent — Zod's default behaviour
 *     drops unknown keys (no `.strict()` needed; we want silent drop, not
 *     400). The `EditMatchApiSchema.parse(body)` boundary is the canonical
 *     whitelist enforcement point — DO NOT bypass it with a service-layer
 *     `Object.pick`.
 *   - `updated_at` is required (ISO string) and is parsed into a `Date`
 *     immediately so the service compares via `Date.getTime()` rather than
 *     string equality (timestamp serialisation may differ between Prisma
 *     reads and ISO formats).
 *   - Value-shape limits (totalSpots ∈ [8, 30], crew name ≤30, price ≥0)
 *     are duplicated here so the API returns a clean `400 validation_failed`
 *     before the service even runs. Domain-level errors (e.g.
 *     `CapacityBelowFilledError`, `InvalidSurfaceError` against the venue
 *     surface set) still fire in the service because they depend on state
 *     unavailable at parse time.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id/edit", "Per-endpoint
 *     checklist" → PATCH /matches/:id
 *   - docs/spec/pitchup-spec-global.md → "Text field validation &
 *     sanitization", "Total spots — hard cap on approve"
 */
import { z } from "zod";

import type { Surface } from "../../domain/venue";
import type { UpdateMatchPatch } from "../../domain/match-repository";

// NB: keys are snake_case to match the spec's wire format; converted to
// camelCase below before being handed to the service. Each field is
// `.optional()` — `undefined` means "don't touch".
export const EditMatchApiSchema = z.object({
  updated_at: z
    .string()
    .datetime({ offset: true })
    .transform((iso) => new Date(iso)),
  description: z
    .string()
    .max(2000, "description_too_long")
    .nullable()
    .optional(),
  total_spots: z
    .number()
    .int()
    .min(8, "invalid_total_spots")
    .max(30, "invalid_total_spots")
    .optional(),
  captain_crew: z
    .array(z.string().max(30, "invalid_crew_name"))
    .optional(),
  surface: z.enum(["grass", "hard"]).optional(),
  studs_allowed: z.boolean().optional(),
  price: z.number().int().min(0, "invalid_price").optional(),
  field_booked: z.boolean().optional(),
});

export type EditMatchApiBody = z.infer<typeof EditMatchApiSchema>;

/**
 * Application-layer DTO. `patch` is built from the parsed body by including
 * only keys that the client actually sent (i.e. not `undefined`).
 */
export interface EditMatchInput {
  readonly matchId: string;
  readonly captainId: string;
  /** Captured under the lock for the optimistic-concurrency comparison. */
  readonly updatedAt: Date;
  readonly patch: UpdateMatchPatch;
}

/**
 * Material vs non-material classification — spec match.md §651-654.
 *
 * Material fields trigger a Layer 7 `match_updated` notification to every
 * accepted player (with the list of changed fields in the body). In v1 only
 * the four listed surface/studs/price/field_booked are actually editable;
 * the remaining "material" fields from the spec (start_time, duration,
 * venue_id) are not in the whitelist and can never be patched.
 *
 * Non-material fields (description, total_spots, captain_crew) are silent
 * for accepted players — they only surface via the next polling
 * `matches_changed` entry. Watching players ARE notified separately when
 * `total_spots ↑` or stub-removal flips isFull → false (that goes through
 * `notifyWatching`, not the `match_updated` channel).
 */
export const MATERIAL_EDIT_FIELDS = [
  "surface",
  "studs_allowed",
  "price",
  "field_booked",
] as const satisfies readonly (keyof EditMatchApiBody)[];

/**
 * Convert the parsed API body into the camelCase domain patch. Strips
 * `updated_at` (consumed for the OCC check, not part of the UPDATE) and
 * skips any `undefined` key (== client didn't send that field).
 *
 * Exposed as a pure helper so the service stays focused on orchestration
 * and the test layer can exercise the mapping in isolation.
 */
export function buildPatchFromApiBody(
  body: EditMatchApiBody,
): UpdateMatchPatch {
  const patch: { -readonly [K in keyof UpdateMatchPatch]: UpdateMatchPatch[K] } =
    {};
  if (body.description !== undefined) patch.description = body.description;
  if (body.total_spots !== undefined) patch.totalSpots = body.total_spots;
  if (body.captain_crew !== undefined) {
    patch.captainCrew = body.captain_crew;
  }
  if (body.surface !== undefined) patch.surface = body.surface as Surface;
  if (body.studs_allowed !== undefined) {
    patch.studsAllowed = body.studs_allowed;
  }
  if (body.price !== undefined) patch.price = body.price;
  if (body.field_booked !== undefined) patch.fieldBooked = body.field_booked;
  return patch;
}
