/**
 * MODULE: match_lifecycle.application.list-my-chats-service
 * PURPOSE: Cross-aggregate read-model assembler for `/chats`. Lists every
 *          match the viewer has chat access to — accepted player OR captain,
 *          including past and cancelled — and decorates each with slot math,
 *          on-read match status, and an unread flag, then sorts by chat
 *          activity. Mirrors the assembler pattern of `ListMyMatchesService`
 *          (Layer 6) and `MatchStateService` (Layer 5): the application layer
 *          composes ports from sibling contexts (match_lifecycle + chat).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository.findCaptainMatches / findByIds,
 *                       JoinRequestRepository.listForUser /
 *                         listAcceptedForMatch,
 *                       ChatMessageRepository.activityByMatches,
 *                       ChatReadRepository.listLastReadForUser
 * CONSUMED BY: app/(private)/chats/page.tsx (RSC)
 * INVARIANTS:
 *   - Access filter (spec personal.md "/chats"): isCaptain OR my JoinRequest
 *     status === 'accepted'. Pending / watching / left / kicked / rejected /
 *     cancelled-request are excluded — they have no chat access.
 *   - Past AND cancelled matches are included — their chats stay readable
 *     after Ended / Cancel (spec "/chats" + match.md chat rules).
 *   - Unread is on-read (no stored flag): `lastForeignAt` (latest non-deleted
 *     message from another author) is newer than the viewer's ChatRead cursor
 *     (or there is no cursor yet). The viewer's own messages never count.
 *   - Sort (spec "/chats" → "Sorting"): chats WITH messages first, by
 *     latest-message time DESC; chats with no messages last, by `start_time`
 *     ASC. `id` breaks every tie for determinism.
 *   - Slot math + match status come from the canonical helpers
 *     (`computeSlots`, `deriveMatchStatus`) — never recomputed inline (AGENTS
 *     gotcha "Don't recompute slot math or match status").
 *   - Accepted-slot counts are an N-read fan-out, capped by the small number
 *     of chats a user has — same tolerance as `ListMyMatchesService`.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/chats"
 *   - docs/ROADMAP.md → /chats slice
 */
import type { ChatMessageRepository } from "@/src/chat/domain/chat-message-repository";
import type { ChatReadRepository } from "@/src/chat/domain/chat-read-repository";
import type { UserId } from "@/src/auth/domain/user";

import type { JoinRequestRepository } from "../domain/join-request-repository";
import type { MatchId, MatchWithVenue } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { deriveMatchStatus } from "../domain/match-status";
import { computeSlots } from "../domain/slot-math";
import type { MyChatCardDto, MyChatsPage } from "./dto/my-chats";

export interface ListMyChatsInput {
  readonly userId: UserId;
}

/** Card envelope carrying the sort key alongside the rendered DTO. */
interface SortableCard {
  readonly dto: MyChatCardDto;
  /** Latest non-deleted message time; `null` when the chat has no messages. */
  readonly lastActivityAt: Date | null;
}

export class ListMyChatsService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly joinRequestRepository: JoinRequestRepository,
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly chatReadRepository: ChatReadRepository,
  ) {}

  async execute(input: ListMyChatsInput, now: Date): Promise<MyChatsPage> {
    const userId = input.userId;

    // 1. Fan out the two relationship reads.
    const [captainMatches, joinRequests] = await Promise.all([
      this.matchRepository.findCaptainMatches(userId),
      this.joinRequestRepository.listForUser(userId),
    ]);

    // 2. Collect accepted-as-player match ids not already captained.
    const captainIdSet = new Set<string>(captainMatches.map((m) => m.id));
    const acceptedExtraIds = new Set<MatchId>();
    for (const jr of joinRequests) {
      if (jr.status === "accepted" && !captainIdSet.has(jr.matchId)) {
        acceptedExtraIds.add(jr.matchId);
      }
    }
    const acceptedMatches = await this.matchRepository.findByIds([
      ...acceptedExtraIds,
    ]);

    const allMatches: MatchWithVenue[] = [...captainMatches, ...acceptedMatches];
    if (allMatches.length === 0) return { chats: [] };

    const matchIds = allMatches.map((m) => m.id);

    // 3. Slot counts (per match) + chat activity + read cursors, in parallel.
    const [acceptedSlotByMatch, activityByMatch, lastReadByMatch] =
      await Promise.all([
        this.fetchAcceptedSlotsByMatch(allMatches),
        this.chatMessageRepository.activityByMatches(userId, matchIds),
        this.chatReadRepository.listLastReadForUser(userId, matchIds),
      ]);

    // 4. Build sortable cards.
    const cards: SortableCard[] = allMatches.map((match) => {
      const slots = computeSlots(match, acceptedSlotByMatch.get(match.id) ?? 0);
      const matchStatus = deriveMatchStatus(match, slots, now);
      const activity = activityByMatch.get(match.id) ?? null;
      const lastReadAt = lastReadByMatch.get(match.id) ?? null;
      const unread =
        activity?.lastForeignAt != null &&
        (lastReadAt === null || activity.lastForeignAt > lastReadAt);

      const lastMessage = activity
        ? { text: activity.lastText, isOwn: activity.lastAuthorId === userId }
        : null;

      return {
        dto: { match, slots, matchStatus, unread, lastMessage },
        lastActivityAt: activity?.lastAt ?? null,
      };
    });

    // 5. Sort: chats with messages first (DESC by last message), chats with
    //    no messages last (ASC by start_time). `id` breaks every tie.
    cards.sort(compareChats);

    return { chats: cards.map((c) => c.dto) };
  }

  private async fetchAcceptedSlotsByMatch(
    matches: readonly MatchWithVenue[],
  ): Promise<Map<MatchId, number>> {
    const entries = await Promise.all(
      matches.map(async (m): Promise<[MatchId, number]> => {
        const rows = await this.joinRequestRepository.listAcceptedForMatch(m.id);
        let total = 0;
        for (const r of rows) total += 1 + r.guestCount;
        return [m.id, total];
      }),
    );
    return new Map(entries);
  }
}

function compareChats(a: SortableCard, b: SortableCard): number {
  const aHas = a.lastActivityAt !== null;
  const bHas = b.lastActivityAt !== null;

  if (aHas && bHas) {
    const d = b.lastActivityAt!.getTime() - a.lastActivityAt!.getTime(); // DESC
    return d !== 0 ? d : a.dto.match.id.localeCompare(b.dto.match.id);
  }
  // Chats with messages rank above chats without.
  if (aHas) return -1;
  if (bHas) return 1;

  // Both have no messages — ASC by start_time, then id.
  const d = a.dto.match.startTime.getTime() - b.dto.match.startTime.getTime();
  return d !== 0 ? d : a.dto.match.id.localeCompare(b.dto.match.id);
}
