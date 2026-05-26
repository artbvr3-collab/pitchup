/**
 * MODULE: app.api.matches.id.messages.msgId.route
 * PURPOSE: HTTP entry for `DELETE /api/matches/:id/messages/:msgId`.
 *          Captain-only soft-delete. Thin: requireAuth → service → 200 /
 *          mapped error.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition, src/chat/composition,
 *               src/shared/errors/http-mapping
 * INVARIANTS:
 *   - Path carries BOTH `:id` (match) and `:msgId` (message). The service
 *     enforces the cross-match guard — a captain of match A cannot delete a
 *     message from match B. Mismatch → 404 message_not_found.
 *   - Idempotent on already-deleted messages (200 with the row's existing
 *     `deleted_at`).
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → §225, §363,
 *               "Per-endpoint checklist" → DELETE /messages/:msgId
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAuth } from "@/src/auth/composition";
import { deleteChatMessageService } from "@/src/chat/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: matchId, msgId: messageId } = await params;

    const deleted = await deleteChatMessageService.execute(
      { matchId, messageId, viewerId: session.userId },
      new Date(),
    );

    return NextResponse.json(
      {
        id: deleted.id,
        deleted_at:
          deleted.deletedAt !== null ? deleted.deletedAt.toISOString() : null,
      },
      { status: 200 },
    );
  } catch (err) {
    return toHttpResponse(err);
  }
}
