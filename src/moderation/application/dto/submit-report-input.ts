/**
 * MODULE: moderation.application.dto.submit-report-input
 * PURPOSE: Boundary Zod schema for `POST /api/reports`. Validates the
 *          user-facing report submission shape `{ type, target_id, comment }`
 *          (spec personal.md → "Submission modal").
 * LAYER: application (DTO / boundary)
 * DEPENDENCIES: zod
 * CONSUMED BY: app/api/reports/route.ts
 * INVARIANTS:
 *   - `type` ∈ { 'match', 'player' } — anything else is a 400.
 *   - `target_id` is a non-empty string (UUID shape is verified by the service
 *     when it looks the target up — an invalid id reads as "not found").
 *   - `comment` is required, NFC-normalised, trimmed, 1..500 chars (spec
 *     global.md → "Limits" → Report comment 500 chars). Empty after trim → 400.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "Submission modal".
 */
import { z } from "zod";

export const SubmitReportApiSchema = z.object({
  type: z.enum(["match", "player"]),
  target_id: z.string().min(1, "target_required"),
  comment: z
    .string()
    .trim()
    .normalize("NFC")
    .min(1, "comment_required")
    .max(500, "comment_too_long"),
});

export type SubmitReportApiBody = z.infer<typeof SubmitReportApiSchema>;
