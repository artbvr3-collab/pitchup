/**
 * MODULE: app.api.matches.route
 * PURPOSE: HTTP entry for `POST /api/matches` — captain publishes a new match.
 *          Thin: requireAuth → Zod parse → service → 201 / mapped error.
 *          First mutating Route Handler in the codebase; exercises the
 *          AppError → HTTP mapping path end-to-end.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition, src/match_lifecycle/composition,
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - Captain = the authenticated user. Payload does NOT carry captain_id;
 *     we never trust the client on that.
 *   - No advisory lock (spec: "Concurrency & locking" → exceptions).
 *   - Returns 201 `{ id }`. The client follows up with a navigation to
 *     `/matches/:id` (no second round-trip needed).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/new" → Backend validation
 *   - docs/ARCHITECTURE.md §5 (Mutations: Route Handlers default)
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { createMatchService } from "@/src/match_lifecycle/composition";
import { CreateMatchApiSchema } from "@/src/match_lifecycle/application/dto/create-match-input";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const body = CreateMatchApiSchema.parse(await request.json());

    const result = await createMatchService.execute(
      {
        captainId: session.userId,
        venueId: body.venue_id,
        startTime: new Date(body.start_time),
        duration: body.duration,
        totalSpots: body.total_spots,
        price: body.price,
        surface: body.surface,
        studsAllowed: body.studs_allowed,
        fieldBooked: body.field_booked,
        description: body.description ?? null,
        captainCrew: body.captain_crew,
      },
      new Date(),
    );

    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
