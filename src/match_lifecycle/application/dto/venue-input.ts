/**
 * MODULE: match_lifecycle.application.dto.venue-input
 * PURPOSE: Zod schemas + inferred types for the admin venue write endpoints
 *          (`POST /api/admin/venues`, `PATCH /api/admin/venues/:id`). The
 *          create + update bodies share the same field set; create allows
 *          `cover_id` to be omitted (the service applies the deterministic
 *          default). The Route Handler parses with these, then maps to the
 *          application DTO the service consumes.
 * LAYER: application
 * DEPENDENCIES: zod, ../../domain/covers
 * CONSUMED BY: app/api/admin/venues/route.ts (POST),
 *              app/api/admin/venues/[id]/route.ts (PATCH),
 *              ./create-venue-service.ts, ./update-venue-service.ts
 * INVARIANTS:
 *   - Per-field structural checks live here (types, lengths, ranges, enum
 *     membership, surface non-empty + unique, cover-slug membership). The
 *     stateful deactivation guard (active true→false with upcoming matches)
 *     lives in `UpdateVenueService` — it needs the match count.
 *   - `name` / `address` are bounded here (≤100 / ≤200, same caps as the user
 *     profile fields); the service NFC-normalises + re-trims them (Zod can't
 *     normalise). `google_maps_url` blank → `null`.
 *   - Surface tokens are the backend `grass` / `hard` (spec global.md → "Field
 *     surface"); the UI labels Grass / Hard surface are frontend-only.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/venues"
 *   - docs/spec/pitchup-spec-global.md → "Field surface", "Cover venue"
 */
import { z } from "zod";

import { isValidCoverId } from "../../domain/covers";

const NAME_MAX = 100;
const ADDRESS_MAX = 200;

const surfaceSchema = z
  .array(z.enum(["grass", "hard"]))
  .min(1)
  .refine((arr) => new Set(arr).size === arr.length, {
    message: "duplicate surface",
  });

/** Blank / whitespace-only Google Maps URL collapses to `null`. */
const googleMapsUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  .nullable()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v === "" || v === undefined ? null : v));

const baseVenueFields = {
  name: z.string().trim().min(1).max(NAME_MAX),
  address: z.string().trim().min(1).max(ADDRESS_MAX),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  surface: surfaceSchema,
  google_maps_url: googleMapsUrlSchema,
  active: z.boolean(),
};

const coverIdSchema = z
  .string()
  .refine(isValidCoverId, { message: "unknown cover" });

/**
 * `POST /api/admin/venues`. `cover_id` optional — when omitted the service
 * applies `defaultCoverIdForVenue(generatedId)`.
 */
export const VenueCreateApiSchema = z.object({
  ...baseVenueFields,
  cover_id: coverIdSchema.optional(),
});

/** `PATCH /api/admin/venues/:id` — the full editable field set (cover required). */
export const VenueUpdateApiSchema = z.object({
  ...baseVenueFields,
  cover_id: coverIdSchema,
});

export type VenueCreateApiBody = z.infer<typeof VenueCreateApiSchema>;
export type VenueUpdateApiBody = z.infer<typeof VenueUpdateApiSchema>;

/** Application-layer create input (camelCase). `coverId` optional → defaulted. */
export interface CreateVenueServiceInput {
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly googleMapsUrl: string | null;
  readonly surface: readonly ("grass" | "hard")[];
  readonly coverId?: string;
  readonly active: boolean;
}

/** Application-layer update input (camelCase). `coverId` required. */
export interface UpdateVenueServiceInput {
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly googleMapsUrl: string | null;
  readonly surface: readonly ("grass" | "hard")[];
  readonly coverId: string;
  readonly active: boolean;
}
