/**
 * MODULE: match_lifecycle.application.dto.join-match-input
 * PURPOSE: Zod schemas + types for `POST /api/matches/:id/join`.
 * LAYER: application
 * DEPENDENCIES: zod
 * CONSUMED BY: app/api/matches/[id]/join/route.ts, ./join-match-service.ts
 * INVARIANTS:
 *   - `guest_count ∈ [0, 4]` (spec global.md → "Guests (+N on join)").
 *   - `message` optional / nullable; empty-after-trim collapses to `null`
 *     in the service.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Join flow",
 *               "Per-endpoint checklist" → POST /join
 */
import { z } from "zod";

export const JoinMatchApiSchema = z.object({
  guest_count: z.number().int().min(0).max(4).default(0),
  message: z.string().max(500).nullable().optional(),
});

export type JoinMatchApiBody = z.infer<typeof JoinMatchApiSchema>;

export interface JoinMatchInput {
  readonly matchId: string;
  readonly userId: string;
  readonly guestCount: number;
  readonly message: string | null;
}
