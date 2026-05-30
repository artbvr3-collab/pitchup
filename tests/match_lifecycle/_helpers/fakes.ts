/**
 * MODULE: tests.match_lifecycle._helpers.fakes
 * PURPOSE: In-memory fake repositories shared by Layer 4 service tests
 *          (join / approve / reject). Adapters are exercised against the live
 *          Neon DB separately; here we only verify orchestration + invariants.
 *          The fake `TransactionClient` is a sentinel — the fakes ignore it
 *          because the lock is mocked away (vi.mock on withMatchLock in each
 *          test file).
 *          Layer 5 additions: FakeChatMessageRepository, FakeUserRepository,
 *          makeUser factory — used by MatchStateService, PostChatMessageService,
 *          and DeleteChatMessageService tests.
 * LAYER: tests / helpers
 * RELATED DOCS: docs/ARCHITECTURE.md §12 (testing strategy), docs/adr/0003-…
 */
import {
  asGoogleSub,
  asUserId,
  type User,
  type UserId,
} from "@/src/auth/domain/user";
import type {
  AdminUserListFilters,
  UserRepository,
} from "@/src/auth/domain/user-repository";
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
import type {
  ChatMessageCreatedEvent,
  ChatMessageDeletedEvent,
  ChatRealtimePublisher,
} from "@/src/chat/domain/chat-realtime-publisher";
import type {
  EmailMessage,
  EmailSender,
} from "@/src/notifications/domain/email-sender";
import type {
  NewNotification,
  NotificationRow,
} from "@/src/notifications/domain/notification";
import type { NotificationRepository } from "@/src/notifications/domain/notification-repository";
import type { ReminderSentRepository } from "@/src/notifications/domain/reminder-sent-repository";
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
  FindMapMatchesOptions,
  FindMapMatchesResult,
  MatchRepository,
  UpdateMatchPatch,
} from "@/src/match_lifecycle/domain/match-repository";
import type { VenueRepository } from "@/src/match_lifecycle/domain/venue-repository";
import {
  asVenueId,
  type Surface,
} from "@/src/match_lifecycle/domain/venue";
import type {
  UpsertWatchOutcome,
  WatchRepository,
} from "@/src/match_lifecycle/domain/watch-repository";
import type { MatchWithVenue } from "@/src/match_lifecycle/domain/match";
import type { Venue } from "@/src/match_lifecycle/domain/venue";

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
  /** Per-match venue override; falls back to FAKE_VENUE if absent. */
  private venuesByMatch = new Map<MatchId, Venue>();

  put(match: Match): void {
    this.matches.set(match.id, match);
  }

  /** Attach a venue for a given match — used by Layer 6 /my-matches tests. */
  putVenue(matchId: MatchId, venue: Venue): void {
    this.venuesByMatch.set(matchId, venue);
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

  async findCaptainMatches(
    userId: UserId,
  ): Promise<readonly MatchWithVenue[]> {
    const out: MatchWithVenue[] = [];
    for (const m of this.matches.values()) {
      if (m.captainId === userId) out.push(this.attachVenue(m));
    }
    out.sort((a, b) =>
      a.startTime.getTime() === b.startTime.getTime()
        ? a.id.localeCompare(b.id)
        : a.startTime.getTime() - b.startTime.getTime(),
    );
    return out;
  }

  async findByIds(
    ids: readonly MatchId[],
  ): Promise<readonly MatchWithVenue[]> {
    const out: MatchWithVenue[] = [];
    for (const id of ids) {
      const m = this.matches.get(id);
      if (m) out.push(this.attachVenue(m));
    }
    return out;
  }

  async update(
    id: MatchId,
    patch: UpdateMatchPatch,
  ): Promise<Date> {
    const existing = this.matches.get(id);
    if (!existing) throw new Error(`FakeMatchRepository.update: ${id} missing`);
    const next: Match = {
      ...existing,
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.totalSpots !== undefined
        ? { totalSpots: patch.totalSpots }
        : {}),
      ...(patch.captainCrew !== undefined
        ? { captainCrew: [...patch.captainCrew] }
        : {}),
      ...(patch.surface !== undefined ? { surface: patch.surface } : {}),
      ...(patch.studsAllowed !== undefined
        ? { studsAllowed: patch.studsAllowed }
        : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      ...(patch.fieldBooked !== undefined
        ? { fieldBooked: patch.fieldBooked }
        : {}),
      updatedAt: new Date(existing.updatedAt.getTime() + 1),
    };
    this.matches.set(id, next);
    return next.updatedAt;
  }

  async cancel(
    id: MatchId,
    cancelReason: string,
  ): Promise<void> {
    const existing = this.matches.get(id);
    if (!existing) throw new Error(`FakeMatchRepository.cancel: ${id} missing`);
    this.matches.set(id, {
      ...existing,
      cancelledAt: new Date("2026-05-28T12:00:00Z"),
      cancelReason,
      updatedAt: new Date(existing.updatedAt.getTime() + 1),
    });
  }

  async findUpcomingByCaptain(
    userId: UserId,
    now: Date,
  ): Promise<readonly Match[]> {
    const out: Match[] = [];
    for (const m of this.matches.values()) {
      if (
        m.captainId === userId &&
        m.cancelledAt === null &&
        m.startTime.getTime() > now.getTime()
      ) {
        out.push(m);
      }
    }
    out.sort((a, b) =>
      a.startTime.getTime() === b.startTime.getTime()
        ? a.id.localeCompare(b.id)
        : a.startTime.getTime() - b.startTime.getTime(),
    );
    return out;
  }

  /**
   * Layer 7b cron #3 fake — the real query joins matches × join_requests; the
   * fake instead consults a test-seeded set. Tests opt in via `markHasPending`.
   * Filters by `startTime <= now` against the put() match data.
   */
  private hasPending = new Set<MatchId>();

  /** Mark a (previously put()) match as having at least one pending JR. */
  markHasPending(matchId: MatchId): void {
    this.hasPending.add(matchId);
  }

  async findMatchIdsWithPendingStartedBefore(
    now: Date,
  ): Promise<readonly MatchId[]> {
    const out: MatchId[] = [];
    for (const id of this.hasPending) {
      const m = this.matches.get(id);
      if (m && m.startTime.getTime() <= now.getTime()) out.push(id);
    }
    return out;
  }

  async findMapMatches(
    _options: FindMapMatchesOptions,
  ): Promise<FindMapMatchesResult> {
    return { rows: [] };
  }

  async findActiveStartingInWindow(
    start: Date,
    end: Date,
  ): Promise<readonly Match[]> {
    const out: Match[] = [];
    for (const m of this.matches.values()) {
      const t = m.startTime.getTime();
      if (t >= start.getTime() && t < end.getTime() && m.cancelledAt === null) {
        out.push(m);
      }
    }
    return out;
  }

  private attachVenue(m: Match): MatchWithVenue {
    return { ...m, venue: this.venuesByMatch.get(m.id) ?? FAKE_VENUE };
  }
}

const FAKE_VENUE: Venue = {
  id: SEED_VENUE_ID,
  name: "Letná Park",
  address: "Letenské sady 1, Praha 7",
  lat: 50.0976,
  lng: 14.4187,
  googleMapsUrl: null,
  surface: ["grass" as Surface],
  coverId: "cover-default",
  active: true,
};

/**
 * Fake VenueRepository for Layer 6.5 EditMatchService tests. Mirrors the
 * single-active-venue setup most tests need; supplement via `put()` to
 * swap in a multi-surface or inactive variant.
 */
export class FakeVenueRepository implements VenueRepository {
  private venues = new Map<string, Venue>();

  constructor(seedDefault = true) {
    if (seedDefault) this.put(FAKE_VENUE);
  }

  put(v: Venue): void {
    this.venues.set(v.id, v);
  }

  async listActive(): Promise<readonly Venue[]> {
    return [...this.venues.values()].filter((v) => v.active);
  }

  async findById(id: string): Promise<Venue | null> {
    return this.venues.get(id) ?? null;
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

  async listForUser(userId: UserId): Promise<readonly JoinRequest[]> {
    const out: JoinRequest[] = [];
    for (const row of this.rows.values()) {
      if (row.userId === userId) out.push(row);
    }
    return out;
  }

  async massRejectPending(
    matchId: MatchId,
    autoReason: "match_started" | "match_cancelled",
  ): Promise<readonly JoinRequest[]> {
    const flipped: JoinRequest[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (row.matchId === matchId && row.status === "pending") {
        const next: JoinRequest = {
          ...row,
          status: "rejected",
          autoReason,
          updatedAt: new Date(),
        };
        this.rows.set(id, next);
        this.updates.push({ id, status: "rejected", autoReason });
        flipped.push(next);
      }
    }
    return flipped;
  }

  async countUpcomingAccepted(userId: UserId, _now: Date): Promise<number> {
    // The fake intentionally ignores `_now` — tests that need a clock-aware
    // count seed only accepted rows for upcoming matches (the relation-side
    // predicate is exercised by the Prisma adapter, not here).
    let n = 0;
    for (const row of this.rows.values()) {
      if (row.userId === userId && row.status === "accepted") n++;
    }
    return n;
  }
}

// ---------------------------------------------------------------------------
// WatchRepository
// ---------------------------------------------------------------------------

export class FakeWatchRepository implements WatchRepository {
  public deleted: Array<{ matchId: MatchId; userId: UserId }> = [];
  /** Tracks bulk delete-all calls for notify-watching tests. */
  public bulkDeleted: Array<{ matchId: MatchId; count: number }> = [];
  /** Tracks new INSERTs (idempotent-existing branch excluded). */
  public inserted: Array<{ matchId: MatchId; userId: UserId }> = [];
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

  async upsertForUserAndMatch(
    matchId: MatchId,
    userId: UserId,
  ): Promise<UpsertWatchOutcome> {
    const key = `${matchId}::${userId}`;
    if (this.rows.has(key)) return "existed";
    this.rows.add(key);
    this.inserted.push({ matchId, userId });
    return "inserted";
  }

  async listForMatch(matchId: MatchId): Promise<readonly UserId[]> {
    const out: UserId[] = [];
    const prefix = `${matchId}::`;
    for (const key of this.rows) {
      if (key.startsWith(prefix)) out.push(key.slice(prefix.length) as UserId);
    }
    return out;
  }

  async deleteAllForMatch(matchId: MatchId): Promise<number> {
    const prefix = `${matchId}::`;
    let count = 0;
    for (const key of Array.from(this.rows)) {
      if (key.startsWith(prefix)) {
        this.rows.delete(key);
        count++;
      }
    }
    this.bulkDeleted.push({ matchId, count });
    return count;
  }

  async listMatchIdsForUser(userId: UserId): Promise<readonly MatchId[]> {
    const suffix = `::${userId}`;
    const out: MatchId[] = [];
    for (const key of this.rows) {
      if (key.endsWith(suffix)) out.push(key.slice(0, -suffix.length) as MatchId);
    }
    return out;
  }

  /** Records cutoff for assertion; returns the preconfigured count. */
  public deleteForMatchesStartingBeforeCalls: Date[] = [];
  public deleteForMatchesStartingBeforeResult = 0;

  async deleteForMatchesStartingBefore(beforeStartTime: Date): Promise<number> {
    this.deleteForMatchesStartingBeforeCalls.push(beforeStartTime);
    return this.deleteForMatchesStartingBeforeResult;
  }
}

// ---------------------------------------------------------------------------
// NotificationRepository (Layer 6.5)
// ---------------------------------------------------------------------------

export class FakeNotificationRepository implements NotificationRepository {
  /** Every inserted row (insert + insertMany flattened) in call order. */
  public inserted: NewNotification[] = [];
  public markAllReadCalls: string[] = [];
  /** Cutoffs passed to deleteOlderThan (Layer 7b InboxTtlService). */
  public deleteOlderThanCalls: Date[] = [];
  /** Configurable result for deleteOlderThan; defaults to 0. */
  public deleteOlderThanResult = 0;
  private store: NotificationRow[] = [];

  async insert(n: NewNotification, _tx: TransactionClient): Promise<void> {
    this.inserted.push(n);
  }
  async insertMany(
    ns: readonly NewNotification[],
    _tx: TransactionClient,
  ): Promise<void> {
    this.inserted.push(...ns);
  }
  async listRecent(): Promise<readonly NotificationRow[]> {
    return this.store;
  }
  async hasUnread(): Promise<boolean> {
    return this.store.some((r) => r.readAt === null);
  }
  async markAllRead(userId: string): Promise<void> {
    this.markAllReadCalls.push(userId);
  }
  async deleteOlderThan(cutoff: Date): Promise<number> {
    this.deleteOlderThanCalls.push(cutoff);
    return this.deleteOlderThanResult;
  }
}

// ---------------------------------------------------------------------------
// ReminderSentRepository (Layer 7b)
// ---------------------------------------------------------------------------

export class FakeReminderSentRepository implements ReminderSentRepository {
  /** Cutoffs passed to deleteForMatchesStartingBefore (InboxTtlService). */
  public deleteForMatchesStartingBeforeCalls: Date[] = [];
  /** Configurable result; defaults to 0. */
  public deleteForMatchesStartingBeforeResult = 0;

  /**
   * In-memory ledger backing insertIfAbsent. Keyed by `${matchId}::${userId}::${kind}`.
   * Tests pre-seed via `seed()` to simulate "already sent" rows.
   */
  private ledger = new Set<string>();
  /** Every (matchId, userId, kind) attempt in call order. */
  public insertCalls: Array<{
    matchId: string;
    userId: string;
    kind: string;
  }> = [];

  seed(matchId: string, userId: string, kind: string): void {
    this.ledger.add(`${matchId}::${userId}::${kind}`);
  }

  async insertIfAbsent(
    matchId: string,
    userId: string,
    kind: string,
    _tx: TransactionClient,
  ): Promise<"inserted" | "existed"> {
    this.insertCalls.push({ matchId, userId, kind });
    const key = `${matchId}::${userId}::${kind}`;
    if (this.ledger.has(key)) return "existed";
    this.ledger.add(key);
    return "inserted";
  }

  async deleteForMatchesStartingBefore(beforeStartTime: Date): Promise<number> {
    this.deleteForMatchesStartingBeforeCalls.push(beforeStartTime);
    return this.deleteForMatchesStartingBeforeResult;
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

// ---------------------------------------------------------------------------
// UserRepository (Layer 5)
// ---------------------------------------------------------------------------

export function makeUser(args: {
  id: UserId;
  name: string;
  email?: string;
  emailNotifications?: boolean;
  banned?: boolean;
  deletedAt?: Date | null;
}): User {
  return {
    id: args.id,
    googleSub: asGoogleSub(`google-sub-${args.id}`),
    email: args.email ?? `${args.id}@example.com`,
    name: args.name,
    avatarUrl: "",
    contactInfo: null,
    emailNotifications: args.emailNotifications ?? false,
    isAdmin: false,
    banned: args.banned ?? false,
    deletedAt: args.deletedAt ?? null,
    createdAt: new Date("2026-05-26T00:00:00Z"),
  };
}

export class FakeUserRepository implements UserRepository {
  private users = new Map<UserId, User>();

  /** Test helper — seed a user into the store. */
  seed(user: User): void {
    this.users.set(user.id, user);
  }

  async findByGoogleSub(): Promise<User | null> {
    throw new Error("findByGoogleSub not used in Layer 5 tests");
  }

  async create(): Promise<User> {
    throw new Error("create not used in Layer 5 tests");
  }

  async findByIds(ids: readonly UserId[]): Promise<readonly User[]> {
    const result: User[] = [];
    for (const id of ids) {
      const u = this.users.get(id);
      if (u) result.push(u);
    }
    return result;
  }

  async findById(id: UserId): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async updateProfile(): Promise<User> {
    throw new Error("updateProfile not used in match_lifecycle tests");
  }

  async countActiveAdmins(excludeUserId?: UserId): Promise<number> {
    let n = 0;
    for (const u of this.users.values()) {
      if (excludeUserId !== undefined && u.id === excludeUserId) continue;
      if (u.isAdmin && !u.banned && u.deletedAt === null) n++;
    }
    return n;
  }

  async markDeleted(id: UserId): Promise<void> {
    const u = this.users.get(id);
    if (u) this.users.set(id, { ...u, deletedAt: new Date() });
  }

  async setBanned(id: UserId, banned: boolean): Promise<void> {
    const u = this.users.get(id);
    if (u) this.users.set(id, { ...u, banned });
  }

  async setAdmin(id: UserId, isAdmin: boolean): Promise<void> {
    const u = this.users.get(id);
    if (u) this.users.set(id, { ...u, isAdmin });
  }

  async listForAdmin(filters: AdminUserListFilters): Promise<readonly User[]> {
    let rows = [...this.users.values()].filter((u) => u.deletedAt === null);
    if (filters.adminFilter === "yes") rows = rows.filter((u) => u.isAdmin);
    if (filters.adminFilter === "no") rows = rows.filter((u) => !u.isAdmin);
    if (filters.statusFilter === "active") rows = rows.filter((u) => !u.banned);
    if (filters.statusFilter === "banned") rows = rows.filter((u) => u.banned);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.slice(0, filters.limit);
  }
}

// ---------------------------------------------------------------------------
// EmailSender (Layer 7b)
// ---------------------------------------------------------------------------

/**
 * Records every message instead of sending it. Failure toggles drive the two
 * send-failure paths: `failNext(n)` for the morning cron's ledger rollback +
 * retry, `setFailAlways()` for the approve/kick best-effort swallow.
 */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  private failAlways = false;
  private failCount = 0;

  /** Throw on the next `n` sends, then resume succeeding (cron-retry path). */
  failNext(n = 1): void {
    this.failCount = n;
  }

  /** Throw on every send (persistent outage / best-effort swallow path). */
  setFailAlways(value = true): void {
    this.failAlways = value;
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.failAlways || this.failCount > 0) {
      if (this.failCount > 0) this.failCount -= 1;
      throw new Error("FakeEmailSender: simulated send failure");
    }
    this.sent.push(message);
  }
}

/**
 * Fake ChatRealtimePublisher — records published events and can simulate a
 * transport failure (best-effort swallow path, ADR-0005). Mirrors
 * FakeEmailSender. The real adapter publishes to Ably; here we only assert the
 * service calls the port with the correct payload and survives a throw.
 */
export class FakeChatRealtimePublisher implements ChatRealtimePublisher {
  readonly created: { matchId: string; event: ChatMessageCreatedEvent }[] = [];
  readonly deleted: { matchId: string; event: ChatMessageDeletedEvent }[] = [];
  private failAlways = false;

  /** Throw on every publish (transport outage / best-effort swallow path). */
  setFailAlways(value = true): void {
    this.failAlways = value;
  }

  async publishMessageCreated(
    matchId: string,
    event: ChatMessageCreatedEvent,
  ): Promise<void> {
    if (this.failAlways) {
      throw new Error("FakeChatRealtimePublisher: simulated publish failure");
    }
    this.created.push({ matchId, event });
  }

  async publishMessageDeleted(
    matchId: string,
    event: ChatMessageDeletedEvent,
  ): Promise<void> {
    if (this.failAlways) {
      throw new Error("FakeChatRealtimePublisher: simulated publish failure");
    }
    this.deleted.push({ matchId, event });
  }
}
