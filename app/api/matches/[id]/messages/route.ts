/**
 * MODULE: app.api.matches.id.messages.route
 * PURPOSE: HTTP entry for `POST /api/matches/:id/messages`. Thin:
 *          requireAuth → Zod parse → service → 201 with the persisted row /
 *          mapped error.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition, src/chat/composition,
 *               src/shared/errors/http-mapping,
 *               src/chat/application/dto/post-chat-message-input
 * INVARIANTS:
 *   - No advisory lock — `PostChatMessageService` is the documented
 *     no-lock exception per spec match.md §546 (chat doesn't mutate
 *     slot/status/roster).
 *   - Returns 201 with the persisted message (id, text, created_at,
 *     deleted_at=null) so the client can render it optimistically without
 *     waiting for the next poll.
 *   - Author resolution (`name`, `avatar_url`) is NOT included in the
 *     response — the client either already knows its own user data (from
 *     the session) or pulls it from the next poll cycle. The polling
 *     endpoint surfaces resolved authors uniformly for everyone else.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Per-endpoint checklist"
 *               → POST /messages
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { postChatMessageService } from "@/src/chat/composition";
import { PostChatMessageApiSchema } from "@/src/chat/application/dto/post-chat-message-input";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId } = await params;
    const body = PostChatMessageApiSchema.parse(await request.json());

    const message = await postChatMessageService.execute({
      matchId,
      authorId: session.userId,
      text: body.text,
    });

    return NextResponse.json(
      {
        id: message.id,
        text: message.text,
        created_at: message.createdAt.toISOString(),
        deleted_at:
          message.deletedAt !== null ? message.deletedAt.toISOString() : null,
      },
      { status: 201 },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}
