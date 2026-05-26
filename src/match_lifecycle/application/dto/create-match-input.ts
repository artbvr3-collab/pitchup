/**
 * MODULE: match_lifecycle.application.dto.create-match-input
 * PURPOSE: Zod schemas + inferred types for the `POST /api/matches` payload.
 *          Two schemas:
 *            - `CreateMatchApiSchema` parses the raw HTTP body (snake_case
 *              keys, as written in the spec).
 *            - `CreateMatchInputSchema` is the application-layer DTO
 *              (camelCase, branded types). The Route Handler maps API → DTO.
 *          Keeping them separate prevents the HTTP contract and the use-case
 *          contract from sharing the same shape (different audiences — see
 *          docs/ARCHITECTURE.md §7).
 * LAYER: application
 * DEPENDENCIES: zod, ../../domain/venue, src/auth/domain/user
 * CONSUMED BY: app/api/matches/route.ts (POST), ./create-match-service.ts
 * INVARIANTS:
 *   - Per-field shape checks live here (types, lengths, ranges). Cross-field
 *     and time-sensitive checks (start_time vs now+30min, surface vs venue
 *     offers, crew vs total_spots) live in the service — they need outside
 *     state (the venue row, current time).
 *   - `description` may be omitted or null; both flatten to `null` for the
 *     repository. The DB column is nullable.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/new — Create match"
 *   - docs/ARCHITECTURE.md §7 (Validation)
 */
import { z } from "zod";

/**
 * Raw HTTP body. Mirrors snake_case keys as written in the spec
 * ("Per-endpoint checklist" → POST /matches). The Route Handler parses with
 * this schema, then maps to the application DTO.
 */
export const CreateMatchApiSchema = z.object({
  venue_id: z.string().uuid(),
  start_time: z.string().datetime({ offset: true }),
  duration: z.number().int().positive().max(240),
  total_spots: z.number().int().min(8).max(30),
  price: z.number().int().min(0).max(10_000),
  surface: z.enum(["grass", "hard"]),
  studs_allowed: z.boolean(),
  field_booked: z.boolean(),
  description: z.string().max(2000).nullable().optional(),
  captain_crew: z.array(z.string().max(30)).max(29).default([]),
});

export type CreateMatchApiBody = z.infer<typeof CreateMatchApiSchema>;

/**
 * Application-layer input. Branded ids, parsed Date, normalised optional
 * fields. The service operates on this shape.
 */
export interface CreateMatchInput {
  readonly captainId: string;
  readonly venueId: string;
  readonly startTime: Date;
  readonly duration: number;
  readonly totalSpots: number;
  readonly price: number;
  readonly surface: "grass" | "hard";
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly description: string | null;
  readonly captainCrew: readonly string[];
}
