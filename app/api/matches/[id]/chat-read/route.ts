/**
 * MODULE: app.api.matches.id.chat-read.route
 * PURPOSE: HTTP entry for `POST /api/matches/:id/chat-read`. Marks the match
 *          chat as read for the signed-in viewer (UPSERT ChatRead cursor) —
 *          the single mark-as-read trigger behind the `/chats` unread dot.
 *          Fired by the match page when Tab Chat opens (spec personal.md
 *          "/chats" → "Mark-as-read"). No advisory lock (read-state).
 * LAYER: interfaces
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/chats" → "Unread chat
 *               dots — data model"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { markChatReadService } from "@/src/chat/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId } = await params;

    await markChatReadService.execute(
      { matchId, userId: session.userId },
      new Date(),
    );

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
