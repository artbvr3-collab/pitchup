/**
 * MODULE: app.matches.id.match-shell
 * PURPOSE: Client island that owns the page's interactive state — active
 *          tab, captain sheet open/close, and the polling state slice
 *          shared between Lineup and Chat. The RSC page passes everything
 *          it needs as serialisable props (no Match/Venue domain types
 *          here — strings and primitives only).
 * LAYER: interfaces (client)
 * DEPENDENCIES: ./match-hero, ./match-cta-bar, ./match-tabs,
 *               ./lineup-tab, ./chat-tab, ./captain-sheet,
 *               src/match_lifecycle/domain/compute-cta, ./use-match-state,
 *               src/ui/hooks/use-polling
 * INVARIANTS:
 *   - `?tab=` and `?sheet=` are removed from the URL via `router.replace`
 *     after they've been read on mount, so F5 / back don't reopen the
 *     sheet / re-trigger the tab (spec §58 and §266).
 *   - Polling is enabled only when the viewer is captain or accepted.
 *     Pending / watching / guest poll-enabled=false (spec §215-216);
 *     they still see the static initial snapshot.
 *   - The polling payload is merged INTO `state` here; both Lineup and
 *     Chat read the same merged slice.
 *   - Cancelled / Ended / InProgress matches do not poll at all — there's
 *     nothing live to update; the static snapshot is the final state.
 *   - Status string in `initialState` is the wire form (`Open`,
 *     `AlmostFull`, etc.) — converted to the domain enum for `computeCta`
 *     once at the top of render.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id"
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { computeCta } from "@/src/match_lifecycle/domain/compute-cta";
import type { ViewerRole } from "@/src/match_lifecycle/domain/compute-cta";
import type { MatchStatus } from "@/src/match_lifecycle/domain/match-status";
import type {
  MatchStateLineup,
  MatchStateMessage,
  MatchStateMessageAuthor,
  MatchStateResponse,
} from "@/src/match_lifecycle/application/dto/match-state";
import type {
  ChatMessageCreatedEvent,
  ChatMessageDeletedEvent,
} from "@/src/chat/domain/chat-realtime-publisher";
import { usePolling, PollingHttpError } from "@/src/ui/hooks/use-polling";
import { useAblyChannel } from "@/src/ui/hooks/use-ably-channel";

import { CaptainSheet } from "./captain-sheet";
import { ChatTab } from "./chat-tab";
import { LikeModal } from "./like-modal";
import { LineupTab } from "./lineup-tab";
import { MatchCtaBar } from "./match-cta-bar";
import { MatchHeaderMenu } from "./match-header-menu";
import { MatchHero } from "./match-hero";
import { MatchTabs, type TabId } from "./match-tabs";

export interface MatchShellProps {
  readonly matchId: string;
  readonly venue: {
    readonly name: string;
    readonly address: string;
    readonly googleMapsUrl: string | null;
    readonly photoUrl: string | null;
  };
  readonly match: {
    readonly id: string;
    readonly coverId: string;
    readonly startTime: string; // ISO
    readonly duration: number;
    readonly totalSpots: number;
    readonly price: number;
    readonly surface: "grass" | "hard";
    readonly studsAllowed: boolean;
    readonly fieldBooked: boolean;
    readonly description: string | null;
    readonly cancelReason: string | null;
    readonly captainCrew: readonly string[];
  };
  readonly viewerRole: ViewerRole;
  readonly viewerId: string | null;
  readonly initialState: MatchStateResponse;
  readonly initialTab: TabId;
  readonly autoOpenCaptainSheet: boolean;
}

export function MatchShell(props: MatchShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [state, setState] = useState<MatchStateResponse>(props.initialState);
  const [activeTab, setActiveTab] = useState<TabId>(props.initialTab);
  const [captainSheetOpen, setCaptainSheetOpen] = useState(
    props.autoOpenCaptainSheet,
  );

  // Auto-open the Like modal:
  //   a) ?action=likes deep-link (from the /my-matches Likes reminder) — opens
  //      unconditionally for captain/accepted on an Ended match, regardless of
  //      whether they already liked someone (spec personal.md §362 v1.1).
  //   b) First visit to an Ended match when the viewer hasn't liked anyone yet
  //      (spec match.md "Post-match likes" → "When the modal appears").
  const canLike =
    props.viewerRole === "captain" || props.viewerRole === "accepted";
  const [likeModalOpen, setLikeModalOpen] = useState(() => {
    if (!canLike || props.initialState.status !== "Ended") return false;
    if (searchParams.get("action") === "likes") return true;
    const l = props.initialState.lineup;
    const likedSomeone =
      l.captain_liked_by_viewer ||
      l.accepted.some((p) => p.liked_by_viewer);
    return !likedSomeone;
  });

  // Strip ?tab=, ?sheet=, and ?action= from the URL once we've consumed them —
  // same convention as the Discover bottom-sheet (router.replace, no history
  // pollution so F5/back don't retrigger the modal).
  useEffect(() => {
    if (
      !searchParams.get("tab") &&
      !searchParams.get("sheet") &&
      !searchParams.get("action")
    )
      return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    params.delete("sheet");
    params.delete("action");
    const qs = params.toString();
    router.replace(qs.length > 0 ? `?${qs}` : window.location.pathname, {
      scroll: false,
    });
  }, [router, searchParams]);

  // Mark the chat read whenever the Chat tab is open for a member (captain or
  // accepted). The backend UPSERTs ChatRead(last_read_at = now()) — the single
  // mark-as-read trigger behind the /chats unread dot (spec personal.md
  // "/chats" → "Mark-as-read"). Guests / pending / watching have no cursor, so
  // they skip it. Best-effort: a failure just leaves the dot for the next open.
  useEffect(() => {
    if (activeTab !== "chat") return;
    if (props.viewerRole !== "captain" && props.viewerRole !== "accepted") {
      return;
    }
    void fetch(`/api/matches/${props.matchId}/chat-read`, {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => {
      // Best-effort — the dot clears on the next successful open.
    });
  }, [activeTab, props.viewerRole, props.matchId]);

  // Status branch decides whether polling runs at all (Cancelled / Ended /
  // InProgress have no live updates; spec match.md "Polling for match
  // state" mentions captain+accepted only — pending/watching/guest pause).
  const isLiveStatus =
    state.status === "Open" ||
    state.status === "AlmostFull" ||
    state.status === "Full";
  const canPoll =
    isLiveStatus &&
    (props.viewerRole === "captain" || props.viewerRole === "accepted");

  // Cursor for the polling delta — last message timestamp we've seen.
  const sinceCursor = useMemo(() => {
    if (state.messages.length === 0) return null;
    let max = state.messages[0]!.created_at;
    for (const m of state.messages) {
      if (m.created_at > max) max = m.created_at;
      if (m.deleted_at !== null && m.deleted_at > max) max = m.deleted_at;
    }
    return max;
  }, [state.messages]);

  const pollUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (sinceCursor) params.set("since", sinceCursor);
    const qs = params.toString();
    return `/api/matches/${props.matchId}/state${qs ? `?${qs}` : ""}`;
  }, [props.matchId, sinceCursor]);

  usePolling<MatchStateResponse>({
    url: pollUrl,
    enabled: canPoll,
    onPayload: (payload) => {
      setState((prev) => mergePollPayload(prev, payload));
      if (payload.deleted) {
        router.push("/games");
      }
    },
    onError: (err) => {
      // 401 → ban / session-loss → /games (spec global.md "Session
      // invalidation"). Network and other HTTP errors fall through to the
      // hook's exponential back-off.
      if (err instanceof PollingHttpError && err.status === 401) {
        router.push("/games");
      }
    },
  });

  // Realtime chat overlay (Layer 5.5 — ADR-0005). Subscribes ONLY while the
  // Chat tab is open and the viewer isn't pending — a WIDER set than polling
  // (captain + accepted + watching + guest, spec §244). New/deleted messages
  // arrive with <1s latency; polling stays the source of truth. No-ops when
  // the subscribe key is absent.
  useAblyChannel({
    matchId: props.matchId,
    enabled: activeTab === "chat" && props.viewerRole !== "pending",
    viewerId: props.viewerId,
    onMessageCreated: (event: ChatMessageCreatedEvent) =>
      setState((prev) => applyRealtimeCreated(prev, event)),
    onMessageDeleted: (event: ChatMessageDeletedEvent) =>
      setState((prev) =>
        applyRealtimeDeleted(prev, event.id, event.deleted_at),
      ),
    onReconnect: () => {
      // Gap-fill via the same poll path (spec §246). Independent of `canPoll`
      // — watching/guest gap-fill too, even though they don't poll on a timer.
      void fetch(pollUrl, { cache: "no-store", credentials: "same-origin" })
        .then((res) => (res.ok ? (res.json() as Promise<MatchStateResponse>) : null))
        .then((payload) => {
          if (!payload) return;
          setState((prev) => mergePollPayload(prev, payload));
          if (payload.deleted) router.push("/games");
        })
        .catch(() => {
          // Ignore — the next poll or realtime event recovers.
        });
    },
  });

  const domainStatus = wireToDomainStatus(state.status);
  const isFull = state.lineup.accepted.length + state.lineup.crew.length + 1 >=
    props.match.totalSpots;
  const cta = computeCta({
    matchStatus: domainStatus,
    viewerRole: props.viewerRole,
    isFull,
  });

  return (
    <main className="mx-auto flex max-w-[375px] flex-col gap-4 px-4 pb-12">
      <div className="flex h-11 items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="-ml-1 inline-flex items-center gap-1 rounded-card px-2 py-1 text-[14px] font-medium text-text-secondary hover:text-text-primary"
        >
          <span aria-hidden>←</span>
          <span>Back</span>
        </button>
        <MatchHeaderMenu
          matchId={props.matchId}
          canReport={
            props.viewerId !== null && props.viewerRole !== "captain"
          }
        />
      </div>

      <MatchHero
        coverId={props.match.coverId}
        photoUrl={props.venue.photoUrl}
        venueName={props.venue.name}
        venueAddress={props.venue.address}
        googleMapsUrl={props.venue.googleMapsUrl}
        startTime={props.match.startTime}
        duration={props.match.duration}
        price={props.match.price}
        surface={props.match.surface}
        studsAllowed={props.match.studsAllowed}
        fieldBooked={props.match.fieldBooked}
        description={props.match.description}
        cancelReason={state.status === "Cancelled" ? props.match.cancelReason : null}
        status={state.status}
        captain={state.lineup.captain}
        slots={{
          filled:
            1 +
            props.match.captainCrew.length +
            state.lineup.accepted.reduce((n, p) => n + 1 + p.guest_count, 0),
          capacity: props.match.totalSpots,
        }}
      />

      <MatchCtaBar
        matchId={props.matchId}
        startTime={props.match.startTime}
        cta={cta}
        onManageClick={() => setCaptainSheetOpen(true)}
        onLikeClick={() => setLikeModalOpen(true)}
      />

      <MatchTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "lineup" ? (
        <LineupTab
          state={state}
          totalSpots={props.match.totalSpots}
          crew={props.match.captainCrew}
          viewerRole={props.viewerRole}
          matchId={props.matchId}
          canShuffle={
            props.viewerRole === "captain" && state.status !== "Cancelled"
          }
        />
      ) : (
        <ChatTab
          state={state}
          viewerRole={props.viewerRole}
          viewerId={props.viewerId}
          matchId={props.matchId}
          matchStatus={state.status}
          onMessageSent={(message: MatchStateMessage) =>
            setState((prev) => {
              // The composer posts with `author: null` (it has no User
              // snapshot). Resolve the sender from the lineup we already hold
              // so the optimistic bubble shows the viewer's name + avatar
              // immediately, instead of flashing `[Removed user]` until the
              // next poll. Polling/realtime reconcile to the authoritative
              // author by id either way.
              const withAuthor =
                message.author === null
                  ? {
                      ...message,
                      author: resolveAuthorFromLineup(
                        prev.lineup,
                        props.viewerId ?? "",
                      ),
                    }
                  : message;
              return mergePollPayload(prev, mergeOneMessage(prev, withAuthor));
            })
          }
        />
      )}

      {canLike && (
        <LikeModal
          open={likeModalOpen}
          onClose={() => setLikeModalOpen(false)}
          matchId={props.matchId}
          lineup={state.lineup}
          viewerId={props.viewerId}
          onLiked={(receiverId) =>
            setState((prev) => applyViewerLike(prev, receiverId))
          }
        />
      )}

      {captainSheetOpen && props.viewerRole === "captain" && (
        <CaptainSheet
          matchId={props.matchId}
          pending={state.lineup.pending}
          watchingCount={state.lineup.watching_count}
          free={
            props.match.totalSpots -
            (1 +
              props.match.captainCrew.length +
              state.lineup.accepted.reduce((n, p) => n + 1 + p.guest_count, 0))
          }
          onClose={() => setCaptainSheetOpen(false)}
          onChange={(updated) =>
            setState((prev) => ({ ...prev, lineup: updated }))
          }
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Merging helpers — kept in the shell because they own `state`.
// ---------------------------------------------------------------------------

function mergePollPayload(
  prev: MatchStateResponse,
  next: MatchStateResponse,
): MatchStateResponse {
  // Replace lineup + status + updated_at + watching_count + deleted wholesale
  // (the polling endpoint sends snapshots, not deltas, for these).
  // Merge messages by id — Ably (Layer 5.5) will deliver some via push and
  // some via the next poll; idempotent merge by id avoids duplicates.
  const byId = new Map<string, MatchStateMessage>();
  for (const m of prev.messages) byId.set(m.id, m);
  for (const m of next.messages) byId.set(m.id, m);
  const merged = [...byId.values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  return {
    messages: merged,
    lineup: next.lineup,
    status: next.status,
    updated_at: next.updated_at,
    deleted: next.deleted,
  };
}

function mergeOneMessage(
  prev: MatchStateResponse,
  message: MatchStateMessage,
): MatchStateResponse {
  return {
    ...prev,
    messages: [...prev.messages.filter((m) => m.id !== message.id), message],
  };
}

// ---------------------------------------------------------------------------
// Realtime appliers (Layer 5.5). The Ably payload carries `author_id` (raw),
// not the resolved author object — we resolve it against the lineup snapshot
// we already hold (spec §235). Dedup is by message id; polling reconciles
// anything we couldn't resolve.
// ---------------------------------------------------------------------------

function applyRealtimeCreated(
  prev: MatchStateResponse,
  event: ChatMessageCreatedEvent,
): MatchStateResponse {
  // Already present (own optimistic insert, or a poll beat the push) → keep
  // the existing row (it may carry a richer / authoritative author).
  if (prev.messages.some((m) => m.id === event.id)) return prev;

  const message: MatchStateMessage = {
    id: event.id,
    text: event.text,
    created_at: event.created_at,
    deleted_at: null,
    author: resolveAuthorFromLineup(prev.lineup, event.author_id),
  };
  const merged = [...prev.messages, message].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  return { ...prev, messages: merged };
}

function applyRealtimeDeleted(
  prev: MatchStateResponse,
  id: string,
  deletedAt: string,
): MatchStateResponse {
  let changed = false;
  const messages = prev.messages.map((m) => {
    if (m.id === id && m.deleted_at === null) {
      changed = true;
      return { ...m, deleted_at: deletedAt };
    }
    return m;
  });
  // Unknown id (we joined after the message was posted) → ignore; the next
  // poll / gap-fill brings the row already flagged deleted. Idempotent on a
  // re-delivered event (deleted_at already set → no change).
  return changed ? { ...prev, messages } : prev;
}

/**
 * Resolve a chat `author_id` against the lineup we hold. Authors of chat
 * messages are always the captain or an accepted player — both present in
 * everyone's lineup snapshot. Returns `null` only for the rare transient where
 * a just-approved player posts before our lineup updates; the UI renders that
 * as `[Removed user]` for one poll cycle until reconciliation. (Spec §235
 * accepts this — the realtime payload deliberately omits author resolution.)
 */
function resolveAuthorFromLineup(
  lineup: MatchStateLineup,
  authorId: string,
): MatchStateMessageAuthor | null {
  if (lineup.captain.id === authorId) return lineup.captain;
  for (const player of lineup.accepted) {
    if (player.user.id === authorId) return player.user;
  }
  return null;
}

/**
 * Apply a like the viewer just placed to the local lineup snapshot so the
 * Lineup tab's "👍 N" + the modal's "Liked ✓" reflect it immediately,
 * without waiting for a poll. Idempotent on `liked_by_viewer` (a re-like of
 * the same target doesn't double-count).
 */
function applyViewerLike(
  prev: MatchStateResponse,
  receiverId: string,
): MatchStateResponse {
  const l = prev.lineup;
  if (l.captain.id === receiverId) {
    if (l.captain_liked_by_viewer) return prev;
    return {
      ...prev,
      lineup: {
        ...l,
        captain_like_count: l.captain_like_count + 1,
        captain_liked_by_viewer: true,
      },
    };
  }
  let changed = false;
  const accepted = l.accepted.map((p) => {
    if (p.user.id !== receiverId || p.liked_by_viewer) return p;
    changed = true;
    return { ...p, like_count: p.like_count + 1, liked_by_viewer: true };
  });
  return changed ? { ...prev, lineup: { ...l, accepted } } : prev;
}

function wireToDomainStatus(
  wire: MatchStateResponse["status"],
): MatchStatus {
  switch (wire) {
    case "Open":
      return "open";
    case "AlmostFull":
      return "almostFull";
    case "Full":
      return "full";
    case "InProgress":
      return "inProgress";
    case "Ended":
      return "ended";
    case "Cancelled":
      return "cancelled";
  }
}
