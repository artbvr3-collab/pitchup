/**
 * MODULE: app.api.my-matches.past.route
 * PURPOSE: HTTP entry for `GET /api/my-matches/past?cursor=<b64url>`. Called
 *          by the `[Show more]` client island on `/my-matches` Section Past.
 *          requireAuth → cursor parse (lenient per Discover convention) →
 *          ListMyMatchesService.executePastPage → 200 JSON.
 * LAYER: interfaces
 * INVARIANTS:
 *   - Invalid / missing cursor → start from the head of Past (same lenient
 *     behaviour as Discover's `?cursor` per AGENTS gotcha "Discover URL
 *     params are whitelist-parsed and never throw"). No 400.
 *   - Authenticated-only (no guest variant — `/my-matches` itself is
 *     auth-only per spec personal.md). Uses `requireAuth` (throwing).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/my-matches" → Section Past
 *     `[Show more]`
 *   - src/match_lifecycle/application/discover-filters.ts → `decodeCursor`,
 *     `encodeCursor` (cursor format shared with Discover)
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import {
  decodeCursor,
  encodeCursor,
} from "@/src/match_lifecycle/application/discover-filters";
import { listMyMatchesService } from "@/src/match_lifecycle/composition";
import type { MyMatchCardDto } from "@/src/match_lifecycle/application/dto/my-matches";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const rawCursor = request.nextUrl.searchParams.get("cursor");
    const cursor = decodeCursor(rawCursor);

    const page = await listMyMatchesService.executePastPage(
      { userId: session.userId, cursor },
      new Date(),
    );

    return NextResponse.json(
      {
        rows: page.rows.map(toWireRow),
        next_cursor: page.pastCursor ? encodeCursor(page.pastCursor) : null,
      },
      { status: 200 },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}

/**
 * Wire shape — flatten the dense `MyMatchCardDto` envelope into a payload
 * the client island can render without re-importing domain types. Keep the
 * field set narrow: the client only needs match basics + badges. Captain
 * past cards carry `is_captain: true` so the renderer can attach the
 * `Captain` mini-badge.
 */
function toWireRow(card: MyMatchCardDto): Record<string, unknown> {
  return {
    match_id: card.match.id,
    venue_name: card.match.venue.name,
    venue_address: card.match.venue.address,
    start_time: card.match.startTime.toISOString(),
    duration: card.match.duration,
    surface: card.match.surface,
    studs_allowed: card.match.studsAllowed,
    field_booked: card.match.fieldBooked,
    price: card.match.price,
    slots: card.slots,
    match_status: card.matchStatus,
    my_status: card.myStatus,
    is_captain: card.isCaptain,
    join_request_status: card.joinRequestStatus,
    join_request_auto_reason: card.joinRequestAutoReason,
  };
}
