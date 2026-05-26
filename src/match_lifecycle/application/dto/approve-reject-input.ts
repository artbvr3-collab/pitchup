/**
 * MODULE: match_lifecycle.application.dto.approve-reject-input
 * PURPOSE: Zod schemas + DTOs shared by `POST /api/matches/:id/approve` and
 *          `POST /api/matches/:id/reject`. The body shape is identical
 *          (single `request_id` uuid); the route handlers differ only in
 *          which service they call.
 * LAYER: application
 * DEPENDENCIES: zod
 * CONSUMED BY: app/api/matches/[id]/{approve,reject}/route.ts,
 *              ./approve-join-request-service.ts,
 *              ./reject-join-request-service.ts
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Per-endpoint checklist"
 */
import { z } from "zod";

export const RequestIdApiSchema = z.object({
  request_id: z.string().uuid(),
});

export type RequestIdApiBody = z.infer<typeof RequestIdApiSchema>;

export interface ApproveJoinRequestInput {
  readonly matchId: string;
  readonly captainId: string;
  readonly requestId: string;
}

export interface RejectJoinRequestInput {
  readonly matchId: string;
  readonly captainId: string;
  readonly requestId: string;
}
