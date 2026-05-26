/**
 * MODULE: tests.match_lifecycle._helpers.fakes
 * PURPOSE: In-memory fake repositories shared by Layer 4 service tests
 *          (join / approve / reject). Adapters are exercised against the live
 *          Neon DB separately; here we only verify orchestration + invariants.
 *          The fake `TransactionClient` is a sentinel — the fakes ignore it
 *          because the lock is mocked away (vi.mock on withMatchLock in each
 *          test file).
 *          Layer 5 addition: FakeChatMessageRepository — used by
 *          PostChatMessageService and DeleteChatMessageService tests.
 * LAYER: tests / helpers
 * RELATED DOCS: docs/ARCHITECTURE.md §12 (testing strategy), docs/adr/0003-…
 */
import { asUserId, type UserId } from "@/src/auth/domain/user";
import {
  asChatMessageId,
  type ChatMessage,
  type ChatMessageId,
} from "@/src/chat/domain/chat-message";
import type {
  ChatMessageRepository,
  InsertChatMessageInput,
  ListChatMessagesForFeedOptions,
} from "@/src/chat/domain/chat-message-repository";
import type { TransactionClient } from "@/src/shared/db/types";

import {
  asJoinRequestId,
  type JoinRequest,
  type JoinRequestId,
  type JoinRequestStatus,
} from "@/src/match_lifecycle/domain/join-request";
import type {
  JoinRequestRepository,
  UpsertToPendingInput,
  UpsertToPendingResult,
} from "@/src/match_lifecycle/domain/join-request-repository";
import {
  asMatchId,
  type Match,
  type MatchId,
} from "@/src/match_lifecycle/domain/match";
import type {
  CreateMatchPersistenceInput,
  FindDiscoverPageOptions,
  FindDiscoverPageResult,
  MatchRepository,
} from "@/src/match_lifecycle/domain/match-repository";
import {
  asVenueId,
  type Surface,
} from "@/src/match_lifecycle/domain/venue";
import type { WatchRepository } from "@/src/match_lifecycle/domain/watch-repository";

/** Sentinel TransactionClient — fakes never inspect it. */
export const FAKE_TX = {} as unknown as TransactionClient;

export const SEED_MATCH_ID = asMatchId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
export const SEED_CAPTAIN_ID = asUserId("11111111-1111-1111-1111-111111111111");
export const SEED_VENUE_ID = asVenueId("22222222-2222-2222-2222-222222222222");
export const SEED_PLAYER_ID = asUserId("33333333-3333-3333-3333-333333333333");
export const OTHER_PLAYER_ID = asUserId("44444444-4444-4444-4444-444444444444");

let nextRequestSeq = 1;
function nextRequestId(): JoinRequestId {
  const id = `req-${String(nextRequestSeq++).padStart(8, "0")}-0000-0000-0000-000000000000`;
  return asJoinRequestId(id);
}

export function makeMatch(overrides: Partial<Match> = {}): Match {
  const base: Match = {
    id: SEED_MATCH_ID,
    captainId: SEED_CAPTAIN_ID,
    venueId: SEED_VENUE_ID,
    startTime: new Date("2026-06-01T17:00:00Z"),
    duration: 90,
    totalSpots: 14,
    price: 0,
    surface: "grass" as Surface,
    studsAllowed: true,
    fieldBooked: false,
    description: null,
    descriptionHidden: false,
    captainCrew: [],
    cancelledAt: null,
    cancelReason: null,
    cancelReasonHidden: false,
    coverId: "cover-default",
    createdAt: new Date("2026-05-26T00:00:00Z"),
    updatedAt: new Date("2026-05-26T00:00:00Z"),
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// MatchRepository
// ---------------------------------------------------------------------------

export class FakeMatchRepository implements MatchRepository {
  private matches = new Map<MatchId, Match>();

  put(match: Match): void {
    this.matches.set(match.id, match);
  }

  async findById(id: MatchId): Promise<Match | null> {
    return this.matches.get(id) ?? null;
  }

  async findDiscoverPage(
    _options: FindDiscoverPageOptions,
  ): Promise<FindDiscoverPageResult> {
    return { rows: [], nextCursor: null };
  }

  async create(_input: CreateMatchPersistenceInput): Promise<MatchId> {
    throw new Error("create() not used in Layer 4 tests");
  }
}

// ---------------------------------------------------------------------------
// JoinRequestRepository
// ---------------------------------------------------------------------------

export class FakeJoinRequestRepository implements JoinRequestRepository {
  public rows = new Map<JoinRequestId, JoinRequest>();
  public updates: Array<{
    id: JoinRequestId;
    status: JoinRequestStatus;
    autoReason: "match_started" | "match_cancelled" | null;
  }> = [];

  put(row: JoinRequest): void {
    this.rows.set(row.id, row);
  }

  /** Test helper — seed a row with deterministic id. */
  seed(args: {
    matchId: MatchId;
    userId: UserId;
    status: JoinRequestStatus;
    guestCount?: number;
    message?: string | null;
    autoReason?: "match_started" | "match_cancelled" | null;
  }): JoinRequest {
    const row: JoinRequest = {
      id: nextRequestId(),
      matchId: args.matchId,
      userId: args.userId,
      status: args.status,
      guestCount: args.guestCount ?? 0,
      message: args.message ?? null,
      autoReason: args.autoReason ?? null,
      createdAt: new Date("2026-05-26T00:00:00Z"),
      updatedAt: new Date("2026-05-26T00:00:00Z"),
    };
    this.put(row);
    return row;
  }

  async findByMatchAndUser(
    matchId: MatchId,
    userId: UserId,
  ): Promise<JoinRequest | null> {
    for (const row of this.rows.values()) {
      if (row.matchId === matchId && row.userId === userId) return row;
    }
    return null;
  }

  async findById(id: JoinRequestId): Promise<JoinRequest | null> {
    return this.rows.get(id) ?? null;
  }

  async upsertToPending(
    input: UpsertToPendingInput,
  ): Promise<UpsertToPendingResult> {
    const existing = await this.findByMatchAndUser(input.matchId, input.userId);
    if (!existing) {
      const row: JoinRequest = {
        id: nextRequestId(),
        matchId: input.matchId,
        userId: input.userId,
        status: "pending",
        guestCount: input.guestCount,
        message: input.message,
        autoReason: null,
        createdAt: new Date("2026-05-26T00:00:00Z"),
        updatedAt: new Date("2026-05-26T00:00:00Z"),
      };
      this.put(row);
      return { outcome: "inserted", row };
    }
    if (existing.status === "pending" || existing.status === "accepted") {
      return {
        outcome: "conflict",
        existingStatus: existing.status,
        row: existing,
      };
    }
    const revived: JoinRequest = {
      ...existing,
      status: "pending",
      guestCount: input.guestCount,
      message: input.message,
      autoReason: null,
      updatedAt: new Date(),
    };
    this.put(revived);
    return { outcome: "revived", row: revived };
  }

  async updateStatus(
    id: JoinRequestId,
    status: JoinRequestStatus,
    autoReason: "match_started" | "match_cancelled" | null,
  ): Promise<void> {
    this.updates.push({ id, status, autoReason });
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, status, autoReason, updatedAt: new Date() });
    }
  }

  async listAcceptedForMatch(matchId: MatchId): Promise<readonly JoinRequest[]> {
    const out: JoinRequest[] = [];
    for (const row of this.rows.values()) {
      if (row.matchId === matchId && row.status === "accepted") out.push(row);
    }
    return out;
  }

  async listPendingForMatch(matchId: MatchId): Promise<readonly JoinRequest[]> {
    const out: JoinRequest[] = [];
    for (const row of this.rows.values()) {
      if (row.matchId === matchId && row.status === "pending") out.push(row);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// WatchRepository
// ---------------------------------------------------------------------------

export class FakeWatchRepository implements WatchRepository {
  public deleted: Array<{ matchId: MatchId; userId: UserId }> = [];
  private rows = new Set<string>();

  /** Test helper — seed a watch row. */
  seed(matchId: MatchId, userId: UserId): void {
    this.rows.add(`${matchId}::${userId}`);
  }

  has(matchId: MatchId, userId: UserId): boolean {
    return this.rows.has(`${matchId}::${userId}`);
  }

  async deleteForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
  ): Promise<void> {
    this.deleted.push({ matchId, userId });
    this.rows.delete(`${matchId}::${userId}`);
  }

  async countForMatch(matchId: MatchId): Promise<number> {
    let n = 0;
    for (const key of this.rows) if (key.startsWith(`${matchId}::`)) n++;
    return n;
  }

  async existsForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
  ): Promise<boolean> {
    return this.rows.has(`${matchId}::${userId}`);
  }
}

// ---------------------------------------------------------------------------
// ChatMessageRepository (Layer 5)
// ---------------------------------------------------------------------------

let nextMessageSeq = 1;
function nextMessageId(): ChatMessageId {
  const id = `msg-${String(nextMessageSeq++).padStart(8, "0")}-0000-0000-0000-000000000000`;
  return asChatMessageId(id);
}

export class FakeChatMessageRepository implements ChatMessageRepository {
  public rows = new Map<ChatMessageId, ChatMessage>();

  /** Test helper — seed a pre-built message row directly. */
  seed(row: ChatMessage): void {
    this.rows.set(row.id, row);
  }

  async insert(input: InsertChatMessageInput): Promise<ChatMessage> {
    const row: ChatMessage = {
      id: nextMessageId(),
      matchId: input.matchId,
      authorId: input.authorId,
      text: input.text,
      createdAt: new Date("2026-05-26T10:00:00Z"),
      deletedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: ChatMessageId): Promise<ChatMessage | null> {
    return this.rows.get(id) ?? null;
  }

  /**
   * Idempotent soft-delete — if already deleted, return the existing row
   * unchanged (preserves original deletedAt).
   */
  async softDelete(id: ChatMessageId, now: Date): Promise<ChatMessage> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`FakeChatMessageRepository: id ${id} not found`);
    if (row.deletedAt !== null) return row;
    const deleted: ChatMessage = { ...row, deletedAt: now };
    this.rows.set(id, deleted);
    return deleted;
  }

  async listForFeed(
    options: ListChatMessagesForFeedOptions,
  ): Promise<readonly ChatMessage[]> {
    const results: ChatMessage[] = [];
    for (const row of this.rows.values()) {
      if (row.matchId !== options.matchId) continue;
      if (options.since === null) {
        results.push(row);
      } else {
        // OR-branch: include if created_at > since OR deleted_at > since
        const createdAfter = row.createdAt > options.since;
        const deletedAfter =
          row.deletedAt !== null && row.deletedAt > options.since;
        if (createdAfter || deletedAfter) results.push(row);
      }
    }
    // Sort by createdAt ASC, then cap at limit
    results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return results.slice(0, options.limit);
  }
}
