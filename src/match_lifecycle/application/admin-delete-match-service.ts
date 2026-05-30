/**
 * MODULE: match_lifecycle.application.admin-delete-match-service
 * PURPOSE: Use case — admin hard-deletes a match and all its data. Implements
 *          `DELETE /api/admin/matches/:id`. Sequence:
 *            1. Read affected user IDs (captain + active JRs + watching).
 *            2. Write `admin_match_deletions` tombstone BEFORE the delete.
 *            3. Prisma `delete` — cascades JoinRequest, Watch, ChatMessage,
 *               Notification, ReminderSent (all `onDelete: Cascade`).
 *          The tombstone lets the global poll emit { action: 'admin_deleted' }
 *          for ≤24 h, since the JR/Watch rows are gone after step 3.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, JoinRequestRepository, WatchRepository,
 *                       AdminMatchDeletionRepository, prisma (direct delete)
 * CONSUMED BY: app/api/admin/matches/[id]/route.ts (DELETE)
 * INVARIANTS:
 *   - NO advisory lock. Hard delete is terminal; no slot/status invariants apply.
 *     The physical DELETE is atomic at the Postgres row level (cascades run in
 *     the same implicit tx from Prisma). If a concurrent mutation is in-flight
 *     under the advisory lock, the delete waits for the RESTRICT/CASCADE chain
 *     (no RESTRICT FKs remain after all child rows cascade).
 *   - No notifications / email — spec personal.md "Delete": "No in-app inbox /
 *     email notifications to participants — this is a tool for illegitimate
 *     matches (spam, fake)."
 *   - Tombstone `affected_user_ids` captures: captain + anyone with a non-null
 *     JoinRequest (pending/accepted/rejected/etc.) + anyone watching. This is
 *     wider than the spec's "former captain, accepted, pending, watching" to be
 *     safe — the poll ignores the entry once the card is gone anyway.
 *   - If the match is not found, throws `MatchNotFoundError` (404) so the admin
 *     row can be refreshed without confusion.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → "Delete"
 *   - src/match_lifecycle/domain/admin-match-deletion-repository.ts
 */
import { prisma } from "@/src/shared/db/prisma";

import { asMatchId } from "../domain/match";
import { MatchNotFoundError } from "../domain/errors";
import type { AdminMatchDeletionRepository } from "../domain/admin-match-deletion-repository";
import type { JoinRequestRepository } from "../domain/join-request-repository";
import type { MatchRepository } from "../domain/match-repository";
import type { WatchRepository } from "../domain/watch-repository";

export interface AdminDeleteMatchResult {
  readonly status: "deleted";
}

export class AdminDeleteMatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly watchRepository: WatchRepository,
    private readonly adminMatchDeletionRepository: AdminMatchDeletionRepository,
  ) {}

  async execute(matchId: string): Promise<AdminDeleteMatchResult> {
    const id = asMatchId(matchId);

    // Step 1: verify the match exists and read affected users.
    const match = await this.matchRepository.findById(id);
    if (!match) throw new MatchNotFoundError({ matchId: id });

    // Collect all JR user ids (any status — captures pending, accepted, etc.)
    // and watching user ids before the cascade wipes them.
    const [joinRequests, watcherIds] = await Promise.all([
      this.joinRequestRepository.listPendingForMatch(id),
      this.watchRepository.listForMatch(id),
    ]);
    // Also get accepted to make the affected set complete
    const acceptedJRs = await this.joinRequestRepository.listAcceptedForMatch(id);

    const affectedSet = new Set<string>();
    affectedSet.add(match.captainId);
    for (const jr of joinRequests) affectedSet.add(jr.userId);
    for (const jr of acceptedJRs) affectedSet.add(jr.userId);
    for (const uid of watcherIds) affectedSet.add(uid);

    // Step 2: write tombstone BEFORE deletion so the poll can emit admin_deleted.
    await this.adminMatchDeletionRepository.record(matchId, [...affectedSet]);

    // Step 3: physical delete — all children cascade (JoinRequest, Watch,
    // ChatMessage, Notification, ReminderSent all have onDelete: Cascade).
    await prisma.match.delete({ where: { id: matchId } });

    return { status: "deleted" };
  }
}
