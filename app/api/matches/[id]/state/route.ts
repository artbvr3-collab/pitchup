/**
 * MODULE: app.api.matches.id.state.route
 * PURPOSE: HTTP entry for `GET /api/matches/:id/state?since=<ISO>`. Polling
 *          endpoint. Returns the wire-shape state assembled by
 *          `MatchStateService`. Captain + accepted only — pending and
 *          watching and guests are 403 here (they read the static initial
 *          snapshot from the RSC, no live polling).
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition, src/match_lifecycle/composition,
 *               src/match_lifecycle/infrastructure/repositories,
 *               src/match_lifecycle/domain/errors,
 *               src/chat/domain/errors,
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - Cache headers: `Cache-Control: no-store` — every poll must hit the
 *     origin. The spec doesn't require ETag at this stage; revisit when
 *     the bandwidth bill complains.
 *   - `?since=` is parsed leniently: missing → null (full history); invalid
 *     timestamp → null (full history) with no 400, to match the broader
 *     "polling endpoints don't 4xx on bad query strings" stance from the
 *     Discover page (AGENTS gotchas).
 *   - Role gate: viewer must be the captain OR have a JoinRequest with
 *     status='accepted'. Pending / watching / guest / kicked / left /
 *     rejected → 403 chat_forbidden. The RSC initial snapshot has its own
 *     code path with no such restriction (it just calls the service).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Polling for match state" (§195),
 *     §213-216 (chat access by role)
 *   - docs/spec/pitchup-spec-global.md → "Polling sync"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { ChatForbiddenError } from "@/src/chat/domain/errors";
import { MatchNotFoundError } from "@/src/match_lifecycle/domain/errors";
import { matchStateService } from "@/src/match_lifecycle/composition";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import {
  joinRequestRepository,
  matchRepository,
} from "@/src/match_lifecycle/infrastructure/repositories";
import { asUserId } from "@/src/auth/domain/user";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";
import { parseSince } from "@/src/shared/http/parse-since";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchIdParam } = await params;
    const matchId = asMatchId(matchIdParam);
    const viewerId = asUserId(session.userId);
    const since = parseSince(request.nextUrl.searchParams.get("since"));

    // Role gate runs before the assembler so we don't even fan out the
    // five reads on a 403. Service still validates match existence (404).
    const match = await matchRepository.findById(matchId);
    if (!match) throw new MatchNotFoundError({ matchId });

    const isCaptain = match.captainId === viewerId;
    if (!isCaptain) {
      const request = await joinRequestRepository.findByMatchAndUser(
        matchId,
        viewerId,
      );
      if (!request || request.status !== "accepted") {
        throw new ChatForbiddenError({
          matchId,
          viewerId,
          reason: "not_polling_member",
        });
      }
    }

    const state = await matchStateService.execute(
      { matchId, viewerId, since },
      new Date(),
    );

    return NextResponse.json(state, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return toHttpResponse(err);
  }
}
